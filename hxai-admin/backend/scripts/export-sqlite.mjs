#!/usr/bin/env node
/**
 * 把 admin-console 的 SQLite 控制面数据导出为 MySQL 可执行 SQL。
 *
 * 只做数据搬运，不建表：目标库先由 Go 服务的 AutoMigrate 建好结构，
 * 再执行本脚本产物。可重复执行（ON DUPLICATE KEY UPDATE）。
 *
 * 用法：
 *   node scripts/export-sqlite.mjs --db legacy-node/data/control-plane.db --out migrations/from-sqlite.sql
 */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const args = process.argv.slice(2);
const readArg = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const dbPath = resolve(readArg("db", "legacy-node/data/control-plane.db"));
const outPath = resolve(readArg("out", "migrations/from-sqlite.sql"));

const TABLES = [
  ["users", ["id", "username", "display_name", "email", "department", "role", "status", "password_hash", "created_at", "last_login_at"]],
  ["sessions", ["jti", "user_id", "created_at", "expires_at", "revoked", "ip", "user_agent"]],
  ["settings", ["key", "value"]],
  ["llm_providers", ["id", "key", "name", "vendor", "base_url", "api_key", "provider_id", "status", "note", "created_at", "updated_at"]],
  ["model_aliases", ["id", "key", "name", "description", "badge", "icon", "provider_ref", "target_model", "fallback_model", "capabilities_json", "context_tokens", "status", "sort_order", "created_at", "updated_at"]],
  ["plugins", ["id", "key", "name", "summary", "category", "transport", "endpoint", "command", "args_json", "auth_type", "auth_config_json", "visibility", "version", "status", "owner", "package_file", "package_sha256", "package_size", "dependencies_json", "created_at", "updated_at"]],
  ["skills", ["id", "key", "name", "summary", "category", "version", "trigger_desc", "content", "status", "author", "installs", "created_at", "updated_at"]],
  ["experts", ["id", "key", "name", "role_title", "emoji", "summary", "role_prompt", "model_provider", "model_name", "permission_mode", "plugin_ids_json", "skill_ids_json", "visibility", "status", "owner", "created_at", "updated_at"]],
  ["grants", ["id", "expert_id", "subject_type", "subject_id", "created_at"]],
  ["user_expert_state", ["user_id", "active_expert_id", "updated_at"]],
  ["client_tokens", ["id", "label", "token_hash", "created_at", "created_by", "revoked"]],
  ["handoffs", ["grant", "user_id", "created_at", "expires_at", "consumed_at", "ip"]],
  ["audit_logs", ["id", "actor_id", "actor_name", "action", "target_type", "target_id", "target_name", "detail_json", "ip", "created_at", "prev_hash", "hash"]],
];

const quoteIdent = (name) => `\`${name.replace(/`/g, "``")}\``;

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** MySQL DATETIME 不接受 ISO 的 T/Z；统一转成 UTC 的 YYYY-MM-DD HH:MM:SS.mmm。 */
function normalizeTimestamp(column, value) {
  if (typeof value !== "string" || !column.endsWith("_at") || !ISO_TIMESTAMP.test(value)) {
    return value;
  }
  return `${value.slice(0, 10)} ${value.slice(11, 23)}`;
}

function quoteValue(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  if (value instanceof Uint8Array) return `X'${Buffer.from(value).toString("hex")}'`;
  const text = String(value)
    .replace(/\\/g, "\\\\")
    .replace(/\0/g, "\\0")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/'/g, "''");
  return `'${text}'`;
}

const db = new DatabaseSync(dbPath, { readOnly: true });
const lines = [
  "-- 由 scripts/export-sqlite.mjs 生成：SQLite 控制面 → MySQL",
  `-- 源库: ${dbPath}`,
  `-- 生成时间: ${new Date().toISOString()}`,
  "SET NAMES utf8mb4;",
  "SET FOREIGN_KEY_CHECKS = 0;",
  "",
];

let total = 0;
for (const [table, columns] of TABLES) {
  const exists = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table);
  if (!exists) {
    lines.push(`-- 跳过 ${table}（源库无此表）`, "");
    continue;
  }
  const rows = db.prepare(`SELECT ${columns.map(quoteIdent).join(", ")} FROM ${quoteIdent(table)}`).all();
  if (rows.length === 0) {
    lines.push(`-- ${table}: 0 行`, "");
    continue;
  }
  const columnList = columns.map(quoteIdent).join(", ");
  const updates = columns
    .filter((column) => column !== "id" && column !== "jti" && column !== "key" && column !== "user_id" && column !== "grant")
    .map((column) => `${quoteIdent(column)} = VALUES(${quoteIdent(column)})`)
    .join(", ");
  const suffix = updates ? ` ON DUPLICATE KEY UPDATE ${updates}` : "";
  lines.push(`-- ${table}: ${rows.length} 行`);
  for (const row of rows) {
    const values = columns
      .map((column) => quoteValue(normalizeTimestamp(column, row[column])))
      .join(", ");
    lines.push(`INSERT INTO ${quoteIdent(table)} (${columnList}) VALUES (${values})${suffix};`);
  }
  lines.push("");
  total += rows.length;
}

const lastAudit = db.prepare("SELECT hash FROM audit_logs WHERE hash IS NOT NULL AND hash <> '' ORDER BY id DESC LIMIT 1").get();
lines.push(
  "-- 审计链表头接续最后一条已封链记录，保证迁移后 /api/audit/verify 从源头连续",
  `INSERT INTO \`audit_chain_head\` (\`id\`, \`hash\`) VALUES (1, ${quoteValue(lastAudit?.hash ?? "")}) ON DUPLICATE KEY UPDATE \`hash\` = VALUES(\`hash\`);`,
  "SET FOREIGN_KEY_CHECKS = 1;",
  "",
);

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, lines.join("\n"), "utf8");
db.close();
console.log(`已导出 ${total} 行到 ${outPath}`);
