#!/usr/bin/env node
/**
 * 模型下发链路验证
 *
 * 覆盖「后台配置 → provider_config.json → 网关 → 上游」全链路，
 * 关键点是**不依赖真实上游**：脚本自己起一个 mock 模型服务，
 * 把供应商 base_url 临时指过去，跑完再还原。
 *
 * 若不希望改数据库，可设 SKIP_DB=1 跳过「改 base_url + 真实调用」的部分，
 * 只验证配置结构与鉴权（适合生产环境自查）。
 *
 * 用法（后台需已启动）：
 *   node scripts/e2e-model-gateway.mjs
 *   BASE=http://127.0.0.1:8787 node scripts/e2e-model-gateway.mjs
 * 想连 4b「客户端真实拉取」一起跑，用 harness 自带的 tsx：
 *   ../../../hxai-harness/node_modules/.bin/tsx scripts/e2e-model-gateway.mjs
 */
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const BASE = process.env.BASE || "http://127.0.0.1:8787";
const USER = process.env.ADMIN_USER || "admin";
const PASS = process.env.ADMIN_PASS || "Admin@12345";
const SKIP_DB = process.env.SKIP_DB === "1";

/**
 * ZCode 客户端源码根目录（`hxai-harness/`）。按脚本位置推导，不依赖 cwd。
 * 4b 段直接 import 客户端的 `fetchRemoteProviderConfig` 跑真实拉取，
 * 换了目录（比如只 checkout 了后台）就用 ZCODE_REPO 指过去；找不到则跳过该段。
 */
const ZCODE_REPO =
  process.env.ZCODE_REPO ||
  resolve(dirname(fileURLToPath(import.meta.url)), "../../../../hxai-harness");
const CLIENT_MODULE = join(ZCODE_REPO, "packages/desktop/src/main/hxRemoteConfig.ts");

let passed = 0;
let failed = 0;

