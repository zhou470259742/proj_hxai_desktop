// 控制面功能自测：覆盖鉴权、权限、增删改、下发裁剪
const BASE = process.env.BASE || "http://127.0.0.1:8787";
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

async function req(path, { method = "GET", body, token, cookie, origin } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(cookie ? { cookie } : {}),
      ...(origin ? { origin } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  return { status: res.status, data, headers: res.headers };
}

const login = async (u, p) => (await req("/api/auth/login", { method: "POST", body: { username: u, password: p } })).data.token;

// 本次运行开始时刻。审计断言只看这之后写入的记录：
// 库里的历史记录可能是别的版本写下的（早期版本有几处审计漏记操作人），
// 拿历史数据判定「现在是否还记得操作人」会误报。
const runStartedAt = new Date().toISOString();

console.log("\n【认证】");
const adminT = await login("admin", "Admin@12345");
ok("管理员登录", Boolean(adminT));
const badLogin = await req("/api/auth/login", { method: "POST", body: { username: "admin", password: "wrong" } });
ok("错误密码返回 401", badLogin.status === 401);
const noAuth = await req("/api/experts");
ok("未登录访问返回 401", noAuth.status === 401);

// CSRF：Cookie 认证的写操作必须同源。Bearer 请求不受影响（浏览器不会自动带它）。
// 这里用假 cookie 值即可——CSRF 检查在密码校验之前，目的是别让跨站请求走到业务逻辑。
const csrfRes = await req("/api/settings", {
  method: "PATCH",
  body: { org_name: "csrf-probe" },
  cookie: "owcp_session=fake",
  origin: "https://evil.example",
});
ok("跨站 Cookie 写操作被拒（403）", csrfRes.status === 403, `${csrfRes.status} ${JSON.stringify(csrfRes.data).slice(0, 120)}`);

const memberT = await login("lijie", "Hx@12345");
const publisherT = await login("zhangmin", "Hx@12345");
ok("成员登录", Boolean(memberT));
ok("发布者登录", Boolean(publisherT));

// 基线：专家作用域会按账号裁剪连接器与技能，管理员如果自己切过工作模式，
// 后面所有「全量」断言都会挂。测之前先退回不限定专家。
const resetAdminMode = await req("/v1/me/active-expert", { method: "POST", token: adminT, body: { expertId: "" } });
ok("自测基线：管理员退出专家模式", resetAdminMode.status === 200 && resetAdminMode.data.activeExpertId === null);

console.log("\n【权限边界】");
const memberCreate = await req("/api/experts", { method: "POST", token: memberT, body: { name: "越权测试", rolePrompt: "x" } });
ok("成员不能新建专家（403）", memberCreate.status === 403, `实际 ${memberCreate.status}`);
const memberUsers = await req("/api/users", { token: memberT });
ok("成员不能读用户列表（403）", memberUsers.status === 403);
const pubCreate = await req("/api/experts", { method: "POST", token: publisherT, body: { name: "发布者测试专家", key: `pub-test-${Date.now().toString(36)}`, rolePrompt: "测试用", status: "draft", permissionMode: "read_only" } });
ok("发布者可以新建专家（201）", pubCreate.status === 201, `实际 ${pubCreate.status}`);
const pubDel = await req(`/api/experts/${pubCreate.data.id}`, { method: "DELETE", token: publisherT });
ok("发布者不能删除专家（403）", pubDel.status === 403);

console.log("\n【专家 CRUD】");
const created = await req("/api/experts", {
  method: "POST", token: adminT,
  body: { name: "自测专家", key: "selftest-expert", roleTitle: "测试", emoji: "🧪", summary: "自测用", rolePrompt: "只做测试", permissionMode: "read_only", status: "draft", visibility: "all", pluginIds: [], skillIds: [] },
});
ok("创建专家", created.status === 201 && created.data.key === "selftest-expert");
const dupKey = await req("/api/experts", { method: "POST", token: adminT, body: { name: "撞 key", key: "selftest-expert", rolePrompt: "x" } });
ok("重复 key 返回 409", dupKey.status === 409, `实际 ${dupKey.status}`);

const plugins = (await req("/api/plugins", { token: adminT })).data.items;
const skills = (await req("/api/skills", { token: adminT })).data.items;
const patched = await req(`/api/experts/${created.data.id}`, {
  method: "PATCH", token: adminT,
  body: { status: "published", pluginIds: [plugins[0].id, plugins[1].id], skillIds: [skills[0].id], permissionMode: "confirm_write" },
});
ok("更新专家（发布 + 绑定能力）", patched.status === 200 && patched.data.status === "published" && patched.data.plugins.length === 2 && patched.data.skills.length === 1);

const manifestAsAdmin = (await req("/api/manifest", { token: adminT })).data;
ok("管理员清单包含全部已发布专家", manifestAsAdmin.experts.length === 5, `实际 ${manifestAsAdmin.experts.length}`);
ok("清单含刚发布的专家", manifestAsAdmin.experts.some((e) => e.key === "selftest-expert"));

const manifestAsMember = (await req("/api/manifest", { token: memberT })).data;
ok("成员清单按授权裁剪（少于管理员）", manifestAsMember.experts.length < manifestAsAdmin.experts.length, `成员 ${manifestAsMember.experts.length} / 管理员 ${manifestAsAdmin.experts.length}`);
ok("成员清单不含仅部门授权的专家", !manifestAsMember.experts.some((e) => e.key === "contract-reviewer"));

const manifestRaw = JSON.stringify(manifestAsAdmin);
ok("清单不含明文密钥", !/secret|clientSecret|Bearer\s+[A-Za-z0-9._-]{20,}/i.test(manifestRaw));

console.log("\n【技能】");
const skillCreated = await req("/api/skills", { method: "POST", token: adminT, body: { name: "自测技能", key: "selftest-skill", content: "# 自测\n\n## 何时使用\n测试", category: "通用", status: "published" } });
ok("创建技能", skillCreated.status === 201);
const sPatched = await req(`/api/skills/${skillCreated.data.id}`, { method: "PATCH", token: adminT, body: { version: "1.1.0" } });
ok("更新技能版本", sPatched.data.version === "1.1.0");

console.log("\n【下发版本】");
const v1 = (await req("/api/manifest", { token: adminT })).data.version;
const v2 = (await req("/api/manifest", { token: adminT })).data.version;
ok("内容不变时版本号稳定", v1 === v2);
await req(`/api/skills/${skillCreated.data.id}`, { method: "PATCH", token: adminT, body: { version: "1.2.0" } });
const v3 = (await req("/api/manifest", { token: adminT })).data.version;
ok("内容变化后版本号变化", v3 !== v1, `${v1} → ${v3}`);
const etagRes = await req("/v1/desktop/manifest", { token: adminT });
ok("下发接口返回 ETag", Boolean(etagRes.headers.get("etag")));
const cached = await fetch(BASE + "/v1/desktop/manifest", { headers: { authorization: `Bearer ${adminT}`, "if-none-match": etagRes.headers.get("etag") } });
ok("带 If-None-Match 返回 304", cached.status === 304, `实际 ${cached.status}`);

console.log("\n【插件连通性探测】");
const stdioPlugin = plugins.find((p) => p.transport === "stdio");
const t1 = await req(`/api/plugins/${stdioPlugin.id}/test`, { method: "POST", token: adminT });
ok("stdio 插件做配置检查", t1.data.reachable === true, JSON.stringify(t1.data));
const httpPlugin = plugins.find((p) => p.transport !== "stdio");
const t2 = await req(`/api/plugins/${httpPlugin.id}/test`, { method: "POST", token: adminT });
ok("不可达域名返回 reachable=false", t2.data.reachable === false, JSON.stringify(t2.data).slice(0, 120));

console.log("\n【模型与供应商】");
const provList = await req("/api/providers", { token: adminT });
ok("供应商列表可读", provList.status === 200 && provList.data.items.length >= 2);
ok("供应商不下发明文密钥", !JSON.stringify(provList.data).includes("sk-internal-8f2c4a1b7d"));
ok("密钥以掩码展示", /••••/.test(JSON.stringify(provList.data)));

const aliasList = await req("/api/aliases", { token: adminT });
ok("别名列表可读", aliasList.data.items.length >= 4);
const stdAlias = aliasList.data.items.find((a) => a.key === "std");
// 锁「std 指向当前真实上游的模型」。曾经锁过演示值 deepseek-v3（上游 llm.hx.local 并不存在），
// 接入真实上游 ai.ctaigw.cn 后换成现在这个值；换上游/换模型时这里跟着改。
ok("标准别名指向真实模型", stdAlias?.targetModel === "deepseek-v4.1-flash-1017");

const memberProv = await req("/api/providers", { method: "POST", token: memberT, body: { name: "x", baseUrl: "http://x" } });
ok("成员不能新增供应商（403）", memberProv.status === 403);
const pubAlias = await req("/api/aliases", { method: "POST", token: publisherT, body: { name: "发布者别名", key: `pub-alias-${Date.now().toString(36)}`, providerRef: stdAlias.providerRef, targetModel: "m" } });
ok("发布者可以建别名（201）", pubAlias.status === 201, `实际 ${pubAlias.status}`);
if (pubAlias.data?.id) await req(`/api/aliases/${pubAlias.data.id}`, { method: "DELETE", token: adminT });

const llm = await req("/v1/llm-providers", { token: adminT });
ok("/v1/llm-providers 返回 llmProviders 数组", Array.isArray(llm.data.llmProviders));
const entries = llm.data.llmProviders;
ok("每个 provider 条目字段齐全", entries.every((e) => typeof e.id === "string" && typeof e.providerId === "string" && typeof e.name === "string" && e.source === "custom"));
ok("模型条目 id 是别名而非真实模型", entries.flatMap((e) => e.models.map((m) => m.id)).includes("std"), "缺 std");
ok("客户端响应不含真实模型名", !JSON.stringify(llm.data).includes("deepseek-v3"));
ok("客户端响应不含上游密钥", !JSON.stringify(llm.data).includes("sk-internal"));
ok("providerConfig 为 opencode 结构", Boolean(entries[0].providerConfig.npm && entries[0].providerConfig.options?.baseURL));

const gwToken = entries[0].providerConfig.options.apiKey;
const gwModels = await req("/v1/llm/hx-gateway/models", { token: gwToken });
ok("网关令牌可访问 /models", gwModels.status === 200 && Array.isArray(gwModels.data.data));
const gwBad = await req("/v1/llm/hx-gateway/models", { token: "owg_wrong" });
ok("错误网关令牌被拒（401）", gwBad.status === 401);
const gwNone = await req("/v1/llm/hx-gateway/models");
ok("无令牌被拒（401）", gwNone.status === 401);

const manifestWithModels = (await req("/api/manifest", { token: adminT })).data;
ok("下发清单含模型别名", Array.isArray(manifestWithModels.models) && manifestWithModels.models.some((m) => m.key === "std"));
ok("清单里的别名不含真实模型名", !JSON.stringify(manifestWithModels.models).includes("deepseek-v3"));

const inv = await req("/v1/org/inventory-revision", { token: adminT });
ok("清单版本接口返回 revision", typeof inv.data.revision === "string");

/* ---------- 客户端「连接供应商」链路 ---------- */
ok("供应商 id 使用 lpr_ 前缀（客户端据此识别云托管）", entries.every((e) => /^lpr_/.test(e.id)), entries.map((e) => e.id).join(","));

const gatewayEntry = entries.find((e) => e.providerId === "hx-gateway");
const conn = await req(`/v1/llm-providers/${gatewayEntry.id}/connect`, { token: adminT });
ok("connect 接口返回 llmProvider", conn.status === 200 && Boolean(conn.data.llmProvider));
const connProvider = conn.data.llmProvider;
ok("connect 含 apiKey（网关令牌，非上游密钥）", typeof connProvider.apiKey === "string" && connProvider.apiKey.startsWith("owg_"));
ok("connect 的 apiKey 不等于上游密钥", connProvider.apiKey !== "sk-internal-8f2c4a1b7d");
ok("connect 的 providerId 正确", connProvider.providerId === "hx-gateway", `实际 ${connProvider.providerId}`);
ok("connect 的 baseURL 指向别名网关", connProvider.providerConfig.options.baseURL.endsWith("/v1/llm/hx-gateway"));
ok("connect 的 models 只有别名", connProvider.models.every((m) => ["std", "pro", "lite"].includes(m.id)));
ok("connect 响应不含真实模型名", !JSON.stringify(conn.data).includes("deepseek-v3"));
ok("connect 响应不含上游密钥", !JSON.stringify(conn.data).includes("sk-internal"));
ok("connect 声明凭据可用（hasApiKey/hasMyCredential）", connProvider.hasApiKey === true && connProvider.hasMyCredential === true);
ok("connect 的 env 为空（避免客户端要求额外环境变量）", Array.isArray(connProvider.providerConfig.env) && connProvider.providerConfig.env.length === 0);

const connMissing = await req("/v1/llm-providers/lpr_not_exist/connect", { token: adminT });
ok("不存在的供应商 connect 返回 404", connMissing.status === 404);
const connNoAuth = await req(`/v1/llm-providers/${gatewayEntry.id}/connect`);
ok("connect 未登录被拒（401）", connNoAuth.status === 401);

const disabledConn = await req("/api/providers/lpr_vision", { method: "PATCH", token: adminT, body: { status: "disabled" } });
ok("可停用供应商", disabledConn.status === 200 && disabledConn.data.status === "disabled");
const connDisabled = await req("/v1/llm-providers/lpr_vision/connect", { token: adminT });
ok("停用的供应商 connect 返回 400", connDisabled.status === 400, `实际 ${connDisabled.status}`);
await req("/api/providers/lpr_vision", { method: "PATCH", token: adminT, body: { status: "enabled" } });

console.log("\n【桌面配置与连接器】");
const dc = await req("/v1/me/desktop-config", { token: adminT });
ok("桌面配置可读", dc.status === 200);
ok("品牌名注入", dc.data.brandAppName === "和信 AI 工作台", String(dc.data.brandAppName));
ok("不启用 Zen 免费模型（避免出现用不了的 Auto）", dc.data.allowZenModel === false);
ok("默认模型指向自建别名", dc.data.defaultModel?.providerID === "lpr_gateway" && dc.data.defaultModel?.modelID === "std");
ok("桌面策略全部放开", dc.data.allowCustomProviders === true && dc.data.allowManageExtensions === true);

const conns = await req("/v1/mcp-connections", { token: adminT });
ok("连接器列表可读", conns.status === 200 && Array.isArray(conns.data.connections));
const connItems = conns.data.connections;
ok("连接器数量与启用插件一致", connItems.length === 6, `实际 ${connItems.length}`);
ok("连接器字段合规", connItems.every((c) => ["oauth", "apikey", "none"].includes(c.authType) && ["shared", "per_member"].includes(c.credentialMode)));
ok("OAuth 连接器按人授权", connItems.filter((c) => c.authType === "oauth").every((c) => c.credentialMode === "per_member"));
ok("Bearer 连接器为共享凭据", connItems.filter((c) => c.authType === "apikey").every((c) => c.credentialMode === "shared"));
ok("连接器不含密钥", !/sk-internal|tokenHint/.test(JSON.stringify(conns.data)));

const presets = await req("/v1/mcp-connections/presets", { token: adminT });
ok("连接器预设可读", presets.status === 200 && Array.isArray(presets.data.presets));

const lib = await req("/v1/me/library", { token: adminT });
ok("资料库条目均为 plugin 类型", lib.data.items.every((i) => i.type === "plugin"));

console.log("\n【市场与技能内容】");
const mk = await req("/v1/marketplaces", { token: adminT });
ok("市场列表 2 个", mk.data.items.length === 2);
const skillMarket = mk.data.items.find((m) => m.id === "mkt_skills");
const pluginMarket = mk.data.items.find((m) => m.id === "mkt_plugins");
// 自测自身会新建并发布技能，这里取实际值，避免硬编码
const publishedSkills = (await req("/api/skills", { token: adminT })).data.items.filter((x) => x.status === "published");
ok("技能市场条数 = 已发布技能数", skillMarket?.pluginCount === publishedSkills.length, `${skillMarket?.pluginCount} vs ${publishedSkills.length}`);
ok("插件市场条数 = 连接器数", pluginMarket?.pluginCount === connItems.length);

const resolvedSkills = await req("/v1/marketplaces/mkt_skills/resolved", { token: adminT });
ok("技能市场可解析", resolvedSkills.status === 200 && resolvedSkills.data.item.plugins.length === publishedSkills.length);
const resolvedPlugins = await req("/v1/marketplaces/mkt_plugins/resolved", { token: adminT });
ok("插件市场可解析", resolvedPlugins.data.item.plugins.length === connItems.length);
ok("插件条目标注为 mcp 组件", resolvedPlugins.data.item.plugins.every((p) => p.componentCounts.mcp === 1));
ok("技能条目标注为 skill 组件", resolvedSkills.data.item.plugins.every((p) => p.componentCounts.skill === 1));

// 数字员工是「专家」不是连接器：它们编译出的插件包只有 agent/skill，没有 MCP 端点。
// 历史上一度因为 endpoint 存成空串混进了插件市场（市场 9 条 vs 连接器 6 条）。
// 这条断言锁住「插件市场 == 连接器集合」，而不只是数量相等。
const connectorIds = new Set(connItems.map((c) => c.id));
ok("插件市场里不含数字员工", resolvedPlugins.data.item.plugins.every((p) => connectorIds.has(p.id)),
  resolvedPlugins.data.item.plugins.filter((p) => !connectorIds.has(p.id)).map((p) => p.name).join(","));
const expertPlugins = (await req("/api/plugins", { token: adminT })).data.items
  .filter((p) => p.category === "数字员工" && p.status === "enabled");
ok("数字员工插件确实存在（不是靠删数据通过）", expertPlugins.length > 0, String(expertPlugins.length));
ok("数字员工仍可被专家引用（未误伤）", expertPlugins.every((p) => !p.endpoint || p.endpoint === ""), expertPlugins.map((p) => `${p.key}:${JSON.stringify(p.endpoint)}`).join(","));

const skillId = resolvedSkills.data.item.plugins[0].id;
const skillObj = await req(`/v1/plugins/${skillId}/resolved`, { token: adminT });
ok("技能内容可解析", skillObj.status === 200 && skillObj.data.items.length === 1);
const co = skillObj.data.items[0].configObject;
ok("技能 objectType 为 skill", co.objectType === "skill", co.objectType);
ok("技能带 SKILL.md 原文", (co.latestVersion?.rawSourceText || "").length > 100);
ok("技能路径符合客户端识别正则", /skills\/[^/]+\/SKILL\.md$/.test(co.currentRelativePath || ""), co.currentRelativePath);

const pluginId = resolvedPlugins.data.item.plugins[0].id;
const mcpObj = await req(`/v1/plugins/${pluginId}/resolved`, { token: adminT });
const mcpCo = mcpObj.data.items[0].configObject;
ok("插件 objectType 为 mcp", mcpCo.objectType === "mcp");
ok("MCP 配置带 mcpServers.url", Boolean(mcpCo.latestVersion?.normalizedPayloadJson?.mcpServers));
ok("MCP 配置保留授权服务器与 scope", Boolean(mcpCo.latestVersion?.normalizedPayloadJson?.authorizationServer));
ok("MCP 配置不含密钥", !/sk-internal/.test(JSON.stringify(mcpObj.data)));

const batch = await req(`/v1/resolved-plugins?pluginIds=${encodeURIComponent(`${skillId},${pluginId}`)}`, { token: adminT });
ok("批量解析按 pluginIds 命中", batch.data.items.length === 2, `实际 ${batch.data.items.length}`);
const batchAll = await req("/v1/resolved-plugins", { token: adminT });
ok("批量解析无参数时返回全部", batchAll.data.items.length >= 12, `实际 ${batchAll.data.items.length}`);
const batchMiss = await req("/v1/resolved-plugins?pluginIds=plg_nope", { token: adminT });
ok("批量解析缺失项进 failures", Boolean(batchMiss.data.failures?.plg_nope) && batchMiss.data.items.length === 0);
ok("单条解析不存在返回 404", (await req("/v1/plugins/plg_nope/resolved", { token: adminT })).status === 404);
ok("市场不存在返回 404", (await req("/v1/marketplaces/mkt_nope/resolved", { token: adminT })).status === 404);

const caps = await req("/v1/resources/marketplace-capabilities", { token: adminT });
const capTypes = new Set(caps.data.items.map((i) => i.objectType));
ok("市场能力含 skill 与 mcp", capTypes.has("skill") && capTypes.has("mcp"));
ok("能力条目 objectType 均为已建模类型", caps.data.items.every((i) => ["skill", "mcp", "agent", "command", "tool", "hook", "context", "custom", "workflow"].includes(i.objectType)));
ok("MCP 能力数与连接器一致", caps.data.items.filter((i) => i.objectType === "mcp").length === connItems.length);

const res = await req("/v1/resources", { token: adminT });
ok("资源快照含供应商与市场", Object.keys(res.data.resources.llmProviders).length === 2 && res.data.resources.marketplaces.length === 2);
ok("特性开关可读", (await req("/v1/features", { token: adminT })).status === 200);
ok("版本接口可读", (await req("/v1/app-version")).status === 200);
ok("MCP 令牌可签发", (await req("/v1/mcp/token", { method: "POST", token: adminT })).status === 200);
ok("会话运行器令牌可签发", (await req("/v1/session-runners/token", { method: "POST", token: adminT })).status === 200);

console.log("\n【专家工作模式】");
// 用经营部的王宇验部门授权：法务部+经营部可见的合同专家该能看到，
// 运维中心专属的事件调度员不该看到。
const bizT = await login("wangyu", "Hx@12345");
ok("经营部成员登录", Boolean(bizT));
const meExperts = await req("/v1/me/experts", { token: bizT });
const bizKeys = meExperts.data.items.map((e) => e.key);
ok("专家列表可读", meExperts.status === 200 && Array.isArray(meExperts.data.items));
ok("成员默认不在任何专家模式", meExperts.data.activeExpertId === null, String(meExperts.data.activeExpertId));
ok("按部门授权下发专家",
  bizKeys.includes("contract-reviewer") && bizKeys.includes("biz-analyst") && bizKeys.includes("doc-writer"),
  JSON.stringify(bizKeys));
ok("未授权的部门专家不下发", !bizKeys.includes("incident-dispatcher"), JSON.stringify(bizKeys));
ok("草稿专家不下发给成员", !bizKeys.includes("dev-reviewer"));
ok("专家带装配摘要", meExperts.data.items.every((e) => typeof e.connectorCount === "number" && typeof e.skillCount === "number"));

const adminExperts = await req("/v1/me/experts", { token: adminT });
const adminKeys = adminExperts.data.items.map((e) => e.key);
ok("管理员看到全部已发布专家",
  ["contract-reviewer", "incident-dispatcher", "biz-analyst", "doc-writer"].every((k) => adminKeys.includes(k)),
  JSON.stringify(adminKeys));

// 切到合同审查专员：只装配了 2 个连接器 + 2 个技能
const contractExpert = meExperts.data.items.find((e) => e.key === "contract-reviewer");
ok("合同专家装配了连接器与技能", contractExpert?.connectorCount === 2 && contractExpert?.skillCount === 2,
  `${contractExpert?.connectorCount}/${contractExpert?.skillCount}`);
const switchRes = await req("/v1/me/active-expert", { method: "POST", token: bizT, body: { expertId: contractExpert.id } });
ok("切换专家成功", switchRes.status === 200 && switchRes.data.activeExpertId === contractExpert.id);

const scopedConns = await req("/v1/mcp-connections", { token: bizT });
ok("切换后连接器按专家裁剪", scopedConns.data.connections.length === 2, `实际 ${scopedConns.data.connections.length}`);
ok("裁剪后只剩合同专家的连接器",
  scopedConns.data.connections.every((c) => contractExpert.connectors.includes(c.name)),
  JSON.stringify(scopedConns.data.connections.map((c) => c.name)));

const scopedCaps = await req("/v1/resources/marketplace-capabilities", { token: bizT });
ok("切换后技能按专家裁剪", scopedCaps.data.items.filter((i) => i.objectType === "skill").length === 2);
ok("切换后 MCP 能力与连接器一致", scopedCaps.data.items.filter((i) => i.objectType === "mcp").length === 2);

const scopedMk = await req("/v1/marketplaces", { token: bizT });
ok("市场计数跟着裁剪",
  scopedMk.data.items.find((m) => m.id === "mkt_plugins").pluginCount === 2
  && scopedMk.data.items.find((m) => m.id === "mkt_skills").pluginCount === 2);

const scopedResolved = await req("/v1/marketplaces/mkt_plugins/resolved", { token: bizT });
ok("市场详情条目跟着裁剪", scopedResolved.data.item.plugins.length === 2);

const scopedDc = await req("/v1/me/desktop-config", { token: bizT });
ok("桌面配置带当前专家", scopedDc.data.activeExpert?.key === "contract-reviewer");
ok("桌面配置的专家带角色提示词", (scopedDc.data.activeExpert?.rolePrompt || "").length > 50);

// 范围外的能力不能被解析出来：这是裁剪是否真生效的关键
const outsideId = (await req("/v1/marketplaces/mkt_plugins/resolved", { token: adminT })).data.item.plugins
  .find((p) => !contractExpert.connectors.includes(p.name))?.id;
ok("范围外插件解析返回 404", outsideId ? (await req(`/v1/plugins/${outsideId}/resolved`, { token: bizT })).status === 404 : false);
const scopedBatch = await req(`/v1/resolved-plugins?pluginIds=${outsideId}`, { token: bizT });
ok("范围外插件批量解析进 failures", scopedBatch.data.failures?.[outsideId] === "not_in_expert_scope");

// 越权：成员不能切到没分配给自己的专家
const devExpert = adminExperts.data.items.find((e) => e.key === "dev-reviewer");
const crossSwitch = await req("/v1/me/active-expert", { method: "POST", token: bizT, body: { expertId: devExpert?.id || "exp_nope" } });
ok("切到未分配的专家返回 403", crossSwitch.status === 403, `实际 ${crossSwitch.status}`);

// 退出专家模式回到全量
const clearRes = await req("/v1/me/active-expert", { method: "POST", token: bizT, body: { expertId: "" } });
ok("清空专家返回 null", clearRes.data.activeExpertId === null);
const fullConns = await req("/v1/mcp-connections", { token: bizT });
ok("清空后连接器回到全量", fullConns.data.connections.length === connItems.length, `实际 ${fullConns.data.connections.length}`);

console.log("\n【清理与审计】");
await req(`/api/skills/${skillCreated.data.id}`, { method: "DELETE", token: adminT });
await req(`/api/experts/${created.data.id}`, { method: "DELETE", token: adminT });
await req(`/api/experts/${pubCreate.data.id}`, { method: "DELETE", token: adminT });
// 取足够多的记录：自测会写入几十条审计，limit=8 会把早期动作挤出窗口
const audit = (await req("/api/audit?limit=200", { token: adminT })).data;
ok("审计记录动作完整", audit.items.some((r) => r.action === "删除专家") && audit.items.some((r) => r.action === "新增技能"));

// 只校验本次运行写入的审计。历史记录里可能有旧版本漏记操作人的行，
// 那些不能靠改数据「修好」，也不该让当前代码背锅。
const freshAudit = (await req(`/api/audit?limit=200&since=${encodeURIComponent(runStartedAt)}`, { token: adminT })).data;
ok("本次运行的审计都记了操作人", freshAudit.items.length > 0 && freshAudit.items.every((r) => r.actor && r.actor !== "系统"),
  `${freshAudit.items.length} 条：${JSON.stringify([...new Set(freshAudit.items.map((r) => r.actor))])}`);

// 哈希链：任何一行被改/删，从这里开始对不上。
const chain = (await req("/api/audit/verify", { token: adminT })).data;
ok("审计链完整", chain.ok === true && chain.checked > 0, JSON.stringify(chain).slice(0, 200));

// 登录限流：拿一个不存在的账号试，避免把 admin 自己锁住（那会让后面的断言全挂）。
// 5 次失败后第 6 次必须 429，且锁定期间连正确密码也进不去。
const lockUser = `lockprobe_${Date.now()}`;
let lastCode = 0;
for (let i = 0; i < 6; i += 1) {
  lastCode = (await req("/api/auth/login", { method: "POST", body: { username: lockUser, password: "nope" } })).status;
}
ok("连续失败 6 次后返回 429", lastCode === 429, `实际 ${lastCode}`);
ok("锁定后管理员仍可正常登录（按账号+IP 组合锁，不误伤他人）", Boolean(await login("admin", "Admin@12345")));

console.log(`\n结果：通过 ${pass} 项，失败 ${fail} 项\n`);
process.exit(fail ? 1 : 0);
