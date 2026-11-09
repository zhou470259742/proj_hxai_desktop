#!/usr/bin/env node
/**
 * 插件市场端到端验证
 *
 * 覆盖完整链路：
 *   1. 登录管理后台
 *   2. 上传一个带 manifest 的插件包（合法）
 *   3. 上传缺少 manifest 的包（必须被拒）
 *   4. 上传 name 与插件标识不一致的包（必须被拒）
 *   5. 拉取市场清单，确认 zip 源 + sha256 正确
 *   6. 下载包并校验 sha256 与清单一致
 *   7. 编译一个专家，确认包内 agent / skills 结构
 *   8. 发布专家到市场，确认 dependencies 注入
 *
 * 用法（后台需已启动）：
 *   node scripts/e2e-marketplace.mjs
 *   BASE=http://127.0.0.1:8787 node scripts/e2e-marketplace.mjs
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createZip, listZipEntries, readZipEntry, findPluginManifest } from "../src/zip.mjs";

const BASE = process.env.BASE || "http://127.0.0.1:8787";
const USER = process.env.ADMIN_USER || "admin";
const PASS = process.env.ADMIN_PASS || "Admin@12345";
const PLUGIN_KEY = process.env.PLUGIN_KEY || "oa-system";

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

async function api(path, { method = "GET", token, body, contentType } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  let payload;
  if (body !== undefined) {
    if (contentType === "application/zip") {
      headers["content-type"] = "application/zip";
      payload = body;
    } else {
      headers["content-type"] = "application/json";
      payload = JSON.stringify(body);
    }
  }
  const res = await fetch(`${BASE}${path}`, { method, headers, body: payload });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data, res };
}

function buildPlugin(input) {
  const root = input.key;
  const files = [
    {
      name: `${root}/.zcode-plugin/plugin.json`,
      data: JSON.stringify(
        {
          name: input.manifestName ?? input.key,
          version: input.version || "1.0.0",
          description: input.description || "E2E 测试插件",
          skills: "skills",
        },
        null,
        2
      ),
    },
    {
      name: `${root}/skills/${input.skillKey || "demo-skill"}/SKILL.md`,
      data: `---\nname: ${input.skillKey || "demo-skill"}\ndescription: "E2E 测试技能"\n---\n\n# 测试技能\n\n用于验证打包与安装链路。\n`,
    },
  ];
  if (input.withoutManifest) files.shift();
  return createZip(files);
}

async function main() {
  console.log(`\n后台：${BASE}\n`);

  // 1. 健康检查 + 登录
  console.log("1) 登录");
  const health = await api("/v1/system/health");
  check("健康检查返回 ok", health.status === 200 && health.data.status === "ok", JSON.stringify(health.data));

  const login = await api("/api/auth/login", { method: "POST", body: { username: USER, password: PASS } });
  const token = login.data?.token;
  check("登录拿到令牌", typeof token === "string" && token.length > 20);
  if (!token) return finish();

  // 找到目标插件
  const list = await api("/api/plugins", { token });
  const plugins = list.data.items || list.data;
  const target = plugins.find((p) => p.key === PLUGIN_KEY);
  check(`插件 ${PLUGIN_KEY} 存在`, Boolean(target));
  if (!target) return finish();

  // 2. 上传合法包
  console.log("\n2) 上传合法包");
  const good = buildPlugin({ key: PLUGIN_KEY, version: "9.9.9", description: "E2E 合法包" });
  const up = await api(`/api/plugins/${target.id}/package`, {
    method: "POST",
    token,
    body: good,
    contentType: "application/zip",
  });
  check("上传成功", up.status === 200, JSON.stringify(up.data));
  const expectedSha = createHash("sha256").update(good).digest("hex");
  check("返回 sha256 与本地一致", up.data?.sha256 === expectedSha, `${up.data?.sha256} vs ${expectedSha}`);
  check("识别到 manifest", up.data?.manifestName === PLUGIN_KEY, up.data?.manifestName);
  check("识别到技能数量", up.data?.skillCount === 1, String(up.data?.skillCount));

  // 3. 缺清单必须被拒
  console.log("\n3) 缺清单的包应被拒");
  const bad = buildPlugin({ key: PLUGIN_KEY, withoutManifest: true });
  const badUp = await api(`/api/plugins/${target.id}/package`, {
    method: "POST",
    token,
    body: bad,
    contentType: "application/zip",
  });
  check("返回 400", badUp.status === 400, String(badUp.status));
  check("提示缺少清单", /缺少插件清单/u.test(badUp.data?.message || ""), badUp.data?.message);

  // 4. 名字不一致必须被拒
  console.log("\n4) 清单名与插件标识不一致应被拒");
  const mismatch = buildPlugin({ key: PLUGIN_KEY, manifestName: "another-plugin" });
  const mismatchUp = await api(`/api/plugins/${target.id}/package`, {
    method: "POST",
    token,
    body: mismatch,
    contentType: "application/zip",
  });
  check("返回 400", mismatchUp.status === 400, String(mismatchUp.status));
  check("提示名称不一致", /不一致/u.test(mismatchUp.data?.message || ""), mismatchUp.data?.message);

  // 5. 市场清单
  console.log("\n5) 市场清单");
  const market = await api("/v1/marketplace.json");
  check("清单可匿名读取", market.status === 200);
  const entry = (market.data?.plugins || []).find((p) => p.name === PLUGIN_KEY);
  check("清单含目标插件", Boolean(entry));
  check("源类型是 zip", entry?.source?.type === "zip", JSON.stringify(entry?.source));
  check("清单 sha256 与上传一致", entry?.source?.sha256 === up.data?.sha256);

  // 6. 下载并校验
  console.log("\n6) 包下载与校验");
  // 清单里的包地址由后台 OWCP_PUBLIC_BASE_URL 生成，可能不等于脚本访问的 BASE
  // （反代部署，或残留的测试环境变量）。不可达时给出可操作的诊断，
  // 而不是抛一个 ECONNRESET 堆栈——那个堆栈看不出问题在哪。
  let dl;
  try {
    dl = await fetch(entry.source.url);
  } catch (error) {
    check(
      "下载地址可达",
      false,
      `${entry.source.url} — ${error instanceof Error ? error.message : String(error)}；` +
        `请确认后台 OWCP_PUBLIC_BASE_URL 与 BASE(${BASE}) 指向同一地址`
    );
    return finish();
  }
  const buf = Buffer.from(await dl.arrayBuffer());
  check("下载返回 200", dl.status === 200, String(dl.status));
  check("下载字节数一致", buf.length === up.data.size, `${buf.length} vs ${up.data.size}`);
  const dlSha = createHash("sha256").update(buf).digest("hex");
  check("下载内容 sha256 一致", dlSha === up.data.sha256, `${dlSha} vs ${up.data.sha256}`);
  let entriesOk = false;
  try {
    entriesOk = listZipEntries(buf).length > 0;
  } catch (error) {
    entriesOk = false;
  }
  check("下载包可解析为 ZIP", entriesOk);

  // 7. 专家编译
  console.log("\n7) 专家编译");
  const experts = await api("/api/experts", { token });
  const expert = (experts.data.items || []).find((e) => e.status === "published");
  check("存在已发布专家", Boolean(expert));
  if (expert) {
    const preview = await api(`/api/experts/${expert.id}/package/preview`, { token });
    check("预览返回 200", preview.status === 200, JSON.stringify(preview.data));
    const names = (preview.data?.files || []).map((f) => f.name);
    check("包内含 agent markdown", names.some((n) => /\/agents\/.+\.md$/u.test(n)), names.join(", "));
    check("包内含插件清单", names.some((n) => n.endsWith(".zcode-plugin/plugin.json")));
    check(
      "技能数与专家白名单一致",
      preview.data?.skillCount === (expert.skillIds || []).length,
      `${preview.data?.skillCount} vs ${(expert.skillIds || []).length}`
    );

    // 8. 发布 + 依赖
    console.log("\n8) 发布专家并注入依赖");
    const pub = await api(`/api/experts/${expert.id}/publish`, { method: "POST", token });
    check("发布返回 200", pub.status === 200, JSON.stringify(pub.data));
    check("返回 pluginId", typeof pub.data?.pluginId === "string");

    const market2 = await api("/v1/marketplace.json");
    const e2 = (market2.data?.plugins || []).find((p) => p.name === expert.key);
    check("市场含该专家插件", Boolean(e2));
    if (e2) {
      const deps = e2.dependencies || [];
      check(
        "依赖都是市场内已打包的插件",
        deps.every((d) => (market2.data.plugins || []).some((p) => p.name === d && p.source?.type === "zip")),
        deps.join(", ")
      );
      // 校验下载后包结构
      const dl2 = await fetch(e2.source.url);
      const buf2 = Buffer.from(await dl2.arrayBuffer());
      check("专家包可下载", dl2.status === 200, String(dl2.status));
      check("专家包 sha256 匹配", createHash("sha256").update(buf2).digest("hex") === e2.source.sha256);
      const names2 = listZipEntries(buf2).map((x) => x.name);
      const agentPath = names2.find((n) => /\/agents\/.+\.md$/u.test(n));
      check("专家包内含 agent", Boolean(agentPath));
      if (agentPath) {
        const md = findPluginManifest(buf2); // 顺带确认 manifest 也读得到
        check("专家包 manifest 有效", Boolean(md.manifestPath));
        const agent = readZipEntry(
          buf2,
          listZipEntries(buf2).find((x) => x.name === agentPath)
        ).toString("utf8");
        check("agent 有 permissionMode", /^permissionMode:\s*\S+/mu.test(agent), agent.split("\n").slice(0, 6).join(" | "));
        check("agent 正文即专家提示词", agent.includes("\n---\n\n") && agent.length > 100);
      }
    }
  }

  finish();
}

function finish() {
  console.log(`\n结果：${passed} 通过 / ${failed} 失败\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("验证脚本异常：", error);
  process.exit(1);
});