function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function api(path, { method = "GET", token, body } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  let payload;
  if (body !== undefined) {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, { method, headers, body: payload });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

/* ------------------------- mock 上游（OpenAI 兼容） ------------------------- */
function startMockUpstream() {
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    let body = {};
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    } catch {
      // 忽略
    }
    const reply = `MOCK_OK model=${body.model}`;
    if (body.stream) {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(
        `data: ${JSON.stringify({
          id: "c1",
          object: "chat.completion.chunk",
          model: body.model,
          choices: [{ index: 0, delta: { role: "assistant", content: reply }, finish_reason: null }],
        })}\n\n`
      );
      res.write(
        `data: ${JSON.stringify({
          id: "c1",
          object: "chat.completion.chunk",
          model: body.model,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        })}\n\n`
      );
      res.write("data: [DONE]\n\n");
      return res.end();
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        id: "c1",
        object: "chat.completion",
        model: body.model,
        choices: [{ index: 0, message: { role: "assistant", content: reply }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      })
    );
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

async function main() {
  console.log(`\n后台：${BASE}\n`);

  console.log("1) 登录");
  const login = await api("/api/auth/login", { method: "POST", body: { username: USER, password: PASS } });
  const token = login.data?.token;
  cachedSession = token || "";
  check("登录拿到令牌", typeof token === "string" && token.length > 20);
  if (!token) return finish();

  console.log("\n2) 供应商与别名");
  const provList = await api("/api/providers", { token });
  const providers = provList.data.items || [];
  check("存在启用的供应商", providers.some((p) => p.status === "enabled"));
  const aliasList = await api("/api/aliases", { token });
  const aliases = (aliasList.data.items || []).filter((a) => a.status === "enabled");
  check("存在启用的别名", aliases.length > 0, String(aliases.length));

  console.log("\n3) 下发配置结构（strict schema）");
  const cfg = await api("/v1/provider-config.json", { token: await gatewayToken() });
  check("带令牌可拉取配置", cfg.status === 200, JSON.stringify(cfg.data).slice(0, 120));
  const conf = cfg.data?.config;
  check("顶层只有 schemaVersion/config", JSON.stringify(Object.keys(cfg.data || {}).sort()) === '["config","schemaVersion"]', Object.keys(cfg.data || {}).join(","));
  check("config 不含多余键", Object.keys(conf || {}).every((k) => ["providerOrder", "providerConfigRules", "modelConfigRules", "defaultModelSelection"].includes(k)), Object.keys(conf || {}).join(","));
  check("modelConfigRules 两个数组都在", Array.isArray(conf?.modelConfigRules?.providerModelRules) && Array.isArray(conf?.modelConfigRules?.manualProviderModelRules));
  const rules = conf?.providerConfigRules?.providerRules || [];
  check("至少下发一个供应商", rules.length > 0);
  check("apiKey 不是上游密钥", rules.every((r) => !String(r.config?.access?.apiKey || "").includes("sk-")), rules.map((r) => r.config?.access?.apiKey).join(","));
  check("apiKey 是网关令牌", rules.every((r) => String(r.config?.access?.apiKey || "").startsWith("owg_")));
  check("baseUrl 指向控制面网关", rules.every((r) => r.config?.api?.baseUrl?.includes("/v1/llm/")), rules.map((r) => r.config?.api?.baseUrl).join(","));
  check("网关模式只暴露别名", rules.every((r) => r.config.personalModelIds.every((m) => aliases.some((a) => a.key === m))), rules.flatMap((r) => r.config.personalModelIds).join(","));
  check("默认模型指向别名", Boolean(conf?.defaultModelSelection) && aliases.some((a) => a.key === conf.defaultModelSelection.modelId), JSON.stringify(conf?.defaultModelSelection));
  check("响应里没有上游真实模型名", !JSON.stringify(cfg.data).match(/deepseek-v3|deepseek-r1|qwen2\.5/u));

  console.log("\n4) 鉴权");
  const anon = await api("/v1/provider-config.json");
  check("匿名拉取被拒（401）", anon.status === 401, String(anon.status));
  const badTok = await api("/v1/provider-config.json", { token: "owg_not_a_real_token" });
  check("伪造令牌被拒（401）", badTok.status === 401, String(badTok.status));
  const directNoTok = await fetch(`${BASE}/v1/provider-config.json?direct=1`);
  check("direct=1 无令牌被拒（401）", directNoTok.status === 401, String(directNoTok.status));

  console.log("\n4b) 真实客户端拉取（ZCode fetchRemoteProviderConfig）");
  const gw = await gatewayToken();
  await checkClientSync(cfg.data, gw);

  const directWithGw = await fetch(`${BASE}/v1/provider-config.json?direct=1`, {
    headers: { authorization: `Bearer ${gw}` },
  });
  check("direct=1 用网关令牌被拒（不能换到上游密钥）", directWithGw.status === 401, String(directWithGw.status));

  if (SKIP_DB) return finish();

  console.log("\n5) 网关调用（mock 上游）");
  const { server, port } = await startMockUpstream();
  const provider = providers.find((p) => p.id === aliases[0]?.providerRef) || providers[0];
  const originalUrl = provider.baseUrl;
  const targetAlias = aliases.find((a) => a.providerRef === provider.id) || aliases[0];
  try {
    const patch = await api(`/api/providers/${provider.id}`, {
      method: "PATCH",
      token,
      body: { baseUrl: `http://127.0.0.1:${port}/v1` },
    });
    check("临时改 base_url 成功", patch.status === 200, JSON.stringify(patch.data).slice(0, 100));

    const res = await fetch(`${BASE}/v1/llm/${provider.key}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${gw}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: targetAlias.key,
        stream: true,
        messages: [{ role: "user", content: "ping" }],
      }),
    });
    const text = await res.text();
    check("网关返回 200", res.status === 200, String(res.status));
    check("响应是 SSE 流", text.includes("data: "), text.slice(0, 80));
    check("响应内容来自 mock 上游", text.includes("MOCK_OK"));
    check("别名已在网关侧解析为真实模型", res.headers.get("x-model-alias") === targetAlias.key && res.headers.get("x-model-upstream") === targetAlias.targetModel, `${res.headers.get("x-model-alias")} → ${res.headers.get("x-model-upstream")}`);
    check("上游收到的不是别名", text.includes(`model=${targetAlias.targetModel}`), text.slice(0, 160));
  } finally {
    // 无论成败都还原，避免把真实环境指到 mock 上。
    await api(`/api/providers/${provider.id}`, { method: "PATCH", token, body: { baseUrl: originalUrl } });
    server.close();
  }

  finish();
}

/**
 * 用**客户端自己的代码**拉一次配置并与服务端返回逐项比对。
 *
 * 前面的 3) 只证明服务端返回值长得对；这一节证明客户端真能把这份响应用起来：
 * `fetchRemoteProviderConfig` 有自己的一套校验（schemaVersion、config 形状、
 * 供应商非空、原子写盘），服务端多一个键或少一个数组都会在这里暴露。
 *
 * Node ≥ 24 原生剥离 TS 类型，可以直接 import 客户端的 .ts 源文件；
 * 但客户端源码内部用 `./hxBrand.js` 这种 TS 风格后缀引用同目录 .ts，
 * 原生剥离不做 .js→.ts 映射，所以这段只有在 tsx 下才跑得通（找不到就跳过，不算失败）。
 */
async function checkClientSync(serverPayload, gwToken) {
  let mod;
  try {
    mod = await import(pathToFileURL(CLIENT_MODULE).href);
  } catch (error) {
    console.log(
      `  - 跳过客户端拉取比对：模块加载失败（${CLIENT_MODULE}），` +
        `用 tsx 跑本脚本才会执行这一段 — ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }
  check("能加载客户端模块", typeof mod.fetchRemoteProviderConfig === "function");

  const dir = await mkdtemp(join(tmpdir(), "owcp-client-sync-"));
  const target = join(dir, "provider_config.json");
  const baseEnv = { ZCODE_PERSONAL_PROVIDER_CONFIG_FILE: target };
  try {
    const noToken = await mod.fetchRemoteProviderConfig({
      ...baseEnv,
      ZCODE_REMOTE_PROVIDER_CONFIG_URL: `${BASE}/v1/provider-config.json`,
    });
    check("客户端无令牌拉取失败且不写盘", noToken.loaded === false && noToken.error === "HTTP 401", JSON.stringify(noToken));
    check("失败时没有留下空文件", await missing(target));

    const synced = await mod.fetchRemoteProviderConfig({
      ...baseEnv,
      ZCODE_REMOTE_PROVIDER_CONFIG_URL: `${BASE}/v1/provider-config.json`,
      ZCODE_REMOTE_CONFIG_TOKEN: gwToken,
    });
    const expectedCount = serverPayload?.config?.providerConfigRules?.providerRules?.length ?? -1;
    check("客户端带令牌拉取成功", synced.loaded === true, JSON.stringify(synced));
    check("落盘路径符合预期", synced.path === target, String(synced.path));
    check("供应商数与服务端一致", synced.providerCount === expectedCount, `${synced.providerCount} vs ${expectedCount}`);
    check("落盘用原子写（无 .hx-tmp 残留）", await missing(`${target}.hx-tmp`));

    let saved;
    try {
      saved = JSON.parse(await readFile(target, "utf8"));
    } catch (error) {
      check("落盘文件是合法 JSON", false, error instanceof Error ? error.message : String(error));
      return;
    }
    check("落盘文件是合法 JSON", true);
    check("落盘 schemaVersion 为 1", saved.schemaVersion === 1, String(saved.schemaVersion));
    check("落盘顶层只有 schemaVersion/config", JSON.stringify(Object.keys(saved).sort()) === '["config","schemaVersion"]', Object.keys(saved).join(","));
    check("落盘内容与服务端下发一致", JSON.stringify(saved) === JSON.stringify(serverPayload));

    const savedRules = saved.config?.providerConfigRules?.providerRules || [];
    const aliasKeys = (await api("/api/aliases", { token: await sessionToken() })).data.items
      .filter((a) => a.status === "enabled")
      .map((a) => a.key);
    check("落盘后 apiKey 是网关令牌", savedRules.every((r) => String(r.config?.access?.apiKey || "").startsWith("owg_")));
    check("落盘后模型全是别名", savedRules.every((r) => r.config.personalModelIds.every((m) => aliasKeys.includes(m))), savedRules.flatMap((r) => r.config.personalModelIds).join(","));
    check("落盘后不含上游密钥", !JSON.stringify(saved).match(/sk-[A-Za-z0-9]/u));
    check("落盘后不含真实模型名", !JSON.stringify(saved).match(/deepseek-v3|deepseek-r1|qwen2\.5/u));
    check("落盘后默认模型指向别名", aliasKeys.includes(saved.config?.defaultModelSelection?.modelId), JSON.stringify(saved.config?.defaultModelSelection));

    // 服务端挂在别的地址（反代）时，客户端写下的 baseUrl 必须来自服务端那份，
    // 不能是请求地址推导出来的——否则反代后面的部署会把客户端指向错的地方。
    const declaredBase = savedRules[0]?.config?.api?.baseUrl || "";
    check("baseUrl 指向服务端声明的网关地址", declaredBase.includes("/v1/llm/"), declaredBase);

    const size = await stat(target);
    check("落盘文件非空", size.size > 200, `${size.size} B`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** 文件不存在时返回 true（用于断言「没写」）。 */
async function missing(path) {
  try {
    await stat(path);
    return false;
  } catch {
    return true;
  }
}

let cachedSession;
/** 复用一次登录，避免每个辅助函数各登一次。 */
async function sessionToken() {
  if (!cachedSession) {
    const login = await api("/api/auth/login", { method: "POST", body: { username: USER, password: PASS } });
    cachedSession = login.data?.token || "";
  }
  return cachedSession;
}

/** 取网关令牌：优先用已登录信息里下发的那个。 */
async function gatewayToken() {
  const token = await sessionToken();
  const llm = await api("/v1/llm-providers", { token });
  return llm.data?.llmProviders?.[0]?.providerConfig?.options?.apiKey || "";
}

function finish() {
  console.log(`\n结果：${passed} 通过 / ${failed} 失败\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("验证脚本异常：", error);
  process.exit(1);
});
