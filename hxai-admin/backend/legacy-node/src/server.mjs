import { createApp } from "./http.mjs";
import { CONFIG } from "./config.mjs";
import { seedIfEmpty, sealAuditChain, db } from "./db.mjs";
import { attachUser, enforceCsrf } from "./auth.mjs";
import { registerRoutes } from "./api.mjs";

const seeded = seedIfEmpty();
// 给哈希链启用前写入的历史记录补链（一次性、幂等；返回 0 表示无历史行）。
const sealed = sealAuditChain();

const app = createApp();
// 先认身份，再校验写操作来源：CSRF 判断的前提是「这次是不是靠 Cookie 认出来的」。
app.before = async (ctx) => {
  await attachUser(ctx);
  enforceCsrf(ctx);
};
registerRoutes(app);

app.listen({ port: CONFIG.port, host: CONFIG.host, publicDir: CONFIG.publicDir });

const users = db.prepare("SELECT COUNT(*) AS c FROM users").get().c;
console.log("");
console.log("  和信 AI 工作台 · 管理控制面");
console.log("  ────────────────────────────────────────────");
console.log(`  管理后台   http://${CONFIG.host}:${CONFIG.port}/`);
console.log(`  接口前缀   http://${CONFIG.host}:${CONFIG.port}/api/`);
console.log(`  下发入口   http://${CONFIG.host}:${CONFIG.port}/v1/desktop/manifest`);
console.log(`  数据文件   ${CONFIG.dataDir}/control-plane.db`);
console.log(`  用户数     ${users}${seeded ? "（已写入演示数据）" : ""}`);
if (sealed.sealed > 0) console.log(`  审计封链   ${sealed.sealed} 条历史记录已补算哈希（取证自此有效）`);
console.log("");
console.log("  默认管理员 admin / Admin@12345  —— 首次登录后请立即改密码");
console.log("");
