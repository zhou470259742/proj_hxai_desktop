// 桌面端联调自检：连 Electron 的远程调试端口，看当前客户端实际拿到了什么。
//
//   node scripts/desktop-check.mjs            # 只报告
//   node scripts/desktop-check.mjs --shot a.png
//   node scripts/desktop-check.mjs --reload   # 先重载再报告
//
// 为什么不用 GUI 自动化：本机 osascript 没有辅助功能权限、进程也 kill 不动，
// 而 Electron 默认开着 DevTools 端口，CDP 是唯一稳的路子。
// 端口从应用数据目录的 DevToolsActivePort 读，不写死。
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const shotIndex = args.indexOf("--shot");
const shotPath = shotIndex >= 0 ? args[shotIndex + 1] : null;
const baseIndex = args.indexOf("--base");
const baseArg = baseIndex >= 0 ? args[baseIndex + 1] : null;
const doReload = args.includes("--reload");

function devtoolsPort() {
  const candidates =
    platform() === "darwin"
      ? [
          join(homedir(), "Library/Application Support/com.differentai.openwork/DevToolsActivePort"),
          join(homedir(), "Library/Application Support/OpenWork/DevToolsActivePort"),
        ]
      : [join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "openwork/DevToolsActivePort")];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    const port = readFileSync(file, "utf8").split("\n")[0].trim();
    if (port) return Number(port);
  }
  return null;
}

const port = devtoolsPort();
if (!port) {
  console.error("找不到 DevToolsActivePort —— 客户端没在跑，或没开远程调试。");
  process.exit(2);
}

let targets;
try {
  targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
} catch (error) {
  console.error(`连不上调试端口 ${port}：${error.message}`);
  process.exit(2);
}
const page = targets.find((t) => t.type === "page");
if (!page) {
  console.error("没有可用的页面目标。");
  process.exit(2);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
let nextId = 1;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve, { once: true });
  ws.addEventListener("error", reject, { once: true });
});
ws.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  }
});

await send("Runtime.enable");
await send("Page.enable");

const evaluate = async (expression) => {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails).slice(0, 300));
  return result.result.value;
};

if (doReload) {
  await send("Page.reload");
  await new Promise((r) => setTimeout(r, 14000));
}

// 桌面端不把 baseUrl 写进 localStorage（它直接读 bootstrap 文件），
// 所以这里给个默认值，必要时用 --base 覆盖。
const report = await evaluate(`(async () => {
  const out = {
    route: location.hash || "(root)",
    signedIn: Boolean(localStorage.getItem('openwork.den.authToken')),
    title: document.querySelector('[data-sidebar-brand]')?.innerText?.trim() || null,
    workMode: document.querySelector('[data-work-mode-trigger]')?.innerText?.replace(/\\n/g, ' · ') || null,
    workModeState: document.querySelector('[data-work-mode-state]')?.getAttribute('data-work-mode-state') || null,
  };
  const base = (localStorage.getItem('openwork.den.baseUrl') || ${JSON.stringify(baseArg || "http://127.0.0.1:8787")}).replace(/\\/+$/, '');
  out.baseUrl = base;
  const token = localStorage.getItem('openwork.den.authToken') || '';
  if (base && token) {
    const get = (p) => fetch(base + p, { headers: { authorization: 'Bearer ' + token } })
      .then((r) => r.json()).catch(() => null);
    const [experts, conns, dc] = await Promise.all([
      get('/v1/me/experts'), get('/v1/mcp-connections'), get('/v1/me/desktop-config'),
    ]);
    out.activeExpert = dc?.activeExpert?.name || null;
    out.rolePromptChars = (dc?.activeExpert?.rolePrompt || '').length;
    out.connectors = conns?.connections?.map((c) => c.name) || null;
    out.availableExperts = experts?.items?.length ?? null;
  }
  return JSON.stringify(out, null, 1);
})()`);

console.log(report);

if (shotPath) {
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(shotPath, Buffer.from(data, "base64"));
  console.log(`\n截图：${shotPath}`);
}

ws.close();
