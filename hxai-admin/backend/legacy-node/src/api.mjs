import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { db, audit, newId, nowIso, getSetting, setSetting, verifyAuditChain } from "./db.mjs";
import { verifyPassword, hashPassword, randomToken } from "./crypto.mjs";
import { CONFIG } from "./config.mjs";
import { bad, forbidden, notFound, ok, created, unauthorized, HttpError } from "./http.mjs";
import { attachUser, clearLoginFailures, createSession, checkLoginLock, publicUser, recordLoginFailure, requireAuth, requireRole, revokeSession, touchLogin } from "./auth.mjs";
import { countSkillEntries, findPluginManifest, listZipEntries, PLUGIN_NAME_PATTERN, ZipError } from "./zip.mjs";
import { compileExpertPackage } from "./expert-package.mjs";

/* ----------------------------- 序列化 ----------------------------- */
const arr = (json) => {
  try {
    const v = JSON.parse(json || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};
const obj = (json) => {
  try {
    const v = JSON.parse(json || "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
};

/**
 * 「这个插件能当连接器用」的判定。
 *
 * 必须写成 `endpoint IS NOT NULL AND TRIM(endpoint) <> ''`：专家编译出来的插件包
 * 只带 agent/skill，没有 MCP 端点，落库时 endpoint 是空串而不是 NULL。
 * 之前各接口直接写 `endpoint IS NOT NULL`，空串能通过，导致数字员工混进
 * 插件市场、连接器和能力清单（数量对不上）。
 * 连接器侧的 JS 判断（`r.endpoint &&`）一直是对的，两边必须保持一致。
 */
const CONNECTOR_PLUGIN_WHERE = "endpoint IS NOT NULL AND TRIM(endpoint) <> ''";

const toPlugin = (r) => ({
  id: r.id,
  key: r.key,
  name: r.name,
  summary: r.summary,
  category: r.category,
  transport: r.transport,
  endpoint: r.endpoint,
  command: r.command,
  args: arr(r.args_json),
  authType: r.auth_type,
  authConfig: obj(r.auth_config_json),
  visibility: r.visibility,
  version: r.version,
  status: r.status,
  owner: r.owner,
  // 插件包元信息：客户端市场清单据此生成 zip 源
  hasPackage: Boolean(r.package_file),
  packageFile: r.package_file || undefined,
  packageSha256: r.package_sha256 || undefined,
  packageSize: r.package_size || undefined,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toSkill = (r) => ({
  id: r.id,
  key: r.key,
  name: r.name,
  summary: r.summary,
  category: r.category,
  version: r.version,
  trigger: r.trigger_desc,
  content: r.content,
  status: r.status,
  author: r.author,
  installs: r.installs,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toExpert = (r) => {
  const pluginIds = arr(r.plugin_ids_json);
  const skillIds = arr(r.skill_ids_json);
  const placeholders = (ids) => (ids.length ? ids.map(() => "?").join(",") : null);
  const pluginKeys = [];
  if (pluginIds.length) {
    const p = placeholders(pluginIds);
    for (const row of db.prepare(`SELECT key, name FROM plugins WHERE id IN (${p})`).all(...pluginIds)) {
      pluginKeys.push({ key: row.key, name: row.name });
    }
  }
  const skillKeys = [];
  if (skillIds.length) {
    const p = placeholders(skillIds);
    for (const row of db.prepare(`SELECT key, name, version FROM skills WHERE id IN (${p})`).all(...skillIds)) {
      skillKeys.push({ key: row.key, name: row.name, version: row.version });
    }
  }
  const grants = db
    .prepare("SELECT subject_type, subject_id FROM grants WHERE expert_id = ?")
    .all(r.id)
    .map((g) => ({ subjectType: g.subject_type, subjectId: g.subject_id }));

  return {
    id: r.id,
    key: r.key,
    name: r.name,
    roleTitle: r.role_title,
    emoji: r.emoji,
    summary: r.summary,
    rolePrompt: r.role_prompt,
    version: r.version || "1.0.0",
    model: { provider: r.model_provider, name: r.model_name },
    permissionMode: r.permission_mode,
    pluginIds,
    skillIds,
    plugins: pluginKeys,
    skills: skillKeys,
    visibility: r.visibility,
    status: r.status,
    owner: r.owner,
    grants,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
};

const maskKey = (k) => (k ? `••••${String(k).slice(-4)}` : "");

/* --------------------------- 专家（工作模式） --------------------------- */
/* OpenWork 没有「专家」这个概念，客户端也不读我们下发的 manifest。
   所以专家必须落在服务端裁剪：成员选中某个专家后，他后续拉到的连接器、
   技能、市场条目都只保留该专家装配的那部分。客户端不需要改任何渲染逻辑。 */

/** 成员可见的已发布专家：all 全体可见，restricted/private 按 user/department/role 授权 */
function visibleExperts(user) {
  const rows = db.prepare("SELECT * FROM experts WHERE status = 'published' ORDER BY created_at").all();
  if (!rows.length) return [];
  // 管理员要看得到全部专家，否则没法替别人验配置
  if (user.role === "admin") return rows;
  const grants = db.prepare("SELECT expert_id, subject_type, subject_id FROM grants").all();
  return rows.filter((e) => {
    if (e.visibility === "all") return true;
    if (e.owner && e.owner === user.id) return true;
    return grants.some(
      (g) =>
        g.expert_id === e.id &&
        ((g.subject_type === "user" && g.subject_id === user.id) ||
          (g.subject_type === "department" && user.department && g.subject_id === user.department) ||
          (g.subject_type === "role" && g.subject_id === user.role))
    );
  });
}

/**
 * 当前生效的专家。三档：
 *   1. 成员自己选过 → 用他的选择
 *   2. 后台设了默认专家 → 用默认
 *   3. 都没有 → null，也就是不做任何裁剪
 * 不做「默认落到第一个专家」这种兜底：那会让没选过的人莫名其妙
 * 看不到本该有的连接器，排查起来极难。
 */
function activeExpertOf(user) {
  const visible = visibleExperts(user);
  if (!visible.length) return null;
  const state = db.prepare("SELECT active_expert_id FROM user_expert_state WHERE user_id = ?").get(user.id);
  if (state?.active_expert_id) {
    // 选中的专家被撤公布了，按默认走，别让成员卡在一个不存在的模式里
    const chosen = visible.find((e) => e.id === state.active_expert_id);
    if (chosen) return chosen;
  }
  const fallbackId = getSetting("default_expert_id", "");
  if (fallbackId) return visible.find((e) => e.id === fallbackId) || null;
  return null;
}

/**
 * 专家作用域。返回 null 表示「不裁剪」：
 * 没有可见专家，或专家的装配清单是空的，都按全量下发——
 * 否则成员一进客户端就是空白，看起来像坏了。
 */
function expertScope(user) {
  const expert = activeExpertOf(user);
  if (!expert) return { expert: null, pluginIds: null, skillIds: null };
  const pluginIds = arr(expert.plugin_ids_json);
  const skillIds = arr(expert.skill_ids_json);
  return {
    expert,
    pluginIds: pluginIds.length ? pluginIds : null,
    skillIds: skillIds.length ? skillIds : null,
  };
}

/** 客户端看专家：不暴露 role_prompt 全文之外的内部字段，也不给 grants */
function expertForClient(e) {
  const pluginIds = arr(e.plugin_ids_json);
  const skillIds = arr(e.skill_ids_json);
  const names = (table, ids) =>
    ids.length
      ? db
          .prepare(`SELECT name FROM ${table} WHERE id IN (${ids.map(() => "?").join(",")})`)
          .all(...ids)
          .map((r) => r.name)
      : [];
  return {
    id: e.id,
    key: e.key,
    name: e.name,
    roleTitle: e.role_title,
    emoji: e.emoji,
    summary: e.summary,
    rolePrompt: e.role_prompt,
    model: { provider: e.model_provider, name: e.model_name },
    permissionMode: e.permission_mode,
    connectorCount: pluginIds.length,
    skillCount: skillIds.length,
    connectors: names("plugins", pluginIds),
    skills: names("skills", skillIds),
  };
}


const toProvider = (r, aliasCount = 0, enabledAliasCount = 0) => ({
  id: r.id,
  key: r.key,
  name: r.name,
  vendor: r.vendor,
  baseUrl: r.base_url,
  providerId: r.provider_id,
  status: r.status,
  note: r.note,
  hasApiKey: Boolean(r.api_key),
  apiKeyMasked: maskKey(r.api_key),
  aliasCount,
  enabledAliasCount,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toAlias = (r, providerName = null) => ({
  id: r.id,
  key: r.key,
  name: r.name,
  description: r.description,
  badge: r.badge,
  icon: r.icon,
  providerRef: r.provider_ref,
  providerName,
  targetModel: r.target_model,
  fallbackModel: r.fallback_model,
  capabilities: arr(r.capabilities_json),
  contextTokens: r.context_tokens,
  status: r.status,
  sortOrder: r.sort_order,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/* ----------------------------- 校验 ----------------------------- */
function required(body, fields) {
  const missing = fields.filter((f) => body[f] === undefined || body[f] === null || String(body[f]).trim() === "");
  if (missing.length) throw bad(`缺少必填字段：${missing.join("、")}`, { missing });
}

function ensureUnique(table, key, value, excludeId = null) {
  const row = db.prepare(`SELECT id FROM ${table} WHERE key = ?`).get(value);
  if (row && row.id !== excludeId) throw new HttpError(409, `标识 ${value} 已被占用`, "conflict");
}

function slugify(input) {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

const visiblePluginIds = (ids) => {
  const clean = [...new Set((ids || []).filter(Boolean))];
  if (!clean.length) return [];
  const p = clean.map(() => "?").join(",");
  return db.prepare(`SELECT id FROM plugins WHERE id IN (${p})`).all(...clean).map((r) => r.id);
};
const visibleSkillIds = (ids) => {
  const clean = [...new Set((ids || []).filter(Boolean))];
  if (!clean.length) return [];
  const p = clean.map(() => "?").join(",");
  return db.prepare(`SELECT id FROM skills WHERE id IN (${p})`).all(...clean).map((r) => r.id);
};

/* ----------------------------- 下发清单 ----------------------------- */
const SECRET_KEY = /^(token|secret|password|apikey|api_key|clientsecret|client_secret)$/i;
function sanitizeConfig(config) {
  const out = {};
  for (const [k, v] of Object.entries(config || {})) {
    if (SECRET_KEY.test(k)) continue;
    if (typeof v === "string" && /^(bearer|token)\s+[A-Za-z0-9._-]{16,}$/i.test(v)) continue;
    out[k] = v;
  }
  return out;
}

/** 网关令牌：给客户端访问别名代理用，可轮换，不代表任何上游密钥 */
export function gatewayToken() {
  let token = getSetting("gateway_token", "");
  if (!token) {
    token = `owg_${randomToken(18)}`;
    setSetting("gateway_token", token);
  }
  return token;
}

export function buildManifest({ userId = null, isAdmin = false } = {}) {
  const experts = db
    .prepare("SELECT * FROM experts WHERE status = 'published' ORDER BY created_at")
    .all()
    .filter((e) => {
      if (isAdmin) return true;
      if (e.visibility === "all") return true;
      if (!userId) return false;
      if (e.visibility === "private") return e.owner === userId;
      const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
      if (!user) return false;
      const grants = db.prepare("SELECT subject_type, subject_id FROM grants WHERE expert_id = ?").all(e.id);
      return grants.some(
        (g) =>
          (g.subject_type === "user" && g.subject_id === userId) ||
          (g.subject_type === "department" && g.subject_id === user.department) ||
          (g.subject_type === "role" && (g.subject_id === "all" || g.subject_id === user.role))
      );
    })
    .map((e) => {
      const full = toExpert(e);
      return {
        id: full.id,
        key: full.key,
        name: full.name,
        roleTitle: full.roleTitle,
        emoji: full.emoji,
        summary: full.summary,
        rolePrompt: full.rolePrompt,
        model: full.model,
        permissionMode: full.permissionMode,
        plugins: full.plugins.map((p) => p.key),
        skills: full.skills.map((s) => s.key),
      };
    });

  const plugins = db
    .prepare("SELECT * FROM plugins WHERE status = 'enabled' AND visibility != 'admin' ORDER BY created_at")
    .all()
    .map((r) => {
      const p = toPlugin(r);
      const entry = {
        id: p.id,
        key: p.key,
        name: p.name,
        transport: p.transport,
        version: p.version,
        auth: { type: p.authType, ...sanitizeConfig(p.authConfig) },
      };
      if (p.transport === "stdio") {
        entry.command = p.command;
        entry.args = p.args;
      } else {
        entry.endpoint = p.endpoint;
      }
      return entry;
    });

  const skills = db
    .prepare("SELECT * FROM skills WHERE status = 'published' ORDER BY created_at")
    .all()
    .map((r) => {
      const s = toSkill(r);
      return { id: s.id, key: s.key, name: s.name, version: s.version, trigger: s.trigger, content: s.content };
    });

  const models = db
    .prepare(
      `SELECT a.*, p.name AS provider_name, p.provider_id FROM model_aliases a
       JOIN llm_providers p ON p.id = a.provider_ref
       WHERE a.status = 'enabled' AND p.status = 'enabled'
       ORDER BY a.sort_order`
    )
    .all()
    .map((a) => ({
      key: a.key,
      name: a.name,
      description: a.description,
      badge: a.badge,
      icon: a.icon,
      capabilities: arr(a.capabilities_json),
      contextTokens: a.context_tokens,
      provider: a.provider_id,
      providerName: a.provider_name,
    }));

  const body = {
    schemaVersion: "1.0",
    org: { id: "hx", name: getSetting("org_name", CONFIG.orgName) },
    channel: getSetting("manifest_channel", "stable"),
    policy: {
      requireUpdate: getSetting("require_update", "false") === "true",
      minClientVersion: getSetting("min_client_version", "0.1.0"),
      allowSelfInstall: getSetting("allow_self_install", "false") === "true",
    },
    experts,
    plugins,
    skills,
    models,
  };
  const version = createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 12);
  return { ...body, version, generatedAt: nowIso() };
}

/* ----------------------------- 路由注册 ----------------------------- */
export function registerRoutes(app) {
  /* ---------- 认证 ---------- */
  app.post("/api/auth/login", async (ctx) => {
    const { username, password } = ctx.body || {};
    required(ctx.body || {}, ["username", "password"]);
    // 先查锁定再验密码：锁定期内连比对都不做，否则锁定形同虚设（攻击者仍可
    // 用响应时间或错误码差异探测口令）。
    const lock = checkLoginLock(username, ctx.ip);
    if (lock.locked) {
      ctx.res.setHeader("retry-after", String(lock.retryAfterSeconds));
      throw new HttpError(429, `登录失败次数过多，请 ${lock.retryAfterSeconds} 秒后再试`, "too_many_attempts", {
        retryAfterSeconds: lock.retryAfterSeconds,
      });
    }
    const row = db.prepare("SELECT * FROM users WHERE username = ? OR email = ?").get(username, username);
    if (!row || !verifyPassword(password, row.password_hash)) {
      const result = recordLoginFailure(username, ctx.ip);
      // 锁定这一步必须留痕：否则「谁把管理员锁在门外」事后查不出来。
      if (result.lockedUntil) {
        audit(ctx, "登录锁定", { type: "user", id: row?.id || null, name: String(username) }, {
          failures: result.failures,
          lockedUntil: result.lockedUntil,
        });
      }
      throw new HttpError(401, "账号或密码不正确", "invalid_credentials");
    }
    if (row.status !== "active") throw forbidden("该账号已被停用，请联系管理员");
    clearLoginFailures(username, ctx.ip);
    const session = createSession(row, { ip: ctx.ip, ua: ctx.headers["user-agent"] });
    touchLogin(row.id);
    audit({ ...ctx, user: publicUser(row) }, "登录", { type: "session", id: row.id, name: "管理控制台" }, { username: row.username });
    ctx.res.setHeader(
      "set-cookie",
      `${CONFIG.cookieName}=${encodeURIComponent(session.token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${CONFIG.tokenTtlSeconds}`
    );
    return { token: session.token, expiresAt: session.expiresAt, user: publicUser(row) };
  });

  app.post("/api/auth/logout", async (ctx) => {
    revokeSession(ctx.jti);
    ctx.res.setHeader("set-cookie", `${CONFIG.cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    return { ok: true };
  });

  app.get("/api/auth/me", async (ctx) => {
    const user = requireAuth(ctx);
    return { user, sessions: db.prepare("SELECT COUNT(*) AS c FROM sessions WHERE user_id = ? AND revoked = 0 AND expires_at > ?").get(user.id, nowIso()).c };
  });

  app.post("/api/auth/password", async (ctx) => {
    const user = requireAuth(ctx);
    required(ctx.body || {}, ["oldPassword", "newPassword"]);
    const row = db.prepare("SELECT * FROM users WHERE id = ?").get(user.id);
    if (!verifyPassword(ctx.body.oldPassword, row.password_hash)) throw bad("原密码不正确");
    if (String(ctx.body.newPassword).length < 8) throw bad("新密码至少 8 位");
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(ctx.body.newPassword), user.id);
    db.prepare("UPDATE sessions SET revoked = 1 WHERE user_id = ?").run(user.id);
    audit(ctx, "修改密码", { type: "user", id: user.id, name: user.displayName }, {});
    return { ok: true };
  });

  /* ---------- 概览 ---------- */
  app.get("/api/overview", async (ctx) => {
    requireAuth(ctx);
    const one = (sql, ...args) => db.prepare(sql).get(...args).c;
    const recent = db.prepare("SELECT * FROM audit_logs ORDER BY created_at DESC, id DESC LIMIT 8").all().map((r) => ({
      id: r.id,
      actor: r.actor_name,
      action: r.action,
      target: r.target_name,
      targetType: r.target_type,
      createdAt: r.created_at,
    }));
    const byCategory = db
      .prepare("SELECT category, COUNT(*) AS c FROM plugins GROUP BY category ORDER BY c DESC")
      .all()
      .map((r) => ({ category: r.category, count: r.c }));
    const authMix = db
      .prepare("SELECT auth_type, COUNT(*) AS c FROM plugins GROUP BY auth_type")
      .all()
      .map((r) => ({ type: r.auth_type, count: r.c }));

    const manifest = buildManifest();
    return {
      counts: {
        experts: one("SELECT COUNT(*) AS c FROM experts"),
        expertsPublished: one("SELECT COUNT(*) AS c FROM experts WHERE status = 'published'"),
        plugins: one("SELECT COUNT(*) AS c FROM plugins"),
        pluginsEnabled: one("SELECT COUNT(*) AS c FROM plugins WHERE status = 'enabled'"),
        skills: one("SELECT COUNT(*) AS c FROM skills"),
        skillsPublished: one("SELECT COUNT(*) AS c FROM skills WHERE status = 'published'"),
        users: one("SELECT COUNT(*) AS c FROM users WHERE status = 'active'"),
        auditToday: one("SELECT COUNT(*) AS c FROM audit_logs WHERE created_at >= ?", new Date(Date.now() - 864e5).toISOString()),
      },
      byCategory,
      authMix,
      manifest: { version: manifest.version, generatedAt: manifest.generatedAt, experts: manifest.experts.length, plugins: manifest.plugins.length, skills: manifest.skills.length },
      recent,
    };
  });

  /* ---------- 专家 ---------- */
  app.get("/api/experts", async (ctx) => {
    requireAuth(ctx);
    const rows = db.prepare("SELECT * FROM experts ORDER BY created_at DESC").all();
    return { items: rows.map(toExpert) };
  });

  app.get("/api/experts/:id", async (ctx) => {
    requireAuth(ctx);
    const row = db.prepare("SELECT * FROM experts WHERE id = ?").get(ctx.params.id);
    if (!row) throw notFound("专家不存在");
    return toExpert(row);
  });

  /* --------------------- 专家 → 插件包（预览 / 下载） --------------------- */

  /** 预览编译结果：只返回结构摘要，方便运营在下发前核对。 */
  app.get("/api/experts/:id/package/preview", async (ctx) => {
    requireAuth(ctx);
    const compiled = compileExpertFromDb(ctx.params.id);
    const files = listZipEntries(compiled.buffer).map((e) => ({
      name: e.name,
      size: e.uncompressedSize,
    }));
    return { ...compiled.summary, fileName: compiled.fileName, sha256: compiled.sha256, files };
  });

  /** 下载编译好的插件包（zip），可直接上传到插件市场或手动分发。 */
  app.get("/api/experts/:id/package", async (ctx) => {
    requireAuth(ctx);
    const compiled = compileExpertFromDb(ctx.params.id);
    return {
      __file: true,
      type: "application/zip",
      name: compiled.fileName,
      body: compiled.buffer,
    };
  });

  /** 导出可移植专家包：插件/技能用 key 引用，换一套库也能落地。 */
  app.get("/api/experts/:id/export", async (ctx) => {
    requireAuth(ctx);
    const row = db.prepare("SELECT * FROM experts WHERE id = ?").get(ctx.params.id);
    if (!row) throw notFound("专家不存在");
    const bundle = {
      kind: "hxai.expert",
      version: 1,
      exportedAt: nowIso(),
      expert: {
        key: row.key,
        name: row.name,
        roleTitle: row.role_title || "",
        emoji: row.emoji || "",
        summary: row.summary || "",
        rolePrompt: row.role_prompt,
        version: normalizeVersion(row.version),
        model: { provider: row.model_provider || "", name: row.model_name || "" },
        permissionMode: row.permission_mode,
        pluginKeys: keysInOrder("plugins", arr(row.plugin_ids_json)),
        skillKeys: keysInOrder("skills", arr(row.skill_ids_json)),
        visibility: row.visibility,
        grants: exportGrants(row.id),
      },
    };
    return {
      __file: true,
      type: "application/json; charset=utf-8",
      name: `${row.key}.expert.json`,
      body: `${JSON.stringify(bundle, null, 2)}\n`,
    };
  });

  /** 导入专家：key 冲突时改名，引用按 key 解析，一律落草稿。 */
  app.post("/api/experts/import", async (ctx) => {
    const user = requireRole(ctx, "admin", "publisher");
    const raw = rawBody(ctx);
    if (!raw.length) throw bad("导入内容不能为空");
    const payload = parseExpertTransfer(raw);
    const name = String(payload.name || "").trim();
    const rolePrompt = String(payload.rolePrompt || "").trim();
    const missing = [];
    if (!name) missing.push("name");
    if (!rolePrompt) missing.push("rolePrompt");
    if (missing.length) throw bad(`专家包缺少必填字段：${missing.join("、")}`, { missing });

    const originalKey = String(payload.key || "").trim();
    const base = slugify(originalKey) || slugify(name) || "expert";
    let key = base;
    let remapped = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      if (!db.prepare("SELECT id FROM experts WHERE key = ?").get(key)) break;
      remapped = true;
      key = `${base}-import-${randomSuffix(4)}`;
    }

    const plugins = resolveKeys("plugins", payload.pluginKeys);
    const skills = resolveKeys("skills", payload.skillKeys);
    const visibility = ["all", "restricted", "private"].includes(payload.visibility) ? payload.visibility : "all";
    const permissionMode = ["read_only", "confirm_write", "full"].includes(payload.permissionMode)
      ? payload.permissionMode
      : "confirm_write";
    const modelProvider = String(payload.model?.provider || "").trim() || "internal";
    const modelName = String(payload.model?.name || "").trim() || "deepseek-v3";
    const id = newId("exp");
    const t = nowIso();
    db.prepare(
      `INSERT INTO experts(id, key, name, role_title, emoji, summary, role_prompt, version, model_provider, model_name,
        permission_mode, plugin_ids_json, skill_ids_json, visibility, status, owner, created_at, updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      id, key, name, String(payload.roleTitle || "").trim(),
      String(payload.emoji || "").trim() || "🧭",
      String(payload.summary || "").trim(), rolePrompt, normalizeVersion(payload.version),
      modelProvider, modelName, permissionMode,
      JSON.stringify(plugins.found), JSON.stringify(skills.found),
      visibility, "draft", user.displayName, t, t
    );
    saveGrants(id, payload.grants);
    audit(ctx, "导入专家", { type: "expert", id, name }, {
      from: originalKey,
      key,
      missingPlugins: plugins.missing,
      missingSkills: skills.missing,
    });
    return created({
      expert: toExpert(db.prepare("SELECT * FROM experts WHERE id = ?").get(id)),
      originalKey,
      keyRemapped: remapped,
      missingPlugins: plugins.missing,
      missingSkills: skills.missing,
    });
  });

  /** 把专家直接登记成一个可下发的市场插件（编译 + 落盘 + 写插件记录）。 */
  app.post("/api/experts/:id/publish", async (ctx) => {
    const user = requireRole(ctx, "admin", "publisher");
    const expert = db.prepare("SELECT * FROM experts WHERE id = ?").get(ctx.params.id);
    if (!expert) throw notFound("专家不存在");
    const compiled = compileExpertFromDb(ctx.params.id);

    // 复用同名插件记录；专家 key 即插件标识，保证市场里只有一个来源。
    let plugin = db.prepare("SELECT * FROM plugins WHERE key = ?").get(compiled.summary.pluginName);
    const t = nowIso();
    if (!plugin) {
      const id = newId("plg");
      db.prepare(
        `INSERT INTO plugins(id, key, name, summary, category, transport, endpoint, command, args_json,
          auth_type, auth_config_json, visibility, status, owner, created_at, updated_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).run(
        id, compiled.summary.pluginName,
        expert.name, expert.summary || "", "数字员工",
        // 专家包没有 MCP 端点：这里必须写 null。写成 "" 会让「有端点」的判断误判为真，
        // 数字员工就会混进插件市场（历史 bug）。
        "http", null, "", "[]", "none", "{}",
        "all", "enabled", user.displayName, t, t
      );
      plugin = db.prepare("SELECT * FROM plugins WHERE id = ?").get(id);
      audit(ctx, "plugin.create", { type: "plugin", id, name: expert.name }, { from: "expert", expertId: expert.id });
    }

    const dir = join(CONFIG.dataDir, "packages", plugin.id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, compiled.fileName), compiled.buffer);
    // 专家白名单里的 MCP 插件作为依赖写进市场清单：客户端装专家时会把它们一起装上。
    // 只依赖市场内确实存在且有包的插件——缺包的依赖会让整个安装失败。
    const dependencyKeys = [];
    for (const name of compiled.summary.mcpServerNames) {
      const key = name.replace(/^plugin:/u, "").split(":")[0];
      const dep = db.prepare("SELECT key, package_file FROM plugins WHERE key = ?").get(key);
      if (dep?.package_file && dep.key !== plugin.key) dependencyKeys.push(dep.key);
    }
    db.prepare(
      "UPDATE plugins SET package_file = ?, package_sha256 = ?, package_size = ?, dependencies_json = ?, updated_at = ? WHERE id = ?"
    ).run(
      compiled.fileName,
      compiled.sha256,
      compiled.buffer.length,
      JSON.stringify([...new Set(dependencyKeys)]),
      t,
      plugin.id
    );
    audit(ctx, "plugin.package.upload", { type: "plugin", id: plugin.id, name: expert.name }, {
      from: "expert",
      expertId: expert.id,
      fileName: compiled.fileName,
      sha256: compiled.sha256,
      dependencies: dependencyKeys,
    });

    return ok({
      pluginId: plugin.id,
      ...compiled.summary,
      fileName: compiled.fileName,
      sha256: compiled.sha256,
      dependencies: dependencyKeys,
      url: `${CONFIG.publicBaseUrl}/v1/packages/${plugin.id}/${encodeURIComponent(compiled.fileName)}`,
    });
  });

  app.post("/api/experts", async (ctx) => {
    const user = requireRole(ctx, "admin", "publisher");
    const body = ctx.body || {};
    required(body, ["name", "rolePrompt"]);
    const key = slugify(body.key || body.name) || `expert-${Date.now()}`;
    ensureUnique("experts", key, key);
    const id = newId("exp");
    const t = nowIso();
    db.prepare(
      `INSERT INTO experts(id, key, name, role_title, emoji, summary, role_prompt, version, model_provider, model_name,
        permission_mode, plugin_ids_json, skill_ids_json, visibility, status, owner, created_at, updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      id, key, body.name, body.roleTitle || "", body.emoji || "🧭", body.summary || "", body.rolePrompt,
      String(body.version || "1.0.0").trim().slice(0, 40) || "1.0.0",
      body.model?.provider || "internal", body.model?.name || "deepseek-v3",
      body.permissionMode || "confirm_write",
      JSON.stringify(visiblePluginIds(body.pluginIds)), JSON.stringify(visibleSkillIds(body.skillIds)),
      body.visibility || "all", body.status || "draft", user.displayName, t, t
    );
    saveGrants(id, body.grants);
    audit(ctx, "新增专家", { type: "expert", id, name: body.name }, { status: body.status || "draft" });
    return created(toExpert(db.prepare("SELECT * FROM experts WHERE id = ?").get(id)));
  });

  app.patch("/api/experts/:id", async (ctx) => {
    const user = requireRole(ctx, "admin", "publisher");
    const row = db.prepare("SELECT * FROM experts WHERE id = ?").get(ctx.params.id);
    if (!row) throw notFound("专家不存在");
    const b = ctx.body || {};
    const next = {
      name: b.name ?? row.name,
      role_title: b.roleTitle ?? row.role_title,
      emoji: b.emoji ?? row.emoji,
      summary: b.summary ?? row.summary,
      role_prompt: b.rolePrompt ?? row.role_prompt,
      version: b.version !== undefined ? String(b.version).trim().slice(0, 40) || "1.0.0" : row.version,
      model_provider: b.model?.provider ?? row.model_provider,
      model_name: b.model?.name ?? row.model_name,
      permission_mode: b.permissionMode ?? row.permission_mode,
      plugin_ids_json: b.pluginIds ? JSON.stringify(visiblePluginIds(b.pluginIds)) : row.plugin_ids_json,
      skill_ids_json: b.skillIds ? JSON.stringify(visibleSkillIds(b.skillIds)) : row.skill_ids_json,
      visibility: b.visibility ?? row.visibility,
      status: b.status ?? row.status,
    };
    db.prepare(
      `UPDATE experts SET name=?, role_title=?, emoji=?, summary=?, role_prompt=?, version=?, model_provider=?, model_name=?,
        permission_mode=?, plugin_ids_json=?, skill_ids_json=?, visibility=?, status=?, updated_at=? WHERE id=?`
    ).run(
      next.name, next.role_title, next.emoji, next.summary, next.role_prompt, next.version, next.model_provider, next.model_name,
      next.permission_mode, next.plugin_ids_json, next.skill_ids_json, next.visibility, next.status, nowIso(), row.id
    );
    if (Array.isArray(b.grants)) saveGrants(row.id, b.grants);
    audit(ctx, next.status !== row.status ? (next.status === "published" ? "发布专家" : "下线专家") : "更新专家",
      { type: "expert", id: row.id, name: next.name }, { from: row.status, to: next.status });
    return toExpert(db.prepare("SELECT * FROM experts WHERE id = ?").get(row.id));
  });

  app.delete("/api/experts/:id", async (ctx) => {
    requireRole(ctx, "admin");
    const row = db.prepare("SELECT * FROM experts WHERE id = ?").get(ctx.params.id);
    if (!row) throw notFound("专家不存在");
    db.prepare("DELETE FROM grants WHERE expert_id = ?").run(row.id);
    db.prepare("DELETE FROM experts WHERE id = ?").run(row.id);
    audit(ctx, "删除专家", { type: "expert", id: row.id, name: row.name }, {});
    return { ok: true };
  });

  app.post("/api/experts/:id/duplicate", async (ctx) => {
    const user = requireRole(ctx, "admin", "publisher");
    const row = db.prepare("SELECT * FROM experts WHERE id = ?").get(ctx.params.id);
    if (!row) throw notFound("专家不存在");
    const id = newId("exp");
    const key = `${row.key}-copy-${Math.random().toString(36).slice(2, 6)}`;
    const t = nowIso();
    db.prepare(
      `INSERT INTO experts(id, key, name, role_title, emoji, summary, role_prompt, version, model_provider, model_name,
        permission_mode, plugin_ids_json, skill_ids_json, visibility, status, owner, created_at, updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      id, key, `${row.name}（副本）`, row.role_title, row.emoji, row.summary, row.role_prompt, row.version || "1.0.0",
      row.model_provider, row.model_name, row.permission_mode, row.plugin_ids_json, row.skill_ids_json, row.visibility,
      "draft", user.displayName, t, t
    );
    audit(ctx, "复制专家", { type: "expert", id, name: `${row.name}（副本）` }, { from: row.id });
    return created(toExpert(db.prepare("SELECT * FROM experts WHERE id = ?").get(id)));
  });

  /* ---------- 插件 ---------- */
  app.get("/api/plugins", async (ctx) => {
    requireAuth(ctx);
    const rows = db.prepare("SELECT * FROM plugins ORDER BY created_at DESC").all();
    return { items: rows.map(toPlugin) };
  });

  app.post("/api/plugins", async (ctx) => {
    requireRole(ctx, "admin", "publisher");
    const b = ctx.body || {};
    required(b, ["name"]);
    const key = slugify(b.key || b.name) || `plugin-${Date.now()}`;
    ensureUnique("plugins", key, key);
    if ((b.transport || "streamable_http") === "stdio") required(b, ["command"]);
    else required(b, ["endpoint"]);
    const id = newId("plg");
    const t = nowIso();
    db.prepare(
      `INSERT INTO plugins(id, key, name, summary, category, transport, endpoint, command, args_json, auth_type,
        auth_config_json, visibility, version, status, owner, created_at, updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      id, key, b.name, b.summary || "", b.category || "业务系统", b.transport || "streamable_http",
      b.endpoint || null, b.command || null, JSON.stringify(b.args || []), b.authType || "oauth",
      JSON.stringify(sanitizeConfig(b.authConfig || {})), b.visibility || "all", b.version || "1.0.0",
      b.status || "draft", ctx.user.displayName, t, t
    );
    audit(ctx, "新增插件", { type: "plugin", id, name: b.name }, { transport: b.transport || "streamable_http" });
    return created(toPlugin(db.prepare("SELECT * FROM plugins WHERE id = ?").get(id)));
  });

  app.patch("/api/plugins/:id", async (ctx) => {
    requireRole(ctx, "admin", "publisher");
    const row = db.prepare("SELECT * FROM plugins WHERE id = ?").get(ctx.params.id);
    if (!row) throw notFound("插件不存在");
    const b = ctx.body || {};
    const next = {
      name: b.name ?? row.name,
      summary: b.summary ?? row.summary,
      category: b.category ?? row.category,
      transport: b.transport ?? row.transport,
      endpoint: b.endpoint ?? row.endpoint,
      command: b.command ?? row.command,
      args_json: b.args ? JSON.stringify(b.args) : row.args_json,
      auth_type: b.authType ?? row.auth_type,
      auth_config_json: b.authConfig ? JSON.stringify(sanitizeConfig(b.authConfig)) : row.auth_config_json,
      visibility: b.visibility ?? row.visibility,
      version: b.version ?? row.version,
      status: b.status ?? row.status,
    };
    db.prepare(
      `UPDATE plugins SET name=?, summary=?, category=?, transport=?, endpoint=?, command=?, args_json=?,
        auth_type=?, auth_config_json=?, visibility=?, version=?, status=?, updated_at=? WHERE id=?`
    ).run(
      next.name, next.summary, next.category, next.transport, next.endpoint, next.command, next.args_json,
      next.auth_type, next.auth_config_json, next.visibility, next.version, next.status, nowIso(), row.id
    );
    audit(ctx, next.status !== row.status ? (next.status === "enabled" ? "启用插件" : "停用插件") : "更新插件",
      { type: "plugin", id: row.id, name: next.name }, { version: next.version });
    return toPlugin(db.prepare("SELECT * FROM plugins WHERE id = ?").get(row.id));
  });

  app.delete("/api/plugins/:id", async (ctx) => {
    requireRole(ctx, "admin");
    const row = db.prepare("SELECT * FROM plugins WHERE id = ?").get(ctx.params.id);
    if (!row) throw notFound("插件不存在");
    db.prepare("DELETE FROM plugins WHERE id = ?").run(row.id);
    audit(ctx, "删除插件", { type: "plugin", id: row.id, name: row.name }, {});
    return { ok: true };
  });

  app.post("/api/plugins/:id/test", async (ctx) => {
    requireAuth(ctx);
    const row = db.prepare("SELECT * FROM plugins WHERE id = ?").get(ctx.params.id);
    if (!row) throw notFound("插件不存在");
    // 真实连通性探测：对 HTTP 类插件发一次初始化探测；stdio 类只做配置检查
    if (row.transport === "stdio") {
      return { reachable: Boolean(row.command), detail: row.command ? `将以 ${row.command} 拉起本地进程` : "缺少启动命令", latencyMs: 0 };
    }
    const started = Date.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(row.endpoint, { method: "GET", signal: controller.signal }).catch((e) => ({ ok: false, status: 0, e }));
      clearTimeout(timer);
      const latencyMs = Date.now() - started;
      const reachable = Boolean(res.ok) || [401, 403, 405].includes(res.status);
      return {
        reachable,
        status: res.status || 0,
        latencyMs,
        detail: reachable
          ? res.status === 401 || res.status === 403
            ? "端点可达，返回 401/403（符合 MCP 授权规范，客户端将发起 OAuth 登录）"
            : "端点可达"
          : `无法连接：${res.e?.message || `HTTP ${res.status}`}`,
      };
    } catch (e) {
      return { reachable: false, latencyMs: Date.now() - started, detail: `无法连接：${e.message}` };
    }
  });

  /* ---------- 技能 ---------- */
  app.get("/api/skills", async (ctx) => {
    requireAuth(ctx);
    const rows = db.prepare("SELECT * FROM skills ORDER BY installs DESC, created_at DESC").all();
    return { items: rows.map(toSkill) };
  });

  app.get("/api/skills/:id", async (ctx) => {
    requireAuth(ctx);
    const row = db.prepare("SELECT * FROM skills WHERE id = ?").get(ctx.params.id);
    if (!row) throw notFound("技能不存在");
    return toSkill(row);
  });

  /** 导出为客户端原生 SKILL.md，附带的元数据可原样导回。 */
  app.get("/api/skills/:id/export", async (ctx) => {
    requireAuth(ctx);
    const row = db.prepare("SELECT * FROM skills WHERE id = ?").get(ctx.params.id);
    if (!row) throw notFound("技能不存在");
    return {
      __file: true,
      type: "text/markdown; charset=utf-8",
      name: `${row.key}.md`,
      body: buildSkillMarkdown({
        key: row.key,
        name: row.name,
        summary: row.summary,
        category: row.category,
        version: row.version,
        trigger: row.trigger_desc,
        content: row.content,
      }),
    };
  });

  /** 导入技能：接受 SKILL.md 或 JSON 技能包，key 冲突改名并落草稿。 */
  app.post("/api/skills/import", async (ctx) => {
    const user = requireRole(ctx, "admin", "publisher");
    const raw = rawBody(ctx);
    if (!String(raw).trim()) throw bad("导入内容不能为空");
    const payload = parseSkillTransfer(raw);
    const content = String(payload.content || "").trim();
    const name = String(payload.name || "").trim() || String(payload.key || "").trim();
    const missing = [];
    if (!name) missing.push("name");
    if (!content) missing.push("content");
    if (missing.length) throw bad(`技能包缺少必填字段：${missing.join("、")}`, { missing });

    const originalKey = String(payload.key || "").trim();
    let base = originalKey;
    if (!PLUGIN_NAME_PATTERN.test(base)) base = slugify(originalKey);
    if (!base) base = slugify(name);
    if (!base) base = "skill";
    let key = base;
    let remapped = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      if (!db.prepare("SELECT id FROM skills WHERE key = ?").get(key)) break;
      remapped = true;
      key = `${base}-import-${randomSuffix(4)}`;
    }

    const id = newId("skl");
    const t = nowIso();
    db.prepare(
      `INSERT INTO skills(id, key, name, summary, category, version, trigger_desc, content, status, author, installs, created_at, updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,0,?,?)`
    ).run(
      id, key, name, collapseWhitespace(payload.summary),
      valueOrDefault(String(payload.category || "").trim(), "通用"),
      normalizeVersion(payload.version), String(payload.trigger || "").trim(),
      content, "draft", user.displayName, t, t
    );
    audit(ctx, "导入技能", { type: "skill", id, name }, { from: originalKey, key });
    return created({
      skill: toSkill(db.prepare("SELECT * FROM skills WHERE id = ?").get(id)),
      originalKey,
      keyRemapped: remapped,
    });
  });

  app.post("/api/skills", async (ctx) => {
    requireRole(ctx, "admin", "publisher");
    const b = ctx.body || {};
    required(b, ["name", "content"]);
    const key = slugify(b.key || b.name) || `skill-${Date.now()}`;
    ensureUnique("skills", key, key);
    const id = newId("skl");
    const t = nowIso();
    db.prepare(
      `INSERT INTO skills(id, key, name, summary, category, version, trigger_desc, content, status, author, installs, created_at, updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,0,?,?)`
    ).run(id, key, b.name, b.summary || "", b.category || "通用", b.version || "1.0.0", b.trigger || "",
      b.content, b.status || "draft", ctx.user.displayName, t, t);
    audit(ctx, "新增技能", { type: "skill", id, name: b.name }, { version: b.version || "1.0.0" });
    return created(toSkill(db.prepare("SELECT * FROM skills WHERE id = ?").get(id)));
  });

  app.patch("/api/skills/:id", async (ctx) => {
    requireRole(ctx, "admin", "publisher");
    const row = db.prepare("SELECT * FROM skills WHERE id = ?").get(ctx.params.id);
    if (!row) throw notFound("技能不存在");
    const b = ctx.body || {};
    db.prepare(
      `UPDATE skills SET name=?, summary=?, category=?, version=?, trigger_desc=?, content=?, status=?, updated_at=? WHERE id=?`
    ).run(
      b.name ?? row.name, b.summary ?? row.summary, b.category ?? row.category, b.version ?? row.version,
      b.trigger ?? row.trigger_desc, b.content ?? row.content, b.status ?? row.status, nowIso(), row.id
    );
    audit(ctx, b.status && b.status !== row.status ? (b.status === "published" ? "发布技能" : "下线技能") : "更新技能",
      { type: "skill", id: row.id, name: b.name ?? row.name }, { version: b.version ?? row.version });
    return toSkill(db.prepare("SELECT * FROM skills WHERE id = ?").get(row.id));
  });

  app.delete("/api/skills/:id", async (ctx) => {
    requireRole(ctx, "admin");
    const row = db.prepare("SELECT * FROM skills WHERE id = ?").get(ctx.params.id);
    if (!row) throw notFound("技能不存在");
    db.prepare("DELETE FROM skills WHERE id = ?").run(row.id);
    audit(ctx, "删除技能", { type: "skill", id: row.id, name: row.name }, {});
    return { ok: true };
  });

  /* ---------- 用户 ---------- */
  app.get("/api/users", async (ctx) => {
    requireRole(ctx, "admin");
    const rows = db.prepare("SELECT * FROM users ORDER BY created_at").all();
    const states = new Map(
      db.prepare("SELECT user_id, active_expert_id FROM user_expert_state").all().map((r) => [r.user_id, r.active_expert_id])
    );
    const experts = new Map(
      db.prepare("SELECT id, name, emoji FROM experts").all().map((r) => [r.id, r])
    );
    const fallbackId = getSetting("default_expert_id", "");
    const fallback = fallbackId ? experts.get(fallbackId) : null;
    return {
      items: rows.map((u) => {
        const ownId = states.get(u.id);
        // 没自己选过的，实际生效的是后台默认专家，这一列要照实显示
        const effective = ownId ? experts.get(ownId) : fallback;
        return {
          ...publicUser(u),
          workMode: effective
            ? { id: effective.id, name: effective.name, emoji: effective.emoji, inherited: !ownId }
            : null,
        };
      }),
    };
  });

  app.post("/api/users", async (ctx) => {
    requireRole(ctx, "admin");
    const b = ctx.body || {};
    required(b, ["username", "displayName", "password"]);
    const exists = db.prepare("SELECT id FROM users WHERE username = ?").get(b.username);
    if (exists) throw new HttpError(409, "用户名已存在", "conflict");
    if (String(b.password).length < 8) throw bad("密码至少 8 位");
    const id = newId("usr");
    db.prepare(
      `INSERT INTO users(id, username, display_name, email, department, role, status, password_hash, created_at)
       VALUES(?,?,?,?,?,?,?,?,?)`
    ).run(id, b.username, b.displayName, b.email || "", b.department || "", b.role || "member", b.status || "active",
      hashPassword(b.password), nowIso());
    audit(ctx, "新增用户", { type: "user", id, name: b.displayName }, { department: b.department, role: b.role });
    return created(publicUser(db.prepare("SELECT * FROM users WHERE id = ?").get(id)));
  });

  app.patch("/api/users/:id", async (ctx) => {
    requireRole(ctx, "admin");
    const row = db.prepare("SELECT * FROM users WHERE id = ?").get(ctx.params.id);
    if (!row) throw notFound("用户不存在");
    const b = ctx.body || {};
    if (row.id === ctx.user.id && b.status === "disabled") throw bad("不能停用当前登录账号");
    db.prepare("UPDATE users SET display_name=?, email=?, department=?, role=?, status=? WHERE id=?").run(
      b.displayName ?? row.display_name, b.email ?? row.email, b.department ?? row.department,
      b.role ?? row.role, b.status ?? row.status, row.id
    );
    if (b.password) {
      db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(b.password), row.id);
      db.prepare("UPDATE sessions SET revoked = 1 WHERE user_id = ?").run(row.id);
    }
    audit(ctx, "更新用户", { type: "user", id: row.id, name: b.displayName ?? row.display_name }, { role: b.role ?? row.role, status: b.status ?? row.status });
    return publicUser(db.prepare("SELECT * FROM users WHERE id = ?").get(row.id));
  });

  app.delete("/api/users/:id", async (ctx) => {
    requireRole(ctx, "admin");
    const row = db.prepare("SELECT * FROM users WHERE id = ?").get(ctx.params.id);
    if (!row) throw notFound("用户不存在");
    if (row.id === ctx.user.id) throw bad("不能删除当前登录账号");
    db.prepare("DELETE FROM users WHERE id = ?").run(row.id);
    audit(ctx, "删除用户", { type: "user", id: row.id, name: row.display_name }, {});
    return { ok: true };
  });

  /* ---------- 审计 ---------- */
  app.get("/api/audit", async (ctx) => {
    requireAuth(ctx);
    const limit = Math.min(Number(ctx.query.limit || 50), 200);
    const page = Math.max(Number(ctx.query.page || 1), 1);
    const where = [];
    const args = [];
    if (ctx.query.action) {
      where.push("action LIKE ?");
      args.push(`%${ctx.query.action}%`);
    }
    if (ctx.query.actor) {
      where.push("actor_name LIKE ?");
      args.push(`%${ctx.query.actor}%`);
    }
    // since：只看某个时间点之后的记录。回归脚本用它避开历史数据，
    // 运营查「今天发生了什么」也用得上。
    if (ctx.query.since) {
      where.push("created_at >= ?");
      args.push(String(ctx.query.since));
    }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const total = db.prepare(`SELECT COUNT(*) AS c FROM audit_logs ${clause}`).get(...args).c;
    const items = db
      .prepare(`SELECT * FROM audit_logs ${clause} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)
      .all(...args, limit, (page - 1) * limit)
      .map((r) => ({
        id: r.id,
        actor: r.actor_name,
        action: r.action,
        targetType: r.target_type,
        targetId: r.target_id,
        target: r.target_name,
        detail: obj(r.detail_json),
        ip: r.ip,
        createdAt: r.created_at,
      }));
    return { items, total, page, limit };
  });

  /**
   * 校验审计链是否完整。
   *
   * 返回第一条断裂的记录 id 与原因：`brokenAt` 前后对比就能看到手改痕迹。
   * `?limit=N` 只校验最近 N 条，用于大库快速自查（默认全量）。
   * 只有管理员能调——普通成员看到断裂位置也做不了什么，反而知道从哪改。
   */
  app.get("/api/audit/verify", async (ctx) => {
    requireRole(ctx, "admin");
    const limit = Number(ctx.query.limit || 0);
    const result = verifyAuditChain({ limit: Number.isFinite(limit) && limit > 0 ? limit : 0 });
    return {
      ...result,
      // 断裂说明库里的历史与写入时的内容不一致：要么被手改，要么迁移出错。
      message: result.ok
        ? `审计链完整（校验 ${result.checked} 条）`
        : `审计链在记录 ${result.brokenAt} 处断裂：${result.reason}`,
    };
  });

  /* ---------- 设置与下发 ---------- */
  const SETTING_KEYS = [
    "org_name",
    "manifest_channel",
    "require_update",
    "min_client_version",
    "allow_self_install",
    "brand_app_name",
    "default_expert_id",
  ];

  app.get("/api/settings", async (ctx) => {
    requireAuth(ctx);
    const settings = {};
    for (const k of SETTING_KEYS) settings[k] = getSetting(k, "");
    return { settings, baseUrl: CONFIG.publicBaseUrl };
  });

  app.patch("/api/settings", async (ctx) => {
    requireRole(ctx, "admin");
    const b = ctx.body || {};
    // 默认专家要校验存在且已发布，写个错的 id 进去会让所有没选过的人
    // 静默落到「不裁剪」，看起来像默认没生效
    if (b.default_expert_id) {
      const row = db.prepare("SELECT id FROM experts WHERE id = ? AND status = 'published'").get(String(b.default_expert_id));
      if (!row) throw bad("默认专家不存在或未发布");
    }
    for (const k of SETTING_KEYS) {
      if (b[k] !== undefined) setSetting(k, b[k]);
    }
    audit(ctx, "更新下发配置", { type: "settings", id: "settings", name: "下发策略" }, b);
    return { ok: true };
  });

  app.get("/api/manifest", async (ctx) => {
    const user = requireAuth(ctx);
    return buildManifest({ userId: user.id, isAdmin: user.role === "admin" });
  });

  // 桌面端拉取入口：允许匿名（引导阶段），带 token 时按授权裁剪
  app.get("/v1/desktop/manifest", async (ctx) => {
    if (!ctx.user && !CONFIG.allowAnonymousManifest) throw unauthorized("需要先登录控制面");
    const manifest = buildManifest({ userId: ctx.user?.id || null, isAdmin: ctx.user?.role === "admin" });
    const etag = `W/"${manifest.version}"`;
    if (ctx.headers["if-none-match"] === etag) return { __status: 304, body: "" };
    ctx.res.setHeader("etag", etag);
    ctx.res.setHeader("cache-control", "no-cache");
    return manifest;
  });

  app.get("/v1/system/health", async () => ({
    status: "ok",
    name: getSetting("org_name", CONFIG.orgName),
    time: nowIso(),
    version: "0.1.0",
  }));

  app.get("/v1/me", async (ctx) => {
    const user = requireAuth(ctx);
    return {
      user: { id: user.id, name: user.displayName, email: user.email, department: user.department, role: user.role },
      org: { id: "hx", name: getSetting("org_name", CONFIG.orgName) },
    };
  });

  /* ---------- 模型供应商 ---------- */
  app.get("/api/providers", async (ctx) => {
    requireAuth(ctx);
    const rows = db.prepare("SELECT * FROM llm_providers ORDER BY created_at").all();
    const counts = Object.fromEntries(
      db.prepare("SELECT provider_ref, COUNT(*) AS c FROM model_aliases GROUP BY provider_ref").all().map((r) => [r.provider_ref, r.c])
    );
    const enabledCounts = Object.fromEntries(
      db.prepare("SELECT provider_ref, COUNT(*) AS c FROM model_aliases WHERE status = 'enabled' GROUP BY provider_ref").all().map((r) => [r.provider_ref, r.c])
    );
    return { items: rows.map((r) => toProvider(r, counts[r.id] || 0, enabledCounts[r.id] || 0)) };
  });

  app.post("/api/providers", async (ctx) => {
    requireRole(ctx, "admin");
    const b = ctx.body || {};
    required(b, ["name", "baseUrl"]);
    const key = slugify(b.key || b.name) || `provider-${Date.now()}`;
    ensureUnique("llm_providers", key, key);
    const id = `lpr_${newId("p").slice(2)}`;
    const t = nowIso();
    db.prepare(
      `INSERT INTO llm_providers(id, key, name, vendor, base_url, api_key, provider_id, status, note, created_at, updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`
    ).run(id, key, b.name, b.vendor || "openai-compatible", b.baseUrl, b.apiKey || null,
      slugify(b.providerId || key) || key, b.status || "enabled", b.note || "", t, t);
    audit(ctx, "新增模型供应商", { type: "provider", id, name: b.name }, { baseUrl: b.baseUrl });
    return created(toProvider(db.prepare("SELECT * FROM llm_providers WHERE id = ?").get(id), 0));
  });

  app.patch("/api/providers/:id", async (ctx) => {
    requireRole(ctx, "admin");
    const row = db.prepare("SELECT * FROM llm_providers WHERE id = ?").get(ctx.params.id);
    if (!row) throw notFound("供应商不存在");
    const b = ctx.body || {};
    const apiKey = b.clearApiKey ? null : (typeof b.apiKey === "string" && b.apiKey.trim() ? b.apiKey.trim() : row.api_key);
    db.prepare("UPDATE llm_providers SET name=?, vendor=?, base_url=?, api_key=?, provider_id=?, status=?, note=?, updated_at=? WHERE id=?").run(
      b.name ?? row.name, b.vendor ?? row.vendor, b.baseUrl ?? row.base_url, apiKey,
      b.providerId ?? row.provider_id, b.status ?? row.status, b.note ?? row.note, nowIso(), row.id
    );
    audit(ctx, b.status && b.status !== row.status ? (b.status === "enabled" ? "启用供应商" : "停用供应商") : "更新供应商",
      { type: "provider", id: row.id, name: b.name ?? row.name }, {});
    return toProvider(db.prepare("SELECT * FROM llm_providers WHERE id = ?").get(row.id));
  });

  app.delete("/api/providers/:id", async (ctx) => {
    requireRole(ctx, "admin");
    const row = db.prepare("SELECT * FROM llm_providers WHERE id = ?").get(ctx.params.id);
    if (!row) throw notFound("供应商不存在");
    const n = db.prepare("SELECT COUNT(*) AS c FROM model_aliases WHERE provider_ref = ?").get(row.id).c;
    db.prepare("DELETE FROM model_aliases WHERE provider_ref = ?").run(row.id);
    db.prepare("DELETE FROM llm_providers WHERE id = ?").run(row.id);
    audit(ctx, "删除供应商", { type: "provider", id: row.id, name: row.name }, { removedAliases: n });
    return { ok: true, removedAliases: n };
  });

  app.post("/api/providers/:id/test", async (ctx) => {
    requireAuth(ctx);
    const row = db.prepare("SELECT * FROM llm_providers WHERE id = ?").get(ctx.params.id);
    if (!row) throw notFound("供应商不存在");
    const started = Date.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`${row.base_url.replace(/\/$/, "")}/models`, {
        headers: row.api_key ? { authorization: `Bearer ${row.api_key}` } : {},
        signal: controller.signal,
      });
      clearTimeout(timer);
      const latencyMs = Date.now() - started;
      let modelCount = null;
      if (res.ok) {
        const data = await res.json().catch(() => null);
        if (Array.isArray(data?.data)) modelCount = data.data.length;
      }
      return {
        reachable: res.ok,
        status: res.status,
        latencyMs,
        modelCount,
        detail: res.ok ? `网关可达，返回 ${modelCount ?? "?"} 个模型` : `返回 HTTP ${res.status}`,
      };
    } catch (e) {
      return { reachable: false, latencyMs: Date.now() - started, detail: `无法连接：${e.message}` };
    }
  });

  /* ---------- 模型别名 ---------- */
  app.get("/api/aliases", async (ctx) => {
    requireAuth(ctx);
    const rows = db.prepare(
      `SELECT a.*, p.name AS provider_name FROM model_aliases a
       LEFT JOIN llm_providers p ON p.id = a.provider_ref
       ORDER BY a.sort_order, a.created_at`
    ).all();
    return { items: rows.map((r) => toAlias(r, r.provider_name)) };
  });

  app.post("/api/aliases", async (ctx) => {
    requireRole(ctx, "admin", "publisher");
    const b = ctx.body || {};
    required(b, ["name", "providerRef", "targetModel"]);
    const key = slugify(b.key || b.name);
    if (!key) throw bad("别名标识需为英文或数字");
    ensureUnique("model_aliases", key, key);
    const provider = db.prepare("SELECT * FROM llm_providers WHERE id = ?").get(b.providerRef);
    if (!provider) throw bad("指向的供应商不存在");
    const id = newId("als");
    const t = nowIso();
    db.prepare(
      `INSERT INTO model_aliases(id, key, name, description, badge, icon, provider_ref, target_model, fallback_model,
        capabilities_json, context_tokens, status, sort_order, created_at, updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(id, key, b.name, b.description || "", b.badge || "", b.icon || "⚡", b.providerRef, b.targetModel,
      b.fallbackModel || null, JSON.stringify(b.capabilities || []), Number(b.contextTokens) || 32000,
      b.status || "enabled", Number(b.sortOrder) || 100, t, t);
    audit(ctx, "新增模型别名", { type: "alias", id, name: b.name }, { target: `${provider.name} / ${b.targetModel}` });
    return created(toAlias(db.prepare("SELECT * FROM model_aliases WHERE id = ?").get(id), provider.name));
  });

  app.patch("/api/aliases/:id", async (ctx) => {
    requireRole(ctx, "admin", "publisher");
    const row = db.prepare("SELECT * FROM model_aliases WHERE id = ?").get(ctx.params.id);
    if (!row) throw notFound("别名不存在");
    const b = ctx.body || {};
    db.prepare(
      `UPDATE model_aliases SET name=?, description=?, badge=?, icon=?, provider_ref=?, target_model=?, fallback_model=?,
        capabilities_json=?, context_tokens=?, status=?, sort_order=?, updated_at=? WHERE id=?`
    ).run(
      b.name ?? row.name, b.description ?? row.description, b.badge ?? row.badge, b.icon ?? row.icon,
      b.providerRef ?? row.provider_ref, b.targetModel ?? row.target_model,
      b.fallbackModel !== undefined ? (b.fallbackModel || null) : row.fallback_model,
      b.capabilities ? JSON.stringify(b.capabilities) : row.capabilities_json,
      b.contextTokens !== undefined ? Number(b.contextTokens) : row.context_tokens,
      b.status ?? row.status, b.sortOrder !== undefined ? Number(b.sortOrder) : row.sort_order,
      nowIso(), row.id
    );
    audit(ctx, b.status && b.status !== row.status ? (b.status === "enabled" ? "启用别名" : "停用别名") : "更新模型别名",
      { type: "alias", id: row.id, name: b.name ?? row.name }, {});
    const provider = db.prepare("SELECT name FROM llm_providers WHERE id = ?").get(b.providerRef ?? row.provider_ref);
    return toAlias(db.prepare("SELECT * FROM model_aliases WHERE id = ?").get(row.id), provider?.name || null);
  });

  app.delete("/api/aliases/:id", async (ctx) => {
    requireRole(ctx, "admin");
    const row = db.prepare("SELECT * FROM model_aliases WHERE id = ?").get(ctx.params.id);
    if (!row) throw notFound("别名不存在");
    db.prepare("DELETE FROM model_aliases WHERE id = ?").run(row.id);
    audit(ctx, "删除模型别名", { type: "alias", id: row.id, name: row.name }, {});
    return { ok: true };
  });

  /* ---------- 桌面端登录：一次性凭据（handoff grant） ---------- */
  app.post("/api/desktop/handoff", async (ctx) => {
    const user = requireAuth(ctx);
    const grant = randomToken(24);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    db.prepare("INSERT INTO handoffs(grant, user_id, created_at, expires_at, ip) VALUES(?,?,?,?,?)").run(
      grant, user.id, nowIso(), expiresAt, ctx.ip
    );
    audit(ctx, "生成桌面登录码", { type: "user", id: user.id, name: user.displayName }, {});
    const base = CONFIG.publicBaseUrl;
    return {
      grant,
      expiresAt,
      baseUrl: base,
      deepLink: `${CONFIG.desktopDeepLinkScheme}://desktop-auth?grant=${encodeURIComponent(grant)}&denBaseUrl=${encodeURIComponent(base)}`,
    };
  });

  // 桌面端兑换一次性凭据 → 会话令牌（OpenWork 客户端调用此路径）
  app.post("/v1/auth/desktop-handoff/exchange", async (ctx) => {
    const grant = String(ctx.body?.grant || "").trim();
    if (!grant) throw bad("缺少 grant");
    const row = db.prepare("SELECT * FROM handoffs WHERE grant = ?").get(grant);
    if (!row) throw new HttpError(401, "登录码无效，请重新生成", "invalid_grant");
    if (row.consumed_at) throw new HttpError(401, "登录码已被使用，请重新生成", "grant_consumed");
    if (new Date(row.expires_at) < new Date()) throw new HttpError(401, "登录码已过期，请重新生成", "grant_expired");
    const userRow = db.prepare("SELECT * FROM users WHERE id = ?").get(row.user_id);
    if (!userRow || userRow.status !== "active") throw forbidden("该账号已停用");
    db.prepare("UPDATE handoffs SET consumed_at = ? WHERE grant = ?").run(nowIso(), grant);
    const session = createSession(userRow, { ip: ctx.ip, ua: ctx.headers["user-agent"] });
    touchLogin(userRow.id);
    audit({ ...ctx, user: publicUser(userRow) }, "桌面端登录", { type: "session", id: userRow.id, name: "桌面客户端" }, { grant: grant.slice(0, 6) + "…" });
    const orgName = getSetting("org_name", CONFIG.orgName);
    return {
      token: session.token,
      accessToken: session.token,
      expiresAt: session.expiresAt,
      user: {
        id: userRow.id,
        email: userRow.email || `${userRow.username}@hx.local`,
        name: userRow.display_name,
        displayName: userRow.display_name,
        department: userRow.department,
      },
      organization: { id: "hx", name: orgName, slug: "hx" },
    };
  });

  // 客户端登录后读取组织上下文
  app.get("/v1/me/orgs", async (ctx) => {
    requireAuth(ctx);
    const orgName = getSetting("org_name", CONFIG.orgName);
    return {
      orgs: [{ id: "hx", name: orgName, slug: "hx", role: ctx.user.role }],
      activeOrgId: "hx",
      activeOrgSlug: "hx",
      defaultOrgId: "hx",
    };
  });

  // 切换当前组织（客户端登录后的引导步骤）
  app.post("/v1/me/active-organization", async (ctx) => {
    requireAuth(ctx);
    const orgId = String(ctx.body?.organizationId || ctx.body?.organizationSlug || "hx");
    const orgName = getSetting("org_name", CONFIG.orgName);
    return {
      ok: true,
      activeOrgId: orgId === "hx" ? "hx" : orgId,
      activeOrgSlug: "hx",
      organization: { id: "hx", name: orgName, slug: "hx" },
    };
  });

  /* ---------- 客户端：桌面策略 ---------- */
  /* 桌面策略全部放开：这是自建发行版，不套 OpenWork 的商业限制。
     allowZenModel 关掉——我们不提供它的免费 starter 模型，
     否则客户端会平白多出一个用不了的「Auto」。 */
  app.get("/v1/me/desktop-config", async (ctx) => {
    requireAuth(ctx);
    const gateway = db.prepare("SELECT * FROM llm_providers WHERE status = 'enabled' ORDER BY created_at").get();
    const defaultAlias = gateway
      ? db.prepare("SELECT * FROM model_aliases WHERE provider_ref = ? AND status = 'enabled' ORDER BY sort_order").get(gateway.id)
      : null;
    const { expert } = expertScope(ctx.user);
    return {
      allowCustomProviders: true,
      allowZenModel: false,
      allowMultipleWorkspaces: true,
      allowControlSettings: true,
      allowManageExtensions: true,
      allowBuiltInExtensions: true,
      allowAlphaUpdates: false,
      showWelcomePage: true,
      brandAppName: getSetting("brand_app_name", "和信 AI 工作台"),
      connectEnabled: false,
      dashboardEnabled: false,
      automationsEnabled: false,
      desktopAutomationsEnabled: false,
      cloudAutomationsEnabled: false,
      localProviderMirror: true,
      removeOpencodeZen: true,
      ...(gateway && defaultAlias
        ? { defaultModel: { providerID: gateway.id, modelID: defaultAlias.key, source: "organization" } }
        : {}),
      // 壳层顶部的工作模式切换器读这个
      ...(expert ? { activeExpert: expertForClient(expert) } : {}),
    };
  });

  /* ---------- 客户端：专家（工作模式） ---------- */
  app.get("/v1/me/experts", async (ctx) => {
    requireAuth(ctx);
    const visible = visibleExperts(ctx.user);
    const active = activeExpertOf(ctx.user);
    return {
      items: visible.map((e) => ({ ...expertForClient(e), active: active?.id === e.id })),
      activeExpertId: active?.id || null,
    };
  });

  app.post("/v1/me/active-expert", async (ctx) => {
    requireAuth(ctx);
    const expertId = String(ctx.body?.expertId || ctx.body?.id || "").trim();
    const visible = visibleExperts(ctx.user);
    // 传空或 "all" = 退出专家模式，回到全量能力
    const cleared = !expertId || expertId === "all";
    const target = cleared ? null : visible.find((e) => e.id === expertId);
    if (!cleared && !target) throw forbidden("该专家未分配给你");
    db.prepare(
      `INSERT INTO user_expert_state(user_id, active_expert_id, updated_at) VALUES(?,?,?)
       ON CONFLICT(user_id) DO UPDATE SET active_expert_id = excluded.active_expert_id, updated_at = excluded.updated_at`
    ).run(ctx.user.id, target?.id || null, nowIso());
    audit(ctx, "切换工作模式", { type: "expert", id: target?.id || null, name: target?.name || "全部能力" }, {});
    return {
      ok: true,
      activeExpertId: target?.id || null,
      expert: target ? expertForClient(target) : null,
    };
  });


  /* ---------- 客户端：连接器（把插件表映射成 MCP 连接） ---------- */
  const CONNECTION_AUTH = { oauth: "oauth", bearer: "apikey", none: "none" };

  function clientConnections(scope) {
    const rows = db
      .prepare("SELECT * FROM plugins WHERE status = 'enabled' ORDER BY category, name")
      .all();
    return rows
      .filter((r) => r.endpoint && r.visibility !== "admin")
      // 专家装配了连接器就只留这几件；没装配按全量
      .filter((r) => !scope?.pluginIds || scope.pluginIds.includes(r.id))
      .map((r) => {
        const authType = CONNECTION_AUTH[r.auth_type] || "oauth";
        return {
          id: r.id,
          name: r.name,
          url: r.endpoint,
          authType,
          // OAuth 连接器按人授权；Bearer 由服务端保管，属于共享凭据
          credentialMode: authType === "oauth" ? "per_member" : "shared",
          exposeDirectly: false,
          connected: true,
          connectedAt: r.updated_at,
          connectedForMe: authType !== "oauth",
          setupRequired: false,
          credentialHealth: authType === "oauth" ? "unknown" : "ready",
          readiness: {
            status: "ready",
            checkedAt: r.updated_at,
            lastSuccessfulAt: null,
            reason: null,
            failure: null,
          },
        };
      });
  }

  app.get("/v1/mcp-connections", async (ctx) => {
    requireAuth(ctx);
    const scope = String(ctx.query.scope || "usable");
    // manageable 与 usable 目前同源：后台已按可见范围裁剪
    return { connections: clientConnections(expertScope(ctx.user)), scope };
  });

  /* 未安装的连接器预设：让客户端能列出「可以添加的」 */
  app.get("/v1/mcp-connections/presets", async (ctx) => {
    requireAuth(ctx);
    const rows = db
      .prepare(`SELECT * FROM plugins WHERE status <> 'enabled' AND ${CONNECTOR_PLUGIN_WHERE} ORDER BY name`)
      .all();
    return {
      presets: rows.map((r) => ({
        presetId: r.key,
        displayName: r.name,
        description: r.summary || "",
        url: r.endpoint,
        authType: CONNECTION_AUTH[r.auth_type] || "oauth",
      })),
    };
  });

  /* MCP 网关令牌：客户端拿它访问受控 MCP 端点 */
  app.post("/v1/mcp/token", async (ctx) => {
    requireAuth(ctx);
    return {
      token: gatewayToken(),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      tokenType: "Bearer",
    };
  });

  /* 会话运行器令牌：客户端自建会话时用 */
  app.post("/v1/session-runners/token", async (ctx) => {
    requireAuth(ctx);
    return {
      token: gatewayToken(),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      tokenType: "Bearer",
    };
  });

  /* ---------- 客户端：资料库与市场能力 ---------- */
  app.get("/v1/me/library", async (ctx) => {
    requireAuth(ctx);
    const scope = expertScope(ctx.user);
    const rows = db
      .prepare("SELECT * FROM plugins WHERE status = 'enabled' AND visibility <> 'admin' ORDER BY name")
      .all()
      .filter((r) => !scope.pluginIds || scope.pluginIds.includes(r.id));
    return {
      items: rows.map((r) => ({
        type: "plugin",
        id: r.id,
        name: r.name,
        description: r.summary || null,
      })),
    };
  });

  /* 已分配给成员的市场能力：把技能映射成 skill 类型的配置对象 */
  app.get("/v1/resources/marketplace-capabilities", async (ctx) => {
    requireAuth(ctx);
    const scope = expertScope(ctx.user);
    const skills = db
      .prepare("SELECT * FROM skills WHERE status = 'published' ORDER BY category, name")
      .all()
      .filter((r) => !scope.skillIds || scope.skillIds.includes(r.id));
    // 与 /v1/mcp-connections 保持一致：只算有端点、非管理员专属的插件
    const plugins = db
      .prepare(`SELECT * FROM plugins WHERE status = 'enabled' AND visibility <> 'admin' AND ${CONNECTOR_PLUGIN_WHERE} ORDER BY name`)
      .all()
      .filter((r) => !scope.pluginIds || scope.pluginIds.includes(r.id));
    const items = [
      ...skills.map((r) => ({
        configObjectId: r.id,
        marketplaceId: "mkt_skills",
        objectType: "skill",
        pluginId: r.id,
        name: r.name,
      })),
      ...plugins.map((r) => ({
        configObjectId: r.id,
        marketplaceId: "mkt_plugins",
        objectType: "mcp",
        pluginId: r.id,
        name: r.name,
      })),
    ];
    return { items };
  });

  /* 资源快照：客户端用它发现「有什么变了」 */
  app.get("/v1/resources", async (ctx) => {
    requireAuth(ctx);
    const providers = db
      .prepare("SELECT * FROM llm_providers WHERE status = 'enabled' ORDER BY created_at")
      .all();
    return {
      organizationId: "hx",
      orgMemberId: ctx.user.id,
      teamIds: [],
      resources: {
        llmProviders: Object.fromEntries(providers.map((p) => [p.id, p.updated_at])),
        marketplaces: [
          { marketplaceId: "mkt_skills", lastUpdatedAt: nowIso(), configItems: [] },
          { marketplaceId: "mkt_plugins", lastUpdatedAt: nowIso(), configItems: [] },
        ],
      },
    };
  });

  /* ---------- 客户端：能力市场（插件市场 + 技能商城） ---------- */
  const MARKETPLACES = (scope) => {
    const skillCount = db.prepare("SELECT COUNT(*) AS c FROM skills WHERE status = 'published'").get().c;
    const pluginCount = db
      .prepare(`SELECT COUNT(*) AS c FROM plugins WHERE status = 'enabled' AND ${CONNECTOR_PLUGIN_WHERE}`)
      .get().c;
    // 计数要跟 /resolved 的条目数一致，否则市场卡片写着 6 个、点进去只有 3 个
    const scopedSkills = scope?.skillIds ? scope.skillIds.length : skillCount;
    const scopedPlugins = scope?.pluginIds ? scope.pluginIds.length : pluginCount;
    const stamp = db.prepare("SELECT MAX(updated_at) AS t FROM plugins").get()?.t || nowIso();
    return [
      {
        id: "mkt_plugins",
        name: "和信插件市场",
        description: "连接 OA、合同、工单、数据、代码仓库的 MCP 插件",
        status: "active",
        pluginCount: scopedPlugins,
        updatedAt: stamp,
      },
      {
        id: "mkt_skills",
        name: "和信技能商城",
        description: "可装配给专家的技能包（SKILL.md）",
        status: "active",
        pluginCount: scopedSkills,
        updatedAt: stamp,
      },
    ];
  };

  app.get("/v1/marketplaces", async (ctx) => {
    requireAuth(ctx);
    return { items: MARKETPLACES(expertScope(ctx.user)) };
  });

  /* 市场详情：客户端据此列出条目。插件与技能都按 DenOrgPlugin 的形态给，
     用 componentCounts 标明它是 mcp 还是 skill。 */
  app.get("/v1/marketplaces/:id/resolved", async (ctx) => {
    requireAuth(ctx);
    const scope = expertScope(ctx.user);
    const marketplace = MARKETPLACES(scope).find((m) => m.id === ctx.params.id);
    if (!marketplace) throw notFound("市场不存在");

    const isSkillMarket = marketplace.id === "mkt_skills";
    const rows = (
      isSkillMarket
        ? db.prepare("SELECT * FROM skills WHERE status = 'published' ORDER BY category, name").all()
        : db
            .prepare(`SELECT * FROM plugins WHERE status = 'enabled' AND ${CONNECTOR_PLUGIN_WHERE} ORDER BY category, name`)
            .all()
    ).filter((r) =>
      isSkillMarket ? !scope.skillIds || scope.skillIds.includes(r.id) : !scope.pluginIds || scope.pluginIds.includes(r.id)
    );

    const plugins = rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.summary || null,
      status: "active",
      memberCount: 0,
      updatedAt: r.updated_at,
      componentCounts: isSkillMarket ? { skill: 1 } : { mcp: 1 },
    }));

    return { item: { marketplace, plugins } };
  });

  /* ---------- 客户端：插件内容解析（市场条目点开后拉这个） ---------- */
  const CONFIG_OBJECT_AUTH = { oauth: "oauth", bearer: "bearer", none: "none" };

  function skillConfigObject(r) {
    return {
      id: r.id,
      objectType: "skill",
      title: r.name,
      description: r.summary || null,
      currentFileName: "SKILL.md",
      currentFileExtension: "md",
      // 客户端用 /skills/<name>/SKILL.md 的正则识别技能，路径写错就不会归到 Skills
      currentRelativePath: `skills/${r.key}/SKILL.md`,
      status: r.status === "published" ? "active" : "draft",
      updatedAt: r.updated_at,
      latestVersion: {
        id: `${r.id}_v${String(r.version || "1.0.0").replace(/\./g, "_")}`,
        rawSourceText: r.content || "",
        normalizedPayloadJson: {
          name: r.name,
          key: r.key,
          description: r.summary || "",
          version: r.version || "1.0.0",
          trigger: r.trigger_desc || "",
          category: r.category || "",
        },
        sourceRevisionRef: null,
        createdAt: r.created_at,
      },
    };
  }

  function pluginConfigObject(r) {
    const auth = obj(r.auth_config_json);
    return {
      id: r.id,
      objectType: "mcp",
      title: r.name,
      description: r.summary || null,
      currentFileName: "mcp.json",
      currentFileExtension: "json",
      currentRelativePath: `${r.key}/mcp.json`,
      status: r.status === "enabled" ? "active" : "draft",
      updatedAt: r.updated_at,
      latestVersion: {
        id: `${r.id}_v${String(r.version || "1.0.0").replace(/\./g, "_")}`,
        rawSourceText: JSON.stringify(
          {
            name: r.key,
            transport: r.transport,
            ...(r.endpoint ? { url: r.endpoint } : {}),
            ...(r.command ? { command: [r.command, ...arr(r.args_json)].filter(Boolean).join(" ") } : {}),
            auth: CONFIG_OBJECT_AUTH[r.auth_type] || "oauth",
          },
          null,
          2
        ),
        normalizedPayloadJson: {
          name: r.name,
          key: r.key,
          summary: r.summary || "",
          category: r.category || "",
          transport: r.transport,
          endpoint: r.endpoint || null,
          // 客户端优先读 mcpServers，其次读平铺的 url
          url: r.endpoint || null,
          ...(r.endpoint
            ? { mcpServers: { [r.key]: { type: "remote", url: r.endpoint } } }
            : {}),
          authType: r.auth_type,
          // 只带授权服务器与 scope，绝不带任何密钥
          authorizationServer: auth.authorizationServer || null,
          scopes: Array.isArray(auth.scopes) ? auth.scopes : [],
          version: r.version || "1.0.0",
        },
        sourceRevisionRef: null,
        createdAt: r.created_at,
      },
    };
  }

  /** 按 id 找条目：插件表或技能表都可能命中 */
  function findConfigObject(id) {
    const plugin = db.prepare("SELECT * FROM plugins WHERE id = ?").get(id);
    if (plugin) return { kind: "plugin", row: plugin, configObject: pluginConfigObject(plugin) };
    const skill = db.prepare("SELECT * FROM skills WHERE id = ?").get(id);
    if (skill) return { kind: "skill", row: skill, configObject: skillConfigObject(skill) };
    return null;
  }

  app.get("/v1/plugins/:id/resolved", async (ctx) => {
    requireAuth(ctx);
    const found = findConfigObject(ctx.params.id);
    if (!found) throw notFound("插件或技能不存在");
    const scope = expertScope(ctx.user);
    const assigned =
      found.kind === "skill"
        ? !scope.skillIds || scope.skillIds.includes(found.row.id)
        : !scope.pluginIds || scope.pluginIds.includes(found.row.id);
    if (!assigned) throw notFound("插件或技能不存在");
    const row = found.row;
    return {
      items: [
        {
          id: `mem_${row.id}`,
          pluginId: row.id,
          configObjectId: row.id,
          configObject: found.configObject,
        },
      ],
    };
  });

  /* 批量解析：客户端一次拉多个插件时用，失败项放 failures 而不是整体报错 */
  app.get("/v1/resolved-plugins", async (ctx) => {
    requireAuth(ctx);
    const scope = expertScope(ctx.user);
    // 客户端用 ?pluginIds=a,b,c（早期版本叫 ids），无参数时返回全部
    const rawIds = String(ctx.query.pluginIds || ctx.query.ids || "");
    const ids = rawIds
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
    let wanted = ids;
    if (!wanted.length) {
      wanted = [
        ...db
          .prepare("SELECT id FROM plugins ORDER BY name")
          .all()
          .map((r) => r.id)
          .filter((id) => !scope.pluginIds || scope.pluginIds.includes(id)),
        ...db
          .prepare("SELECT id FROM skills ORDER BY name")
          .all()
          .map((r) => r.id)
          .filter((id) => !scope.skillIds || scope.skillIds.includes(id)),
      ];
    }
    const items = [];
    const failures = {};
    for (const id of wanted) {
      const found = findConfigObject(id);
      if (!found) {
        failures[id] = "not_found";
        continue;
      }
      // 范围外的能力当作不存在：专家没装配，就不该能被解析出来
      const assigned =
        found.kind === "skill"
          ? !scope.skillIds || scope.skillIds.includes(found.row.id)
          : !scope.pluginIds || scope.pluginIds.includes(found.row.id);
      if (!assigned) {
        failures[id] = "not_in_expert_scope";
        continue;
      }
      items.push({
        id: `mem_${found.row.id}`,
        pluginId: found.row.id,
        configObjectId: found.row.id,
        configObject: found.configObject,
      });
    }
    return { items, failures };
  });

  /* 应用版本：桌面端据此判断是否需要升级 */
  app.get("/v1/app-version", async (ctx) => {
    return {
      minAppVersion: "0.1.0",
      latestAppVersion: CONFIG.version || "0.1.0",
      publishedDesktopVersions: [],
      webUrl: null,
    };
  });

  /* 特性开关：不在自建控制面范围内的能力一律关闭，让客户端走本地模式 */
  app.get("/v1/features", async (ctx) => {
    requireAuth(ctx);
    return {
      openworkWeb: false,
      gateway: false,
      automations: false,
      cloudRuntime: false,
      billing: false,
      scim: false,
      sso: false,
    };
  });

  /* ---------- 客户端：模型供应商（只暴露别名） ---------- */
  const enabledAliases = () =>
    db.prepare(
      `SELECT a.*, p.name AS provider_name, p.key AS provider_key, p.provider_id, p.base_url
       FROM model_aliases a JOIN llm_providers p ON p.id = a.provider_ref
       WHERE a.status = 'enabled' AND p.status = 'enabled'
       ORDER BY a.sort_order, a.created_at`
    ).all();

  /* 客户端看到的供应商条目：id 用 lpr_ 前缀，模型只暴露别名 */
  function groupClientProviders(rows) {
    const byProvider = new Map();
    for (const a of rows) {
      if (!byProvider.has(a.provider_ref)) {
        byProvider.set(a.provider_ref, {
          id: a.provider_ref,
          source: "custom",
          providerId: a.provider_id,
          name: a.provider_name,
          providerConfig: {
            npm: "@ai-sdk/openai-compatible",
            api: `${CONFIG.publicBaseUrl}/v1/llm/${a.provider_key}`,
            options: {
              baseURL: `${CONFIG.publicBaseUrl}/v1/llm/${a.provider_key}`,
              apiKey: gatewayToken(),
            },
            env: [],
            vendor: "openai-compatible",
          },
          hasApiKey: true,
          hasMyCredential: true,
          runtimeEnvKeys: [],
          pinnedModelIds: [],
          models: [],
          createdAt: null,
          updatedAt: null,
        });
      }
      const entry = byProvider.get(a.provider_ref);
      entry.pinnedModelIds.push(a.key);
      entry.models.push({
        id: a.key,
        name: a.name,
        config: {
          description: a.description,
          badge: a.badge,
          icon: a.icon,
          capabilities: arr(a.capabilities_json),
          contextTokens: a.context_tokens,
        },
        createdAt: a.created_at,
      });
    }
    return [...byProvider.values()];
  }

  app.get("/v1/llm-providers", async (ctx) => {
    requireAuth(ctx);
    return { llmProviders: groupClientProviders(enabledAliases()) };
  });

  /* 客户端「连接组织供应商」时拉取连接详情：这里下发的是网关令牌，不是上游密钥 */
  app.get("/v1/llm-providers/:id/connect", async (ctx) => {
    requireAuth(ctx);
    const provider = db.prepare("SELECT * FROM llm_providers WHERE id = ?").get(ctx.params.id);
    if (!provider) throw notFound("供应商不存在");
    if (provider.status !== "enabled") throw bad("该供应商已停用");
    const rows = db
      .prepare(
        `SELECT a.*, p.name AS provider_name, p.key AS provider_key, p.provider_id, p.base_url
         FROM model_aliases a JOIN llm_providers p ON p.id = a.provider_ref
         WHERE a.provider_ref = ? AND a.status = 'enabled' AND p.status = 'enabled'
         ORDER BY a.sort_order, a.created_at`
      )
      .all(provider.id);
    if (rows.length === 0) throw bad("该供应商下没有启用的模型别名");
    const [entry] = groupClientProviders(rows);
    return {
      llmProvider: {
        ...entry,
        hasApiKey: true,
        hasMyCredential: true,
        apiKey: gatewayToken(),
        apiKeys: null,
        credentialMode: "shared",
        createdAt: provider.created_at,
        updatedAt: provider.updated_at,
      },
    };
  });

  app.get("/v1/inference-providers", async (ctx) => {
    requireAuth(ctx);
    // 未接 AI Gateway：返回合法空集（不是 404，否则客户端会当成接口不支持）
    return { inferenceProviders: [] };
  });

  app.get("/v1/org", async (ctx) => {
    requireAuth(ctx);
    return {
      id: "hx",
      name: getSetting("org_name", CONFIG.orgName),
      slug: "hx",
      role: ctx.user.role,
      features: {
        skills: true,
        plugins: true,
        mcp: true,
        automations: false,
        billing: false,
        cloudRuntime: false,
      },
      capabilities: { openworkWeb: false, gateway: false },
    };
  });

  app.get("/v1/org/inventory-revision", async (ctx) => {
    requireAuth(ctx);
    const m = buildManifest({ userId: ctx.user.id, isAdmin: ctx.user.role === "admin" });
    const aliasCount = enabledAliases().length;
    return { revision: `${m.version}-${aliasCount}` };
  });

  /* ---------- 别名解析网关：客户端只认别名，真实模型与密钥不出服务端 ---------- */
  function resolveProvider(keyOrId) {
    return db
      .prepare("SELECT * FROM llm_providers WHERE (key = ? OR provider_id = ?) AND status = 'enabled'")
      .get(keyOrId, keyOrId);
  }

  function resolveAlias(providerId, modelKey) {
    if (!modelKey) return null;
    const scoped = db.prepare("SELECT * FROM model_aliases WHERE key = ? AND provider_ref = ? AND status = 'enabled'").get(modelKey, providerId);
    if (scoped) return scoped;
    return db.prepare("SELECT * FROM model_aliases WHERE key = ? AND status = 'enabled'").get(modelKey) || null;
  }

  function requireGatewayOrSession(ctx) {
    if (ctx.user) return;
    const header = String(ctx.headers.authorization || "");
    const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
    const gatewayHeader = String(ctx.headers["x-ow-gateway-key"] || "").trim();
    if ((bearer && bearer === gatewayToken()) || (gatewayHeader && gatewayHeader === gatewayToken())) return;
    // 桌面端下发的是网关模式配置：客户端把「客户端令牌」作为 apiKey 发上来，
    // 所以这里也要认客户端令牌，否则下发的配置在客户端侧根本用不了。
    if (bearer && tokenIsValid(bearer)) return;
    if (gatewayHeader && tokenIsValid(gatewayHeader)) return;
    throw unauthorized("需要登录令牌、客户端令牌或网关令牌");
  }

  app.get("/v1/llm/:providerKey/models", async (ctx) => {
    requireGatewayOrSession(ctx);
    const provider = resolveProvider(ctx.params.providerKey);
    if (!provider) throw notFound("供应商不可用");
    const rows = db.prepare("SELECT * FROM model_aliases WHERE provider_ref = ? AND status = 'enabled' ORDER BY sort_order").all(provider.id);
    return {
      object: "list",
      data: rows.map((a) => ({ id: a.key, object: "model", owned_by: provider.name, description: a.description })),
    };
  });

  app.post("/v1/llm/:providerKey/chat/completions", async (ctx) => {
    requireGatewayOrSession(ctx);
    const provider = resolveProvider(ctx.params.providerKey);
    if (!provider) throw notFound("供应商不可用");
    const body = { ...(ctx.body || {}) };
    const alias = resolveAlias(provider.id, String(body.model || ""));
    if (alias) body.model = alias.target_model;

    // 记一行「这一轮带了什么工作模式」：出问题时能一眼看出
    // 是专家提示词没进 system，还是进了但模型没遵守。
    // 只记长度与标记，不记正文。
    const systemText = Array.isArray(body.messages)
      ? body.messages.find((m) => m && m.role === "system")?.content
      : null;
    if (typeof systemText === "string" && systemText) {
      const hasWorkMode = systemText.includes("# 当前工作模式");
      console.log(
        `          ↳ system ${systemText.length} 字符 · 工作模式${hasWorkMode ? "已注入" : "未注入"} · alias=${alias?.key || body.model}`
      );
    }

    const upstream = `${provider.base_url.replace(/\/$/, "")}/chat/completions`;
    let upstreamRes;
    try {
      upstreamRes = await fetch(upstream, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(provider.api_key ? { authorization: `Bearer ${provider.api_key}` } : {}),
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw new HttpError(502, `上游模型服务不可达：${e.message}`, "upstream_unreachable");
    }
    ctx.res.writeHead(upstreamRes.status, {
      "content-type": upstreamRes.headers.get("content-type") || "application/json",
      "cache-control": "no-cache",
      "x-model-alias": alias?.key || "",
      "x-model-upstream": alias?.target_model || "",
    });
    if (upstreamRes.body) {
      for await (const chunk of upstreamRes.body) ctx.res.write(Buffer.from(chunk));
    }
    ctx.res.end();
  });

  // MCP 授权链所需的最小元数据（客户端据此发起 OAuth）
  app.get("/.well-known/oauth-authorization-server", async () => ({
    issuer: CONFIG.publicBaseUrl,
    authorization_endpoint: `${CONFIG.publicBaseUrl}/oauth/authorize`,
    token_endpoint: `${CONFIG.publicBaseUrl}/oauth/token`,
    registration_endpoint: `${CONFIG.publicBaseUrl}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: ["openid", "profile", "mcp.read", "mcp.write"],
  }));

  app.get("/.well-known/oauth-protected-resource", async () => ({
    resource: CONFIG.publicBaseUrl,
    authorization_servers: [CONFIG.publicBaseUrl],
    bearer_methods_supported: ["header"],
  }));

  /* ==========================================================================
   * ZCode 客户端配置下发
   *
   * ZCode 桌面端启动时拉取 GET /v1/client-config（见 zcode 侧
   * packages/desktop/src/main/hxRemoteConfig.ts）。改动后客户端重启即生效，
   * 不需要重新打包。
   * ========================================================================== */

  /**
   * 客户端拉取配置。需要 Bearer 令牌（由 /v1/client-config/token 签发），
   * 也可用 OWCP_ANON_CONFIG=1 放开匿名（仅调试）。
   */
  app.get("/v1/client-config", async (ctx) => {
    const token = ctx.req.headers.authorization || "";
    if (!CONFIG.allowAnonymousManifest && !token.toLowerCase().startsWith("bearer ")) {
      throw unauthorized("拉取客户端配置需要令牌");
    }
    return buildClientConfig();
  });

  /** 生成客户端接入令牌（管理员在后台生成，配置到客户端环境变量）。 */
  app.post("/api/client-config/token", async (ctx) => {
    const user = requireRole(ctx, "admin");
    const id = newId("cfg");
    const token = randomToken(24);
    db.prepare(
      "INSERT INTO client_tokens(id, label, token_hash, created_at, created_by, revoked) VALUES(?,?,?,?,?,0)"
    ).run(id, String(ctx.body?.label || "客户端令牌").slice(0, 80), hashToken(token), nowIso(), user.id);
    audit(ctx, "client_config.token.create", { type: "client_token", id }, { label: ctx.body?.label });
    // 明文只返回一次。
    return created({ id, token });
  });

  /* ==========================================================================
   * 模型下发
   *
   * 后台维护 llm_providers（真实后端 + 密钥）和 model_aliases（员工看到的名字）。
   * 客户端实际用 ZCode 的 personal provider 配置（provider_config.json）驱动，
   * 所以这里生成同构 JSON，由客户端拉到本地文件后重启生效。
   *
   * 安全边界：
   *   - apiKey 只在下发时按需注入，接口默认回显掩码。
   *   - 若要「密钥不出服务端」，应改成客户端带令牌访问网关（baseUrl 指向后台反代），
   *     而不是把上游密钥发到每台终端。当前实现支持两种：直连（下发密钥）或网关模式（不发密钥）。
   * ========================================================================== */

  /** 下发 provider_config.json。默认网关模式，不含任何上游密钥。 */
  app.get("/v1/provider-config.json", async (ctx) => {
    // 网关模式下发的是网关令牌（能烧上游额度），所以不能匿名；
    // 客户端的 ZCODE_REMOTE_CONFIG_TOKEN 里放网关令牌或客户端令牌都行。
    requireGatewayOrSession(ctx);
    // direct=1 才下发真实上游密钥，且必须用「客户端令牌」——
    // 网关令牌持有者不应能通过这个?参数换到上游密钥。
    const direct = ctx.query.direct === "1";
    if (direct) {
      const auth = String(ctx.req.headers.authorization || "");
      if (!auth.toLowerCase().startsWith("bearer ") || !tokenIsValid(auth.slice(7).trim())) {
        throw unauthorized("直连模式下发上游密钥需要有效的客户端令牌");
      }
    }
    return ok(buildProviderConfig({ revealKey: true, direct }));
  });

  /** 后台预览（掩码，用于页面展示）。 */
  app.get("/api/provider-config/preview", async (ctx) => {
    requireAuth(ctx);
    return ok({
      // 页面展示用：密钥打码
      config: buildProviderConfig({ revealKey: false, direct: false }),
      directConfig: buildProviderConfig({ revealKey: false, direct: true }),
      // 真正下发的内容（含网关令牌）。网关令牌只换得到模型调用，换不到上游密钥。
      distribution: buildProviderConfig({ revealKey: true, direct: false }),
      aliases: buildProviderAliasView(),
      // 下发的 baseUrl 直接写死成 publicBaseUrl。若它还是默认的 127.0.0.1，
      // 装在其他机器上的客户端必然连不上，而且报错是「连接被拒绝」——
      // 用户很难联想到是后台配错了。这里显式提示。
      warnings: publicBaseUrlWarnings(),
    });
  });

  /** 轮换网关令牌：旧令牌立即失效，已下发的客户端需要重新同步配置。 */
  app.post("/api/provider-config/rotate-token", async (ctx) => {
    const user = requireRole(ctx, "admin");
    const next = `owg_${randomToken(18)}`;
    setSetting("gateway_token", next);
    audit(ctx, "gateway_token.rotate", { type: "gateway_token", id: "gateway_token" }, {});
    // 明文只在这里返回一次；之后要从 provider-config 预览里看。
    return ok({ token: next });
  });

  app.get("/api/client-config/tokens", async (ctx) => {
    requireAuth(ctx);
    const rows = db
      .prepare(
        "SELECT t.id, t.label, t.created_at, t.revoked, u.username AS created_by FROM client_tokens t LEFT JOIN users u ON u.id = t.created_by ORDER BY t.created_at DESC"
      )
      .all();
    return ok({ items: rows });
  });

  app.delete("/api/client-config/tokens/:id", async (ctx) => {
    const user = requireRole(ctx, "admin");
    db.prepare("UPDATE client_tokens SET revoked = 1 WHERE id = ?").run(ctx.params.id);
    audit(ctx, "client_config.token.revoke", { type: "client_token", id: ctx.params.id });
    return ok({ ok: true });
  });

  /** 后台读取当前配置（含未保存草稿）。 */
  app.get("/api/client-config", async (ctx) => {
    requireAuth(ctx);
    return ok(loadClientConfigDraft());
  });

  /** 后台保存配置。 */
  app.patch("/api/client-config", async (ctx) => {
    const user = requireRole(ctx, "admin", "publisher");
    const current = loadClientConfigDraft();
    const patch = ctx.body && typeof ctx.body === "object" ? ctx.body : {};
    const next = {
      ...current,
      ...patch,
      updatedAt: nowIso(),
      updatedBy: user.username,
    };
    // 结构校验：非法条目丢弃而非整份拒绝，与客户端侧宽松策略保持一致。
    const normalized = normalizeClientConfig(next);
    setSetting("zcode.clientConfig", JSON.stringify(normalized));
    audit(ctx, "client_config.update", { type: "settings", id: "zcode.clientConfig" }, {
      version: normalized.version,
      marketplaces: normalized.pluginMarketplaces?.length ?? 0,
      hidden: normalized.hiddenPluginCategories?.length ?? 0,
      agentLinks: normalized.agentLinks?.length ?? 0,
    });
    return ok(normalized);
  });

  /**
   * 插件市场清单发布接口。
   *
   * 后台维护的插件/技能表 → 生成 ZCode 可消费的 marketplace.json。
   * 客户端把 market.source 指到这里即可（`${publicBaseUrl}/v1/marketplace.json`）。
   */
  app.get("/v1/marketplace.json", async () => {
    const rows = db
      .prepare(
        "SELECT key, name, summary, category, version, status, visibility, id, package_file, package_sha256, package_size, dependencies_json FROM plugins WHERE status = 'enabled' AND visibility != 'admin' ORDER BY name"
      )
      .all();
    const plugins = rows.map((row) => {
      // 已上传插件包 → 用 zip 源，客户端可直接下载安装；
      // 未上传 → 退回相对路径（仅在客户端本地已存在该目录时可用）。
      const deps = arr(row.dependencies_json).filter((d) => typeof d === "string" && d.trim());
      const base = {
        name: row.key,
        ...(row.summary ? { description: row.summary } : {}),
        ...(row.version ? { version: row.version } : {}),
        ...(row.category ? { category: row.category } : {}),
        ...(deps.length ? { dependencies: deps } : {}),
      };
      if (row.package_file && row.package_sha256) {
        return {
          ...base,
          source: {
            source: "url",
            type: "zip",
            url: `${CONFIG.publicBaseUrl}/v1/packages/${row.id}/${encodeURIComponent(row.package_file)}`,
            sha256: row.package_sha256,
            ...(row.package_size ? { size: row.package_size } : {}),
          },
        };
      }
      return { ...base, source: `./plugins/${row.key}` };
    });
    return ok({
      name: getSetting("zcode.marketplace.name", "hx-plugins"),
      description: getSetting("zcode.marketplace.description", "和信内部业务插件市场"),
      owner: { name: CONFIG.orgName, url: CONFIG.publicBaseUrl },
      plugins,
    });
  });

  /* ==========================================================================
   * 插件包托管
   *
   * ZCode 支持 `{ source: "url", type: "zip", url, sha256 }` 形式的插件源。
   * 后台负责存 zip、算 sha256、在市场清单里写出可下载地址，客户端安装时直连下载。
   * ========================================================================== */

  /** 上传插件包（原始 zip 字节，Content-Type: application/zip）。 */
  app.post("/api/plugins/:id/package", async (ctx) => {
    const user = requireRole(ctx, "admin", "publisher");
    const buffer = ctx.body?.__binary;
    if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw bad("请求体必须是插件 zip 二进制（Content-Type: application/zip）");
    }
    if (buffer.length > 50 * 1024 * 1024) throw bad("插件包不能超过 50MB");

    const row = db.prepare("SELECT id, key, version FROM plugins WHERE id = ?").get(ctx.params.id);
    if (!row) throw notFound("插件不存在");

    // ZCode 客户端安装时强依赖包内 manifest，缺失会在用户侧报 plugin_manifest_not_found。
    // 上传期就拦下，避免坏包进入市场。
    let manifest;
    let manifestPath;
    try {
      const found = findPluginManifest(buffer);
      manifestPath = found.manifestPath;
      manifest = JSON.parse(found.bytes.toString("utf8"));
    } catch (error) {
      if (error instanceof ZipError) throw bad(error.message);
      throw bad(`插件清单不是合法 JSON：${error instanceof Error ? error.message : String(error)}`);
    }
    const manifestName = typeof manifest?.name === "string" ? manifest.name.trim() : "";
    if (!PLUGIN_NAME_PATTERN.test(manifestName)) {
      throw bad(`插件清单 name 不合法（需匹配 ${PLUGIN_NAME_PATTERN}）：${manifestName || "缺失"}`);
    }
    if (manifestName !== row.key) {
      throw bad(`插件清单 name（${manifestName}）与后台插件标识（${row.key}）不一致`);
    }

    const dir = join(CONFIG.dataDir, "packages", row.id);
    mkdirSync(dir, { recursive: true });
    // 包版本以清单为准：客户端读取的 version 就来自 plugin.json。
    const version = String(manifest.version || ctx.query?.version || row.version || "1.0.0");
    // 文件名只允许安全字符，避免路径穿越。
    const safeVersion = version.replace(/[^0-9A-Za-z._-]/g, "_").slice(0, 40);
    const fileName = `${row.key}-${safeVersion}.zip`;
    const filePath = join(dir, fileName);
    writeFileSync(filePath, buffer);
    const sha256 = createHash("sha256").update(buffer).digest("hex");

    db.prepare(
      "UPDATE plugins SET package_file = ?, package_sha256 = ?, package_size = ?, updated_at = ? WHERE id = ?"
    ).run(fileName, sha256, buffer.length, nowIso(), row.id);
    audit(ctx, "plugin.package.upload", { type: "plugin", id: row.id, name: row.key }, {
      fileName,
      size: buffer.length,
      sha256,
      manifestPath,
      manifestVersion: manifest.version ?? null,
    });

    return ok({
      fileName,
      sha256,
      size: buffer.length,
      manifestPath,
      manifestName,
      manifestVersion: manifest.version ?? null,
      hasMcpServers: Boolean(manifest.mcpServers),
      skillCount: countSkillEntries(buffer),
      url: `${CONFIG.publicBaseUrl}/v1/packages/${row.id}/${encodeURIComponent(fileName)}`,
    });
  });

  /** 客户端下载插件包（匿名可读：清单本身已是公开信息，包内容不含密钥）。 */
  app.get("/v1/packages/:id/:file", async (ctx) => {
    const id = ctx.params.id;
    const file = ctx.params.file;
    const row = db.prepare("SELECT key, package_file FROM plugins WHERE id = ?").get(id);
    if (!row || !row.package_file || row.package_file !== file) throw notFound("插件包不存在");
    // 防路径穿越：只允许包目录下的同名文件。
    const filePath = join(CONFIG.dataDir, "packages", id, row.package_file);
    if (!existsSync(filePath)) throw notFound("插件包文件缺失");
    return {
      __file: true,
      type: "application/zip",
      name: row.package_file,
      body: readFileSync(filePath),
    };
  });
}

/* ----------------------------- ZCode 客户端配置 ----------------------------- */

/**
 * 生成 ZCode 的 provider_config.json 结构。
 *
 * ZCode 端格式（packages/provider-node/src/personal-provider-config-repository.ts）：
 *   { schemaVersion: 1, config: {
 *       providerOrder: [...],
 *       providerConfigRules: { providerRules: [
 *         { providerId, providerName, enabled, config: {
 *             group: "standard-personal",
 *             access: { type: "api-key", apiKey },
 *             api: { type, baseUrl },
 *             personalModelIds: [...], modelOrder: [...],
 *         } }
 *       ] },
 *       modelConfigRules: { providerModelRules: [], manualProviderModelRules: [] },
 *       defaultModelSelection?: { providerId, modelId },
 *   } }
 *
 * ★ 关键安全决策：默认走「网关模式」——baseUrl 指向后台的 /v1/llm/<providerKey>，
 *   客户端拿到的 apiKey 是**后台签发的客户端令牌**，不是上游真实密钥。
 *   上游密钥永远留在服务端，换模型、轮换密钥客户端都不用动。
 *
 *   需要直连上游时可传 direct:true，但那会把真实密钥发到每台终端，
 *   只在「终端与上游在同一可信内网」时才该用。
 */
function buildProviderConfig({ revealKey = false, direct = false } = {}) {
  const providers = db
    .prepare("SELECT * FROM llm_providers WHERE status = 'enabled' ORDER BY created_at")
    .all();
  const aliases = db
    .prepare("SELECT * FROM model_aliases WHERE status = 'enabled' ORDER BY sort_order, created_at")
    .all();

  const byProvider = new Map();
  for (const a of aliases) {
    if (!byProvider.has(a.provider_ref)) byProvider.set(a.provider_ref, []);
    byProvider.get(a.provider_ref).push(a);
  }

  const providerRules = [];
  const providerOrder = [];

  for (const p of providers) {
    const list = byProvider.get(p.id) || [];
    // 没有可用别名的供应商不下发：客户端里会变成空供应商，反而干扰选择。
    if (list.length === 0) continue;

    // 网关模式下客户端只该看到别名（std/pro），由网关解析成真实模型；
    // 直连模式才需要真实模型名。
    const modelIds = [
      ...new Set(list.map((a) => (direct ? a.target_model : a.key)).filter(Boolean)),
    ];
    if (modelIds.length === 0) continue;

    providerOrder.push(p.provider_id);
    providerRules.push({
      providerId: p.provider_id,
      providerName: p.name,
      enabled: true,
      config: {
        group: "standard-personal",
        access: {
          type: "api-key",
          apiKey: direct
            ? revealKey
              ? p.api_key || ""
              : "••••••••"
            : // 网关模式：客户端拿网关令牌，不是上游密钥。
              // 这个令牌能访问 /v1/llm/*，但换不到任何上游凭据，可随时轮换
              // （轮换后重新下发配置即可，客户端不需要重新打包）。
              revealKey
              ? gatewayToken()
              : "••••••••",
        },
        api: {
          // 网关模式统一 OpenAI 兼容（后台网关只实现了 chat/completions）；
          // 直连模式按 vendor 决定协议。
          type: direct && p.vendor === "deepseek" ? "anthropic-messages" : "openai-chat-completions",
          baseUrl: direct ? p.base_url : `${CONFIG.publicBaseUrl}/v1/llm/${p.key}`,
        },
        personalModelIds: modelIds,
        modelOrder: modelIds,
      },
    });
  }

  // 默认模型：没有它客户端会提示「Select a model before sending a message」。
  // 后台没有「设为默认」字段，约定取排序最前（sort_order 最小）的启用别名。
  const defaultAlias = aliases[0];
  let defaultModelSelection;
  if (defaultAlias?.target_model) {
    const p = db.prepare("SELECT provider_id FROM llm_providers WHERE id = ?").get(defaultAlias.provider_ref);
    if (p?.provider_id) {
      defaultModelSelection = {
        providerId: p.provider_id,
        // 与 providerRule 的模型列表保持同一命名空间，否则客户端选中项匹配不到模型。
        modelId: direct ? defaultAlias.target_model : defaultAlias.key,
      };
    }
  }

  return {
    schemaVersion: 1,
    config: {
      providerOrder,
      providerConfigRules: { providerRules },
      // ZCode 的 provider_config.json 是 strict schema：两个数组都必须存在（可为空），
      // 多写一个顶层键就会整份被拒。别往这里加自定义字段。
      modelConfigRules: { providerModelRules: [], manualProviderModelRules: [] },
      ...(defaultModelSelection ? { defaultModelSelection } : {}),
    },
  };
}

/**
 * 供后台页面展示的别名映射（不写进 provider_config.json，因为那边是 strict schema）。
 * 客户端拿到的「标准 / 高级」展示需要另外的通道。
 */
function buildProviderAliasView() {
  const aliases = db
    .prepare("SELECT * FROM model_aliases WHERE status = 'enabled' ORDER BY sort_order, created_at")
    .all();
  return aliases.map((a) => ({
    key: a.key,
    name: a.name,
    badge: a.badge,
    description: a.description,
    providerId: db.prepare("SELECT provider_id FROM llm_providers WHERE id = ?").get(a.provider_ref)?.provider_id,
    modelId: a.target_model,
    capabilities: arr(a.capabilities_json),
    contextTokens: a.context_tokens,
  }));
}

/**
 * 下发地址的可疑信号。
 *
 * 客户端拿到的 baseUrl 由 OWCP_PUBLIC_BASE_URL 生成，默认值是 127.0.0.1。
 * 后台跑在自己机器上时这是对的，但客户端装到同事电脑上就必然连不上，
 * 而且客户端只会报「连接被拒绝」——很难反推到是后台环境变量没配。
 * 所以在这里把风险显式说出来，别让人靠猜。
 */
function publicBaseUrlWarnings() {
  const url = CONFIG.publicBaseUrl;
  const warnings = [];
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return [{ level: "error", message: `OWCP_PUBLIC_BASE_URL 不是合法地址：${url}` }];
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    warnings.push({ level: "error", message: `下发地址协议必须是 http/https：${url}` });
  }
  if (["127.0.0.1", "localhost", "::1", "0.0.0.0"].includes(parsed.hostname)) {
    warnings.push({
      level: "warn",
      message: `下发地址是 ${parsed.hostname}：只有本机能用。客户端装在其他机器上会连不上，请设置 OWCP_PUBLIC_BASE_URL 为客户端可达的地址（如 https://ai.hx.local）。`,
    });
  }
  if (parsed.protocol === "http:" && !["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)) {
    warnings.push({
      level: "warn",
      message: "下发地址是明文 http：网关令牌会在网络上裸奔，对外部署应挂 HTTPS 反代。",
    });
  }
  return warnings;
}

/** 令牌只存散列，明文仅在创建时返回一次。 */
function hashToken(token) {
  return createHash("sha256").update(String(token)).digest("hex");
}

/** 客户端令牌校验：查散列、未撤销。任何异常都按无效处理。 */
function tokenIsValid(token) {
  if (!token) return false;
  try {
    const row = db.prepare("SELECT id FROM client_tokens WHERE token_hash = ? AND revoked = 0").get(hashToken(token));
    return Boolean(row);
  } catch {
    return false;
  }
}

/** 读取配置草稿；无记录时返回一份可用的默认值。 */
function loadClientConfigDraft() {
  const raw = getSetting("zcode.clientConfig", null);
  if (!raw) {
    return normalizeClientConfig({
      version: "1.0.0",
      organization: { id: getSetting("zcode.orgId", "hx"), name: CONFIG.orgName },
      pluginMarketplaces: [],
      hiddenPluginCategories: [],
      agentLinks: [],
    });
  }
  try {
    return normalizeClientConfig(JSON.parse(raw));
  } catch {
    return normalizeClientConfig({});
  }
}

/**
 * 归一化客户端配置。
 *
 * 与客户端侧 hxRemoteConfig.ts 的 normalizeRemoteConfig 保持同一套宽松策略：
 * 非法条目丢弃，保留可用部分 —— 运营配置写错一个字段，不应让整份配置失效。
 */
function normalizeClientConfig(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;

  if (typeof raw.version === "string" && raw.version.trim()) out.version = raw.version.trim();
  if (typeof raw.brandProductName === "string" && raw.brandProductName.trim()) {
    out.brandProductName = raw.brandProductName.trim();
  }
  if (raw.organization && typeof raw.organization === "object" && raw.organization.id) {
    out.organization = {
      id: String(raw.organization.id),
      ...(raw.organization.name ? { name: String(raw.organization.name) } : {}),
    };
  }

  if (Array.isArray(raw.pluginMarketplaces)) {
    const reserved = new Set(["zcode-plugins-official", "claude-plugins-official"]);
    const seen = new Set();
    const list = [];
    for (const item of raw.pluginMarketplaces) {
      if (!item || typeof item !== "object") continue;
      const id = typeof item.id === "string" ? item.id.trim() : "";
      const source = typeof item.source === "string" ? item.source.trim() : "";
      if (!id || !source || reserved.has(id) || seen.has(id)) continue;
      seen.add(id);
      list.push({
        id,
        source,
        ...(item.name ? { name: String(item.name) } : {}),
        ...(item.description ? { description: String(item.description) } : {}),
      });
    }
    out.pluginMarketplaces = list;
  }

  if (Array.isArray(raw.hiddenPluginCategories)) {
    const set = new Set(
      raw.hiddenPluginCategories
        .filter((x) => typeof x === "string")
        .map((x) => x.trim().toLowerCase())
        .filter(Boolean)
    );
    out.hiddenPluginCategories = [...set];
  }

  // 编排智能体外链：只需名称 + 地址 + 图标，客户端按顺序挂到侧栏。
  if (Array.isArray(raw.agentLinks)) {
    const seen = new Set();
    const list = [];
    for (const item of raw.agentLinks) {
      if (!item || typeof item !== "object") continue;
      const id = typeof item.id === "string" ? item.id.trim() : "";
      const name = typeof item.name === "string" ? item.name.trim() : "";
      const url = typeof item.url === "string" ? item.url.trim() : "";
      if (!id || !name || !url || seen.has(id)) continue;
      let parsed;
      try {
        parsed = new URL(url);
      } catch {
        continue;
      }
      if (!["http:", "https:"].includes(parsed.protocol)) continue;
      seen.add(id);
      const icon = typeof item.icon === "string" ? item.icon.trim() : "";
      list.push({ id, name, url, ...(icon ? { icon } : {}) });
      if (list.length >= 50) break;
    }
    out.agentLinks = list;
  }

  if (raw.extra && typeof raw.extra === "object") out.extra = raw.extra;
  if (raw.updatedAt) out.updatedAt = raw.updatedAt;
  if (raw.updatedBy) out.updatedBy = raw.updatedBy;
  return out;
}

/**
 * 从库里读专家 + 其授权的技能/插件，编译成插件包。
 * 白名单外的技能和插件不会进入包内——这是专家能力的硬边界。
 */
function compileExpertFromDb(expertId) {
  const expert = db.prepare("SELECT * FROM experts WHERE id = ?").get(expertId);
  if (!expert) throw notFound("专家不存在");

  const ids = (json) => {
    try {
      const v = JSON.parse(json || "[]");
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  };
  const inClause = (list) => (list.length ? list.map(() => "?").join(",") : null);

  const pluginIds = ids(expert.plugin_ids_json);
  const skillIds = ids(expert.skill_ids_json);
  const pluginRows = pluginIds.length
    ? db.prepare(`SELECT * FROM plugins WHERE id IN (${inClause(pluginIds)})`).all(...pluginIds)
    : [];
  const skillRows = skillIds.length
    ? db.prepare(`SELECT * FROM skills WHERE id IN (${inClause(skillIds)})`).all(...skillIds)
    : [];

  try {
    return compileExpertPackage({
      expert: {
        key: expert.key,
        name: expert.name,
        roleTitle: expert.role_title,
        summary: expert.summary,
        rolePrompt: expert.role_prompt,
        permissionMode: expert.permission_mode,
        modelProvider: expert.model_provider,
        modelName: expert.model_name,
        owner: expert.owner,
      },
      plugins: pluginRows.map((r) => ({ key: r.key, status: r.status })),
      skills: skillRows.map((r) => ({
        key: r.key,
        name: r.name,
        summary: r.summary,
        trigger: r.trigger_desc,
        content: r.content,
      })),
    });
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : String(error), "package_compile_failed");
  }
}

/** 组装客户端实际拿到的配置。 */
function buildClientConfig() {
  const config = loadClientConfigDraft();
  return {
    ...config,
    // 市场清单地址由后台自动追加，运营不用手填
    pluginMarketplaces: [
      ...(config.pluginMarketplaces || []),
      {
        id: "hx-official",
        source: `${CONFIG.publicBaseUrl}/v1/marketplace.json`,
        name: `${CONFIG.orgName}插件市场`,
        description: "由管理后台统一维护",
      },
    ],
    server: { baseUrl: CONFIG.publicBaseUrl, version: CONFIG.version },
  };
}

function saveGrants(expertId, grants) {
  db.prepare("DELETE FROM grants WHERE expert_id = ?").run(expertId);
  if (!Array.isArray(grants)) return;
  const stmt = db.prepare("INSERT INTO grants(id, expert_id, subject_type, subject_id, created_at) VALUES(?,?,?,?,?)");
  for (const g of grants) {
    if (!g?.subjectId) continue;
    stmt.run(newId("grt"), expertId, g.subjectType || "department", g.subjectId, nowIso());
  }
}

/* ------------------------- 专家 / 技能导入导出 ------------------------- */
// JSON 包的字段与 Go 版 service/expert_transfer.go、skill_transfer.go 一一对应，
// 两边共用同一份文件格式；插件和技能只用 key 引用，跨库导入时才不会错位。

function rawBody(ctx) {
  const body = ctx.body;
  if (!body) return Buffer.alloc(0);
  if (Buffer.isBuffer(body.__binary)) return body.__binary;
  if (typeof body.__raw === "string") return Buffer.from(body.__raw, "utf8");
  if (typeof body === "string") return Buffer.from(body, "utf8");
  if (typeof body === "object" && Object.keys(body).length === 0) return Buffer.alloc(0);
  return Buffer.from(JSON.stringify(body), "utf8");
}

function normalizeVersion(raw) {
  return String(raw || "").trim().slice(0, 40) || "1.0.0";
}

function valueOrDefault(value, fallback) {
  return value === "" || value === undefined || value === null ? fallback : value;
}

function collapseWhitespace(value) {
  return String(value || "")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

function yamlScalar(value) {
  return JSON.stringify(value);
}

function randomSuffix(n) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = randomBytes(n);
  let out = "";
  for (let i = 0; i < n; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

function keysInOrder(table, ids) {
  if (!ids.length) return [];
  const p = ids.map(() => "?").join(",");
  const rows = db.prepare(`SELECT id, key FROM ${table} WHERE id IN (${p})`).all(...ids);
  const byId = new Map(rows.map((r) => [r.id, r.key]));
  return [...new Set(ids.map((id) => byId.get(id)).filter(Boolean))];
}

function resolveKeys(table, keys) {
  const clean = [...new Set((Array.isArray(keys) ? keys : []).filter(Boolean))];
  if (!clean.length) return { found: [], missing: [] };
  const p = clean.map(() => "?").join(",");
  const rows = db.prepare(`SELECT id, key FROM ${table} WHERE key IN (${p})`).all(...clean);
  const byKey = new Map(rows.map((r) => [r.key, r.id]));
  const found = [];
  const missing = [];
  for (const key of clean) {
    if (byKey.has(key)) found.push(byKey.get(key));
    else missing.push(key);
  }
  return { found, missing };
}

function exportGrants(expertId) {
  return db
    .prepare("SELECT subject_type, subject_id FROM grants WHERE expert_id = ? ORDER BY created_at")
    .all(expertId)
    .map((g) => ({ subjectType: g.subject_type, subjectId: g.subject_id }));
}

function splitFrontmatter(text) {
  const normalized = String(text).replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) return { meta: {}, body: normalized };
  const rest = normalized.slice(4);
  const idx = rest.indexOf("\n---");
  if (idx < 0) return { meta: {}, body: normalized };
  const header = rest.slice(0, idx);
  const body = rest.slice(idx + 4).replace(/^\n/, "");
  const meta = {};
  for (const line of header.split("\n")) {
    const cut = line.indexOf(":");
    if (cut < 0) continue;
    const key = line.slice(0, cut).trim();
    let value = line.slice(cut + 1).trim();
    if (value.startsWith('"')) {
      try {
        value = JSON.parse(value);
      } catch {
        // 引号里不是合法 JSON 就按原样保留，和 Go 版一致
      }
    }
    if (key) meta[key] = value;
  }
  return { meta, body };
}

function firstHeading(markdown) {
  for (const raw of String(markdown).split("\n")) {
    const line = raw.trim();
    if (line.startsWith("# ")) return line.slice(2).trim();
  }
  return "";
}

function buildSkillMarkdown(payload) {
  const trigger = String(payload.trigger || "").trim();
  const description =
    trigger || String(payload.summary || "").trim() || String(payload.name || "");
  const lines = [
    "---",
    `name: ${payload.key}`,
    `description: ${yamlScalar(collapseWhitespace(description))}`,
    `version: ${yamlScalar(normalizeVersion(payload.version))}`,
    `category: ${yamlScalar(valueOrDefault(String(payload.category || "").trim(), "通用"))}`,
  ];
  if (trigger) lines.push(`trigger: ${yamlScalar(collapseWhitespace(trigger))}`);
  lines.push("---", "", String(payload.content || "").trim(), "");
  return lines.join("\n");
}

function parseExpertTransfer(raw) {
  let parsed;
  try {
    parsed = JSON.parse(String(raw));
  } catch {
    throw bad("导入文件不是合法 JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw bad("导入文件不是合法 JSON");
  if (parsed.kind && parsed.kind !== "hxai.expert") throw bad("导入文件不是专家包");
  if (typeof parsed.version === "number" && parsed.version > 1) {
    throw bad("专家包版本过新，请升级后台后再导入");
  }
  if (parsed.expert && typeof parsed.expert === "object" && !Array.isArray(parsed.expert)) return parsed.expert;
  // 兼容直接粘贴专家对象（没有 kind/expert 外壳）。
  return parsed;
}

function parseSkillTransfer(raw) {
  const text = String(raw).trim();
  if (text.startsWith("{")) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw bad("导入文件不是合法 JSON");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw bad("导入文件不是合法 JSON");
    if (parsed.kind && parsed.kind !== "hxai.skill") throw bad("导入文件不是技能包");
    if (typeof parsed.version === "number" && parsed.version > 1) {
      throw bad("技能包版本过新，请升级后台后再导入");
    }
    if (parsed.skill && typeof parsed.skill === "object" && !Array.isArray(parsed.skill)) return parsed.skill;
    return parsed;
  }
  const { meta, body } = splitFrontmatter(text);
  const payload = {
    key: meta.name || "",
    name: "",
    summary: meta.description || "",
    category: meta.category || "",
    version: meta.version || "",
    trigger: meta.trigger || "",
    content: body.trim(),
  };
  payload.name = firstHeading(payload.content) || payload.key;
  return payload;
}
