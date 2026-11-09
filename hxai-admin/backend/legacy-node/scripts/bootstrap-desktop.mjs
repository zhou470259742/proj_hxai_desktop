// 给本机 OpenWork 桌面客户端写入控制面接入配置
//   node scripts/bootstrap-desktop.mjs [--base-url http://127.0.0.1:8787] [--delete]
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};

function bootstrapPath() {
  if (platform() === "win32") {
    const base = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
    return join(base, "openwork", "desktop-bootstrap.json");
  }
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "openwork", "desktop-bootstrap.json");
}

const target = bootstrapPath();

if (args.includes("--delete")) {
  rmSync(target, { force: true });
  console.log(`已删除 ${target}`);
  console.log("客户端将回落到自带默认控制面（app.openworklabs.com）。");
  process.exit(0);
}

const baseUrl = flag("--base-url", "http://127.0.0.1:8787");
const brandAppName = flag("--brand", "和信 AI 工作台");

const config = {
  baseUrl,
  apiBaseUrl: baseUrl,
  requireSignin: true,
  brandAppName,
  writtenAt: new Date().toISOString(),
};

mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, JSON.stringify(config, null, 2) + "\n", "utf8");

console.log(`已写入 ${target}`);
console.log(readFileSync(target, "utf8"));
console.log("重启桌面客户端后生效。撤销：node scripts/bootstrap-desktop.mjs --delete");
