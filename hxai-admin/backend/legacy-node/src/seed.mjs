import { seedIfEmpty, resetAll, db } from "./db.mjs";

if (process.argv.includes("--reset")) {
  resetAll();
  console.log("已清空全部数据");
}
const created = seedIfEmpty();
const n = db.prepare("SELECT COUNT(*) AS c FROM users").get().c;
console.log(created ? `已写入演示数据，用户 ${n} 个` : `数据已存在（用户 ${n} 个），跳过`);
console.log("管理员：admin / Admin@12345");
