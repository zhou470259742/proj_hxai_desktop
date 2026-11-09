import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { CONFIG } from "./config.mjs";
import { hashPassword } from "./crypto.mjs";

mkdirSync(CONFIG.dataDir, { recursive: true });
mkdirSync(join(CONFIG.dataDir, "uploads"), { recursive: true });

export const db = new DatabaseSync(join(CONFIG.dataDir, "control-plane.db"));
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

export const newId = (prefix) => `${prefix}_${randomBytes(6).toString("hex")}`;
export const nowIso = () => new Date().toISOString();

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  email TEXT,
  department TEXT,
  role TEXT NOT NULL DEFAULT 'member',           -- admin | publisher | member
  status TEXT NOT NULL DEFAULT 'active',         -- active | disabled
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  jti TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0,
  ip TEXT,
  user_agent TEXT
);

CREATE TABLE IF NOT EXISTS plugins (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  summary TEXT,
  category TEXT,                                  -- 办公协同 | 业务系统 | 数据 | 研发 | 通讯
  transport TEXT NOT NULL DEFAULT 'streamable_http',  -- streamable_http | sse | stdio
  endpoint TEXT,
  command TEXT,
  args_json TEXT DEFAULT '[]',
  auth_type TEXT NOT NULL DEFAULT 'oauth',        -- oauth | bearer | none
  auth_config_json TEXT DEFAULT '{}',
  visibility TEXT NOT NULL DEFAULT 'all',         -- all | restricted | admin
  version TEXT DEFAULT '1.0.0',
  status TEXT NOT NULL DEFAULT 'enabled',         -- enabled | disabled | draft
  owner TEXT,
  package_file TEXT,                              -- 已上传的插件包文件名
  package_sha256 TEXT,                            -- 包内容 SHA-256（客户端校验）
  package_size INTEGER,
  dependencies_json TEXT DEFAULT '[]',            -- 依赖的其他插件 key（写进市场清单，客户端自动装）
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  summary TEXT,
  category TEXT,
  version TEXT NOT NULL DEFAULT '1.0.0',
  trigger_desc TEXT,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published',       -- published | draft | offline
  author TEXT,
  installs INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS experts (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role_title TEXT,
  emoji TEXT DEFAULT '🧭',
  summary TEXT,
  role_prompt TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '1.0.0',
  model_provider TEXT DEFAULT 'internal',
  model_name TEXT DEFAULT 'deepseek-v3',
  permission_mode TEXT NOT NULL DEFAULT 'confirm_write', -- read_only | confirm_write | full
  plugin_ids_json TEXT DEFAULT '[]',
  skill_ids_json TEXT DEFAULT '[]',
  visibility TEXT NOT NULL DEFAULT 'all',         -- all | restricted | private
  status TEXT NOT NULL DEFAULT 'published',       -- published | draft | offline
  owner TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS grants (
  id TEXT PRIMARY KEY,
  expert_id TEXT NOT NULL REFERENCES experts(id) ON DELETE CASCADE,
  subject_type TEXT NOT NULL,                     -- user | department | role
  subject_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id TEXT,
  actor_name TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  target_name TEXT,
  detail_json TEXT DEFAULT '{}',
  ip TEXT,
  created_at TEXT NOT NULL,
  -- 哈希链：prev_hash 是上一条的 hash，hash = sha256(prev_hash + 本行全部业务字段)。
  -- 删改任意一行都会让其后的所有 hash 对不上，/api/audit/verify 能发现。
  -- 这不是防「有库写权限的人」（他能重算整条链），而是防「改了没痕迹」。
  prev_hash TEXT,
  hash TEXT
);

CREATE TABLE IF NOT EXISTS llm_providers (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  vendor TEXT NOT NULL DEFAULT 'openai-compatible',   -- openai-compatible | deepseek | azure | qwen | custom
  base_url TEXT NOT NULL,
  api_key TEXT,                                        -- 仅服务端保管，永不下发
  provider_id TEXT NOT NULL,                           -- 客户端识别的 providerId
  status TEXT NOT NULL DEFAULT 'enabled',              -- enabled | disabled
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS model_aliases (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,                                  -- 用户看到的名字：标准 / 高级
  description TEXT,                                    -- 用户看到的一句话
  badge TEXT,                                          -- 档位系数：0.1X / 1X
  icon TEXT DEFAULT '⚡',
  provider_ref TEXT NOT NULL REFERENCES llm_providers(id) ON DELETE CASCADE,
  target_model TEXT NOT NULL,                          -- 真实模型名
  fallback_model TEXT,
  capabilities_json TEXT DEFAULT '[]',                 -- ["vision","tools","reasoning"]
  context_tokens INTEGER DEFAULT 32000,
  status TEXT NOT NULL DEFAULT 'enabled',
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS handoffs (
  grant TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  ip TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

/* 每个成员当前选中的专家。专家决定他能看到哪些连接器、哪些技能、
   用哪个角色提示词——这是「工作模式」的落点。 */
CREATE TABLE IF NOT EXISTS user_expert_state (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  active_expert_id TEXT REFERENCES experts(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL
);

/* ZCode 客户端接入令牌。桌面端用它对 /v1/client-config 做 Bearer 认证；
   只存 SHA-256 散列，明文仅在创建时返回一次。 */
CREATE TABLE IF NOT EXISTS client_tokens (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  revoked INTEGER NOT NULL DEFAULT 0
);

/* 登录失败计数。按 (账号, IP) 分别记，用于锁定暴力破解的单个来源，
   而不至于让攻击者用一个 IP 试错把别人的账号锁死（那样反而成了 DoS 手段）。 */
CREATE TABLE IF NOT EXISTS login_attempts (
  key TEXT PRIMARY KEY,
  failures INTEGER NOT NULL DEFAULT 0,
  first_failed_at TEXT NOT NULL,
  last_failed_at TEXT NOT NULL,
  locked_until TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_experts_status ON experts(status);
CREATE INDEX IF NOT EXISTS idx_plugins_status ON plugins(status);
`;

db.exec(SCHEMA);

/**
 * 轻量列迁移：老库（已建表）新增列时补上。
 * 不用版本号框架——列少，检查一次 PRAGMA 就够，且重复执行安全。
 */
function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (columns.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

ensureColumn("plugins", "package_file", "TEXT");
ensureColumn("plugins", "package_sha256", "TEXT");
ensureColumn("plugins", "package_size", "INTEGER");
ensureColumn("plugins", "dependencies_json", "TEXT DEFAULT '[]'");
// 审计哈希链是后加的：已建库的 audit_logs 不会因为 CREATE TABLE IF NOT EXISTS 长出新列，
// 必须显式补。补完由 sealAuditChain() 一次性回填历史行。
// 专家版本号是后加的：专家包文件名与 plugin.json 的 version 以它为准。
ensureColumn("experts", "version", "TEXT NOT NULL DEFAULT '1.0.0'");
ensureColumn("audit_logs", "prev_hash", "TEXT");
ensureColumn("audit_logs", "hash", "TEXT");

// 历史数据修正：专家编译的插件包落库时 endpoint 写成了空串。空串不是 NULL，
// 会让所有「有端点才是连接器」的筛选把它当成真，数字员工因而混进插件市场。
// 统一成 NULL，之后由写入侧保证不再产生空串。
db.prepare("UPDATE plugins SET endpoint = NULL WHERE TRIM(COALESCE(endpoint, '')) = ''").run();

export function getSetting(key, fallback = null) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  db.prepare(
    "INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, String(value));
}

/**
 * 审计行的链哈希。
 *
 * 固定顺序拼接业务字段 + 上一条的 hash，所以：
 *   - 改任意字段 → 本行 hash 变 → 后面每一行的 prev_hash 都对不上；
 *   - 删一行 → 下一行的 prev_hash 指向已不存在的 hash；
 *   - 中间插一行 → 同样断链。
 * 不包含自增 `id`（插入前拿不到；且 id 由 SQLite 分配，不承载业务含义）。
 *
 * 用 \u0000 分隔，避免字段内容里拼出歧义（比如 actor 叫 "a"、action 叫 "b" 与
 * actor 叫 "ab"、action 叫 "" 不能算出同一个哈希）。
 */
export function computeAuditHash(prevHash, row) {
  const fields = [
    prevHash || "",
    row.actor_id ?? "",
    row.actor_name ?? "",
    row.action ?? "",
    row.target_type ?? "",
    row.target_id ?? "",
    row.target_name ?? "",
    row.detail_json ?? "",
    row.ip ?? "",
    row.created_at ?? "",
  ];
  return createHash("sha256").update(fields.join("\u0000")).digest("hex");
}

/**
 * 给历史行补链哈希（一次性）。
 *
 * 加哈希链之前的记录没有 hash，直接参与校验会全部报「哈希缺失」。
 * 这里按 id 顺序补算一次，作为链的起点；补算本身无法证明历史未被改过，
 * 所以 `sealedAt` 会记在返回值里——校验接口会说明「取证从这一刻开始有效」。
 */
export function sealAuditChain() {
  const pending = db
    .prepare("SELECT * FROM audit_logs WHERE hash IS NULL OR hash = '' ORDER BY id ASC")
    .all();
  if (pending.length === 0) return { sealed: 0, at: null };
  const last = db.prepare("SELECT hash FROM audit_logs WHERE hash IS NOT NULL AND hash <> '' ORDER BY id DESC LIMIT 1").get();
  let prev = last?.hash || "";
  const update = db.prepare("UPDATE audit_logs SET prev_hash = ?, hash = ? WHERE id = ?");
  for (const row of pending) {
    const hash = computeAuditHash(prev, row);
    update.run(prev, hash, row.id);
    prev = hash;
  }
  return { sealed: pending.length, at: nowIso() };
}

/**
 * 校验整条审计链。
 *
 * 返回 `{ ok, checked, brokenAt, reason }`。`brokenAt` 是第一条对不上的记录 id，
 * 运维可以直接按 id 前后对比找手改痕迹。
 */
export function verifyAuditChain({ limit = 0 } = {}) {
  const sql = limit > 0
    ? "SELECT * FROM audit_logs ORDER BY id ASC LIMIT ?"
    : "SELECT * FROM audit_logs ORDER BY id ASC";
  const rows = limit > 0 ? db.prepare(sql).all(limit) : db.prepare(sql).all();
  let prev = "";
  let checked = 0;
  for (const row of rows) {
    checked += 1;
    if (!row.hash) {
      return { ok: false, checked, brokenAt: row.id, reason: "该行没有哈希（可能是哈希链启用前写入且未封链）" };
    }
    if ((row.prev_hash || "") !== prev) {
      return { ok: false, checked, brokenAt: row.id, reason: "prev_hash 与上一条记录的 hash 不一致（记录被删除或插入）" };
    }
    const expected = computeAuditHash(prev, row);
    if (expected !== row.hash) {
      return { ok: false, checked, brokenAt: row.id, reason: "字段内容与哈希不匹配（记录被修改）" };
    }
    prev = row.hash;
  }
  return { ok: true, checked, brokenAt: null, reason: null };
}

/**
 * 写一条审计。
 *
 * 第一个参数是**请求上下文 ctx**，不是用户对象——所有调用点统一传 ctx。
 * 早期有几处误传了 requireRole() 返回的用户对象，导致 actor_id 恒为 null、
 * actor_name 落到「系统」，审计里看不出是谁做的（且很难发现）。
 * 这里对两种形状都做兼容，但正常的传法只有 ctx。
 */
export function audit(ctx, action, target = {}, detail = {}) {
  // ctx.user 是标准路径；ctx 本身就是用户对象时兜底（id/displayName 直接挂在上面）。
  const actor = ctx?.user ?? (ctx?.id ? ctx : null);
  const row = {
    actor_id: actor?.id || null,
    actor_name: actor?.displayName || actor?.display_name || "系统",
    action,
    target_type: target.type || null,
    target_id: target.id || null,
    target_name: target.name || null,
    detail_json: JSON.stringify(detail),
    ip: ctx?.ip || null,
    created_at: nowIso(),
  };
  const prev = db.prepare("SELECT hash FROM audit_logs ORDER BY id DESC LIMIT 1").get()?.hash || "";
  db.prepare(
    `INSERT INTO audit_logs(actor_id, actor_name, action, target_type, target_id, target_name, detail_json, ip, created_at, prev_hash, hash)
     VALUES(?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    row.actor_id,
    row.actor_name,
    row.action,
    row.target_type,
    row.target_id,
    row.target_name,
    row.detail_json,
    row.ip,
    row.created_at,
    prev,
    computeAuditHash(prev, row)
  );
}

/* ------------------------------------------------------------------ */
/* 种子数据                                                            */
/* ------------------------------------------------------------------ */

const SKILL_CONTRACT = `# 合同风险审查清单

## 何时使用
当用户上传或以文本形式提供合同、协议、补充条款，要求审查风险、比对差异或判断可签性时使用。

## 审查顺序
1. **主体适格**：对方名称与营业执照、签约主体是否一致；分公司签约须有授权。
2. **标的与范围**：交付物清单是否可验收（数量、粒度、验收标准三要素齐全）。
3. **价款与结算**：付款节点是否与交付节点绑定；是否含"验收后 N 日"上限。
4. **知识产权**：成果归属、第三方组件授权、源代码托管条款。
5. **保密与数据**：数据出境、脱敏义务、保密期限是否超过合同期。
6. **违约与解除**：违约金比例是否对等；单方解除权是否单向。
7. **争议解决**：管辖地是否在我方所在地；是否约定仲裁与诉讼并存（无效约定）。

## 输出格式
按【风险等级 / 原文位置 / 问题 / 修改建议】四列表格输出。
- 高风险：可能导致重大损失或无法追偿，**必须修改**
- 中风险：条款模糊、执行有争议空间，建议修改
- 低风险：表述不规范，可保留

## 边界
不改写整份合同，只输出问题清单与建议条款。涉及金额、税务、劳动关系的判断，提示由法务复核。`;

const SKILL_TICKET = `# 事件分级与处置判定

## 何时使用
接入工单、事件、告警系统后，需要对事件定级、判断处置时限、指定响应角色时使用。

## 分级标准（依据企业内部预案）
| 等级 | 判定条件 | 响应时限 | 上报 |
|---|---|---|---|
| 一级 | 影响范围跨区域 / 涉及人员伤亡 / 核心系统全阻 | 15 分钟 | 值班领导 + 主要负责人 |
| 二级 | 单点核心业务中断 / 数据不一致 | 30 分钟 | 值班领导 |
| 三级 | 局部功能异常 / 有替代方案 | 2 小时 | 值班组长 |
| 四级 | 咨询、优化建议 | 24 小时 | 无需上报 |

## 判定动作
1. 读事件描述与影响范围字段，缺失则先调用工单接口补齐。
2. 比对分级标准，给出等级 + 依据（引用命中的那一条）。
3. 若命中一级，立即输出上报清单（姓名 + 渠道 + 时限）。

## 边界
只做定级与建议，不直接改工单状态。变更类操作必须走二次确认。`;

const SKILL_REPORT = `# 事件简报撰写

## 何时使用
事件处置告一段落，需要向上级报送书面简报时使用。

## 结构（固定四段）
1. **事件概况**：时间、地点、涉及系统、影响范围，不超过 120 字。
2. **处置过程**：按时间轴写做了什么动作、谁执行、结果如何，只写事实。
3. **原因分析**：直接原因 + 根本原因，未查明时明确写"原因待查"。
4. **后续措施**：可落地、有责任人和时限的动作，不超过 3 条。

## 文风要求
- 不用形容词堆砌，不写"高度重视""迅速响应"这类空话。
- 数字必须带口径与时间点。
- 全文控制在 600 字以内。

## 边界
不编造未提供的事实。缺少关键字段时先列出缺失项，请用户补充。`;

const SKILL_METRIC = `# 经营数据口径核对

## 何时使用
用户给出经营数据（收入、回款、合同额、人效），需要判断口径是否一致、能否横向比较时使用。

## 核对四问
1. **时点是哪个**：截止日、统计周期（自然月/财月）、是否为累计数。
2. **确认口径**：合同额（签约）/ 收入（确认）/ 回款（到账）三者不可混用。
3. **主体范围**：是否含子公司、是否含税、是否抵消内部交易。
4. **单位**：万元 / 亿元，是否含小数位。

## 输出
先给一张口径对照表，再给结论。不同时点的数字**不做横比**，只做同口径同比。

## 边界
不推断缺失数据。口径不一致时明确标注"不可比"，并说明需要补哪一项。`;

const SKILL_DOC = `# 公文格式规范

## 何时使用
撰写请示、报告、通知、函、纪要等内部公文时使用。

## 格式要点
- 标题：发文机关 + 事由 + 文种，三要素齐全，不用书名号。
- 主送机关：顶格，多个用顿号分隔，末尾加冒号。
- 正文：一级标题"一、"，二级"（一）"，三级"1."。
- 落款：单位全称 + 成文日期（阿拉伯数字），右空四字。
- 行距：正文固定 1.5 倍行距，一级标题黑体三号，正文仿宋三号。

## 常见错误
- 请示夹带报告事项（一文一事）
- "特此报告"用于请示
- 附件说明位置错误（应在正文下空一行，左空二字）

## 边界
只输出正文与格式说明，不代拟签发人意见。`;

const PLUGIN_SEED = [
  {
    key: "oa-system",
    name: "OA 协同办公",
    summary: "待办、审批流、公文流转。可查我的待办、发起用印申请、催办审批。",
    category: "办公协同",
    transport: "streamable_http",
    endpoint: "https://oa.hx.local/mcp",
    auth_type: "oauth",
    auth_config_json: { authorizationServer: "https://sso.hx.local", scopes: ["oa.read", "oa.write"], clientId: "hx-workbench" },
    visibility: "all",
    version: "2.3.1",
    status: "enabled",
    owner: "信息中心",
  },
  {
    key: "contract-archive",
    name: "合同归档系统",
    summary: "合同台账查询、原件下载、履约节点提醒。只读为主，写入需审批。",
    category: "业务系统",
    transport: "streamable_http",
    endpoint: "https://contract.hx.local/mcp",
    auth_type: "oauth",
    auth_config_json: { authorizationServer: "https://sso.hx.local", scopes: ["contract.read"], clientId: "hx-workbench" },
    visibility: "restricted",
    version: "1.8.0",
    status: "enabled",
    owner: "法务部",
  },
  {
    key: "ticket-platform",
    name: "事件处置平台",
    summary: "工单查询、事件定级、处置记录回写。写操作强制二次确认。",
    category: "业务系统",
    transport: "streamable_http",
    endpoint: "https://ticket.hx.local/mcp",
    auth_type: "oauth",
    auth_config_json: { authorizationServer: "https://sso.hx.local", scopes: ["ticket.read", "ticket.write"], clientId: "hx-workbench" },
    visibility: "all",
    version: "3.1.4",
    status: "enabled",
    owner: "运维中心",
  },
  {
    key: "bi-metrics",
    name: "经营数据平台",
    summary: "经营看板指标、部门完成度、项目毛利。口径以平台为准。",
    category: "数据",
    transport: "streamable_http",
    endpoint: "https://bi.hx.local/mcp",
    auth_type: "bearer",
    auth_config_json: { tokenHint: "由管理员在后台轮换，不随客户端下发" },
    visibility: "restricted",
    version: "1.2.0",
    status: "enabled",
    owner: "经营部",
  },
  {
    key: "gitlab",
    name: "代码仓库 GitLab",
    summary: "仓库检索、MR 审阅、流水线状态。自建 GitLab，非 GitHub。",
    category: "研发",
    transport: "streamable_http",
    endpoint: "https://gitlab.hx.local/api/v4/mcp",
    auth_type: "oauth",
    auth_config_json: { authorizationServer: "https://gitlab.hx.local", scopes: ["read_api", "api"], clientId: "hx-workbench" },
    visibility: "restricted",
    version: "1.0.6",
    status: "enabled",
    owner: "研发部",
  },
  {
    key: "wecom-contacts",
    name: "企业微信通讯录",
    summary: "按部门查人、查岗位、发应用消息。仅读取组织架构。",
    category: "通讯",
    transport: "streamable_http",
    endpoint: "https://qyapi.hx.local/mcp",
    auth_type: "oauth",
    auth_config_json: { authorizationServer: "https://sso.hx.local", scopes: ["contact.read"], clientId: "hx-workbench" },
    visibility: "all",
    version: "1.1.2",
    status: "enabled",
    owner: "信息中心",
  },
  {
    key: "local-files",
    name: "本地文件工具",
    summary: "读写本机工作目录。走 stdio，随客户端安装，不需授权。",
    category: "研发",
    transport: "stdio",
    command: "npx",
    args_json: ["-y", "@modelcontextprotocol/server-filesystem", "${WORKSPACE}"],
    auth_type: "none",
    auth_config_json: {},
    visibility: "all",
    version: "0.9.0",
    status: "enabled",
    owner: "信息中心",
  },
  {
    key: "hr-portal",
    name: "人力资源门户",
    summary: "假期余额、考勤异常、薪酬单查询。灰度中，仅人力与财务试点。",
    category: "办公协同",
    transport: "streamable_http",
    endpoint: "https://hr.hx.local/mcp",
    auth_type: "oauth",
    auth_config_json: { authorizationServer: "https://sso.hx.local", scopes: ["hr.self"], clientId: "hx-workbench" },
    visibility: "restricted",
    version: "0.4.0",
    status: "draft",
    owner: "人力资源部",
  },
];

export function seedIfEmpty({ reset = false } = {}) {
  if (reset) {
    for (const t of ["model_aliases", "llm_providers", "grants", "experts", "skills", "plugins", "sessions", "audit_logs", "users", "settings", "handoffs"]) {
      db.exec(`DELETE FROM ${t}`);
    }
  }
  const count = db.prepare("SELECT COUNT(*) AS c FROM users").get().c;
  if (count > 0) return false;

  const t = nowIso();

  const users = [
    ["u_admin", "admin", "周伟", "admin@hx.local", "信息中心", "admin", "Admin@12345"],
    ["u_pub", "zhangmin", "张敏", "zhangmin@hx.local", "法务部", "publisher", "Hx@12345"],
    ["u_mem1", "lijie", "李杰", "lijie@hx.local", "运维中心", "member", "Hx@12345"],
    ["u_mem2", "wangyu", "王宇", "wangyu@hx.local", "经营部", "member", "Hx@12345"],
    ["u_mem3", "chenxi", "陈曦", "chenxi@hx.local", "研发部", "member", "Hx@12345"],
  ];
  const insertUser = db.prepare(
    `INSERT INTO users(id, username, display_name, email, department, role, status, password_hash, created_at)
     VALUES(?,?,?,?,?,?, 'active', ?, ?)`
  );
  for (const [id, username, name, email, dept, role, pwd] of users) {
    insertUser.run(id, username, name, email, dept, role, hashPassword(pwd), t);
  }

  const insertPlugin = db.prepare(
    `INSERT INTO plugins(id, key, name, summary, category, transport, endpoint, command, args_json,
       auth_type, auth_config_json, visibility, version, status, owner, created_at, updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  );
  const pluginIdByKey = {};
  for (const p of PLUGIN_SEED) {
    const id = newId("plg");
    pluginIdByKey[p.key] = id;
    insertPlugin.run(
      id, p.key, p.name, p.summary, p.category, p.transport, p.endpoint ?? null, p.command ?? null,
      JSON.stringify(p.args_json ?? []), p.auth_type, JSON.stringify(p.auth_config_json ?? {}),
      p.visibility, p.version, p.status, p.owner, t, t
    );
  }

  const insertSkill = db.prepare(
    `INSERT INTO skills(id, key, name, summary, category, version, trigger_desc, content, status, author, installs, created_at, updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`
  );
  const skillSeed = [
    ["contract-risk-checklist", "合同风险审查清单", "按七项要素逐条审合同，输出四列风险表", "法务合规", "2.1.0", "审查合同 / 协议 / 补充条款时", SKILL_CONTRACT, 42],
    ["ticket-classification", "事件分级与处置判定", "按企业预案定级，给响应时限与上报清单", "业务处置", "1.4.0", "需要对事件定级或判断时限时", SKILL_TICKET, 67],
    ["incident-brief", "事件简报撰写", "固定四段结构，600 字内，只写事实", "公文写作", "1.2.0", "向上级报送事件简报时", SKILL_REPORT, 38],
    ["metric-reconcile", "经营数据口径核对", "四问核对口径，不同时点不横比", "数据分析", "1.0.3", "拿到经营数字要判断可比性时", SKILL_METRIC, 25],
    ["official-doc-format", "公文格式规范", "请示报告通知函纪要的格式与常见错误", "公文写作", "1.1.0", "撰写内部公文时", SKILL_DOC, 54],
  ];
  const skillIdByKey = {};
  for (const [key, name, summary, category, version, trigger, content, installs] of skillSeed) {
    const id = newId("skl");
    skillIdByKey[key] = id;
    insertSkill.run(id, key, name, summary, category, version, trigger, content, "published", "周伟", installs, t, t);
  }

  const insertExpert = db.prepare(
    `INSERT INTO experts(id, key, name, role_title, emoji, summary, role_prompt, model_provider, model_name,
       permission_mode, plugin_ids_json, skill_ids_json, visibility, status, owner, created_at, updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  );
  const expertSeed = [
    {
      key: "contract-reviewer", visibility: "restricted", name: "合同审查专员", role_title: "法务 · 合同风险", emoji: "📄",
      summary: "只读合同、只出风险清单，不改条款。可查台账、下原件。",
      role_prompt: `你是和信的法务助理，专职合同审查。

工作方式：
- 先取合同全文，再按《合同风险审查清单》七项要素逐条过。
- 每条风险必须给原文位置（条款号或引文）和修改建议，不给空泛评价。
- 高风险项单独置顶，用一句话说清后果。

边界：
- 不修改合同正文，只输出问题清单。
- 涉及金额、税务、劳动关系的判断，明确写"建议法务复核"。
- 查不到合同台账时，直接说查不到，不要猜合同内容。`,
      permission_mode: "read_only",
      plugins: ["contract-archive", "oa-system"],
      skills: ["contract-risk-checklist", "official-doc-format"],
    },
    {
      key: "incident-dispatcher", visibility: "restricted", name: "事件处置调度员", role_title: "运维 · 应急处置", emoji: "🚨",
      summary: "定级、定时限、给上报清单。工单写操作必须二次确认。",
      role_prompt: `你是运维中心的事件处置调度员。

工作方式：
- 收到事件先按《事件分级与处置判定》定级，必须引用命中的分级条款。
- 定级后立刻给响应时限和上报清单（姓名 + 渠道 + 时限）。
- 处置结束后，主动问是否要出简报；要，则按《事件简报撰写》四段结构写。

边界：
- 不改工单状态、不发通知，只给建议动作。
- 任何写操作先列出将要执行的变更，等用户确认。
- 原因未查明就写"原因待查"，不推测。`,
      permission_mode: "confirm_write",
      plugins: ["ticket-platform", "wecom-contacts"],
      skills: ["ticket-classification", "incident-brief"],
    },
    {
      key: "biz-analyst", visibility: "restricted", name: "经营分析助理", role_title: "经营 · 数据解读", emoji: "📊",
      summary: "只看已授权口径的数据，先核对口径再给结论。",
      role_prompt: `你是经营部的数据分析助理。

工作方式：
- 拿到任何数字，先用《经营数据口径核对》四问过一遍，输出口径对照表。
- 口径不一致时明确标"不可比"，并说明要补哪一项。
- 结论先给一句话判断，再给支撑数据，最后给建议动作（不超过 3 条）。

边界：
- 不推断缺失数据，不把合同额当收入。
- 不同时点的数字不做横向比较。
- 涉及部门考核的评价性表述一律不给。`,
      permission_mode: "read_only",
      plugins: ["bi-metrics", "oa-system"],
      skills: ["metric-reconcile"],
    },
    {
      key: "doc-writer", name: "公文写作助理", role_title: "综合 · 公文起草", emoji: "✍️",
      summary: "按公文格式起草请示、报告、通知，不代拟签发意见。",
      role_prompt: `你是综合办公室的公文写作助理。

工作方式：
- 先确认文种（请示 / 报告 / 通知 / 函 / 纪要），文种错了整篇都要重写。
- 按《公文格式规范》的层级与格式输出，标题三要素齐全。
- 写完自查一遍常见错误清单，把自查结果放在正文之后。

边界：
- 一文一事，请示不夹带报告事项。
- 不代拟领导签发意见。
- 不编造未提供的数字与事实。`,
      permission_mode: "read_only",
      plugins: ["oa-system"],
      skills: ["official-doc-format", "incident-brief"],
    },
    {
      key: "dev-reviewer", visibility: "restricted", name: "代码审阅助理", role_title: "研发 · 代码质量", emoji: "🔍",
      summary: "看 MR、查依赖、给可执行的修改意见。灰度中。",
      role_prompt: `你是研发部的代码审阅助理。

工作方式：
- 先读 MR 描述与变更文件清单，再逐个文件看。
- 意见按【阻断 / 建议 / 疑问】三档，每条都给文件与行号。
- 涉及安全（注入、越权、密钥硬编码）一律列为阻断。

边界：
- 不直接推代码、不合并 MR。
- 不评价代码风格偏好，只讲影响正确性与可维护性的问题。`,
      permission_mode: "read_only",
      plugins: ["gitlab"],
      skills: [],
      status: "draft",
    },
  ];

  const expertIdByKey = {};
  for (const e of expertSeed) {
    const id = newId("exp");
    expertIdByKey[e.key] = id;
    insertExpert.run(
      id, e.key, e.name, e.role_title, e.emoji, e.summary, e.role_prompt, "internal", "std",
      e.permission_mode, JSON.stringify(e.plugins.map((k) => pluginIdByKey[k])),
      JSON.stringify(e.skills.map((k) => skillIdByKey[k])), e.visibility || "all", e.status || "published", "周伟", t, t
    );
  }

  const insertProvider = db.prepare(
    `INSERT INTO llm_providers(id, key, name, vendor, base_url, api_key, provider_id, status, note, created_at, updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?)`
  );
  const providerSeed = [
    ["lpr_gateway", "hx-gateway", "和信内网模型网关", "openai-compatible", "https://llm.hx.local/v1", "sk-internal-8f2c4a1b7d", "hx-gateway", "enabled", "主力网关：DeepSeek / Qwen 全家桶，OpenAI 兼容协议"],
    ["lpr_vision", "hx-vision", "和信视觉模型服务", "custom", "https://vlm.hx.local/v1", "sk-vision-3a9e6c2f5b", "hx-vision", "enabled", "只跑多模态，接口与网关独立，按图片张数计费"],
  ];
  const providerIdByKey = {};
  for (const [id, key, name, vendor, baseUrl, apiKey, providerId, status, note] of providerSeed) {
    providerIdByKey[key] = id;
    insertProvider.run(id, key, name, vendor, baseUrl, apiKey, providerId, status, note, t, t);
  }

  const insertAlias = db.prepare(
    `INSERT INTO model_aliases(id, key, name, description, badge, icon, provider_ref, target_model, fallback_model,
       capabilities_json, context_tokens, status, sort_order, created_at, updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  );
  const aliasSeed = [
    ["std", "标准", "极速全能，秒杀日常任务", "0.1X", "⚡", "hx-gateway", "deepseek-v3", "qwen2.5-72b", ["tools"], 64000, "enabled", 10],
    ["pro", "高级", "性能均衡，擅长复杂任务", "1X", "✳", "hx-gateway", "deepseek-r1", null, ["tools", "reasoning"], 128000, "enabled", 20],
    ["vision", "视觉理解", "看图、读表格、认截图", "1X", "👁", "hx-vision", "qwen-vl-max", null, ["vision"], 32000, "enabled", 30],
    ["lite", "极速", "一句话就能答完的小事", "0.05X", "🚀", "hx-gateway", "qwen-turbo", null, ["tools"], 8000, "enabled", 40],
    ["offline", "离线兜底", "断网时可用，只做摘要与分类", "0X", "🔌", "hx-gateway", "qwen2.5-7b", null, [], 8000, "disabled", 90],
  ];
  for (const [key, name, desc, badge, icon, providerKey, model, fallback, caps, ctx, status, sort] of aliasSeed) {
    insertAlias.run(newId("als"), key, name, desc, badge, icon, providerIdByKey[providerKey], model,
      fallback, JSON.stringify(caps), ctx, status, sort, t, t);
  }

  const insertGrant = db.prepare("INSERT INTO grants(id, expert_id, subject_type, subject_id, created_at) VALUES(?,?,?,?,?)");
  insertGrant.run(newId("grt"), expertIdByKey["contract-reviewer"], "department", "法务部", t);
  insertGrant.run(newId("grt"), expertIdByKey["contract-reviewer"], "department", "经营部", t);
  insertGrant.run(newId("grt"), expertIdByKey["incident-dispatcher"], "department", "运维中心", t);
  insertGrant.run(newId("grt"), expertIdByKey["biz-analyst"], "department", "经营部", t);
  insertGrant.run(newId("grt"), expertIdByKey["doc-writer"], "role", "all", t);

  setSetting("org_name", CONFIG.orgName);
  setSetting("manifest_channel", "stable");
  setSetting("manifest_version", "1");
  setSetting("require_update", "false");
  setSetting("min_client_version", "0.1.0");
  setSetting("allow_self_install", "false");

  const logs = [
    ["发布专家", "expert", expertIdByKey["incident-dispatcher"], "事件处置调度员", { from: "draft", to: "published" }],
    ["更新插件", "plugin", pluginIdByKey["ticket-platform"], "事件处置平台", { version: "3.1.4" }],
    ["发布技能", "skill", skillIdByKey["contract-risk-checklist"], "合同风险审查清单", { version: "2.1.0" }],
    ["修改权限", "expert", expertIdByKey["contract-reviewer"], "合同审查专员", { permission_mode: "read_only" }],
    ["新增用户", "user", "u_mem2", "王宇", { department: "经营部" }],
  ];
  const insertLog = db.prepare(
    `INSERT INTO audit_logs(actor_id, actor_name, action, target_type, target_id, target_name, detail_json, ip, created_at, prev_hash, hash)
     VALUES(?,?,?,?,?,?,?,?,?,?,?)`
  );
  let i = 0;
  let prevHash = "";
  for (const [action, type, id, name, detail] of logs) {
    const ts = new Date(Date.now() - (i + 1) * 37 * 60 * 1000).toISOString();
    const row = {
      actor_id: "u_admin",
      actor_name: "周伟",
      action,
      target_type: type,
      target_id: id,
      target_name: name,
      detail_json: JSON.stringify(detail),
      ip: "10.20.31.6",
      created_at: ts,
    };
    const hash = computeAuditHash(prevHash, row);
    insertLog.run(
      row.actor_id, row.actor_name, row.action, row.target_type, row.target_id,
      row.target_name, row.detail_json, row.ip, row.created_at, prevHash, hash
    );
    prevHash = hash;
    i++;
  }

  return true;
}

export function resetAll() {
  for (const t of ["user_expert_state", "model_aliases", "llm_providers", "grants", "experts", "skills", "plugins", "sessions", "audit_logs", "users", "settings", "handoffs"]) {
    db.exec(`DELETE FROM ${t}`);
  }
}
