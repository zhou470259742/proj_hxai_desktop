import { createHash } from "node:crypto";
import { db, nowIso } from "./db.mjs";
import { CONFIG } from "./config.mjs";
import { decodeToken, issueToken, randomToken } from "./crypto.mjs";
import { forbidden, unauthorized } from "./http.mjs";

export function bearerFromRequest(req) {
  const header = req.headers.authorization || "";
  if (header.toLowerCase().startsWith("bearer ")) return header.slice(7).trim();
  const cookie = req.headers.cookie || "";
  const hit = cookie
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${CONFIG.cookieName}=`));
  return hit ? decodeURIComponent(hit.slice(CONFIG.cookieName.length + 1)) : null;
}

export function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    email: row.email,
    department: row.department,
    role: row.role,
    status: row.status,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
  };
}

export function createSession(user, { ip, ua }) {
  const jti = randomToken(18);
  const now = new Date();
  const exp = new Date(now.getTime() + CONFIG.tokenTtlSeconds * 1000);
  db.prepare(
    "INSERT INTO sessions(jti, user_id, created_at, expires_at, revoked, ip, user_agent) VALUES(?,?,?,?,0,?,?)"
  ).run(jti, user.id, now.toISOString(), exp.toISOString(), ip || null, (ua || "").slice(0, 200));
  const token = issueToken({
    sub: user.id,
    role: user.role,
    jti,
    iat: Math.floor(now.getTime() / 1000),
    exp: Math.floor(exp.getTime() / 1000),
  });
  return { token, jti, expiresAt: exp.toISOString() };
}

export function revokeSession(jti) {
  if (!jti) return;
  db.prepare("UPDATE sessions SET revoked = 1 WHERE jti = ?").run(jti);
}

/**
 * CSRF 防护：写操作如果是**靠 Cookie 认出身份**的，就要求同源。
 *
 * 为什么只针对 Cookie：
 *   - 浏览器不会给跨站请求自动带 `Authorization` 头，Bearer 请求本身免疫 CSRF；
 *   - Cookie 会被浏览器自动带上，所以拿 Cookie 当凭证时必须自己校验来源。
 *
 * 判据用 Origin（现代浏览器对 POST/PATCH/DELETE 都会发），缺失时回退 Referer；
 * 两者都缺失才放行——那是非浏览器客户端（curl/脚本），不存在「被第三方站点
 * 借用用户浏览器身份」的问题，且它们本来就该用 Bearer。
 *
 * 注意：**不校验在校验之前就拒绝**会让「同站但不同端口」也被挡（Origin 带端口）。
 * 这里与请求自己的 Host 比对，反代场景下 Host 会被改写成目标地址，所以还要
 * 允许 `CONFIG.publicBaseUrl` 的 origin。
 */
export function enforceCsrf(ctx) {
  const method = String(ctx.req.method || "").toUpperCase();
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return;
  if (!isCookieAuthenticated(ctx.req)) return;

  const origin = ctx.req.headers.origin || originFromReferer(ctx.req.headers.referer);
  if (!origin) return; // 非浏览器客户端，走 Bearer 语义
  const allowed = new Set();
  const host = ctx.req.headers.host;
  if (host) allowed.add(`${protoOf(ctx.req)}//${host}`);
  try {
    allowed.add(new URL(CONFIG.publicBaseUrl).origin);
  } catch {
    // publicBaseUrl 配错了不该让所有写操作失败，忽略。
  }
  if (allowed.has(origin)) return;
  throw forbidden(`跨站写操作被拒绝（来源 ${origin} 不在允许列表）`, "csrf_origin_mismatch");
}

function originFromReferer(referer) {
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

function protoOf(req) {
  // 反代进来的请求协议由 x-forwarded-proto 决定；直连时按加密与否判断。
  const forwarded = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  if (forwarded === "https" || forwarded === "http") return forwarded;
  return req.socket?.encrypted ? "https" : "http";
}

/** 这次请求是不是靠 Cookie 认出来的（而不是 Bearer 头）。 */
function isCookieAuthenticated(req) {
  const header = req.headers.authorization || "";
  if (header.toLowerCase().startsWith("bearer ")) return false;
  return String(req.headers.cookie || "").includes(`${CONFIG.cookieName}=`);
}

/**
 * 解析当前用户。允许匿名（用户未登录时 ctx.user = null），
 * 需要鉴权的接口自己调 requireAuth。
 */
export function attachUser(ctx) {
  const token = bearerFromRequest(ctx.req);
  ctx.token = token;
  ctx.user = null;
  if (!token) return;
  const payload = decodeToken(token);
  if (!payload) return;
  const session = db.prepare("SELECT * FROM sessions WHERE jti = ?").get(payload.jti);
  if (!session || session.revoked || new Date(session.expires_at) < new Date()) return;
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(payload.sub);
  if (!row || row.status !== "active") return;
  ctx.user = publicUser(row);
  ctx.jti = payload.jti;
}

export function requireAuth(ctx) {
  if (!ctx.user) throw unauthorized();
  return ctx.user;
}

export function requireRole(ctx, ...roles) {
  const user = requireAuth(ctx);
  if (!roles.includes(user.role)) throw forbidden();
  return user;
}

export function isAdmin(ctx) {
  return ctx.user?.role === "admin";
}

export function touchLogin(userId) {
  db.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(nowIso(), userId);
}

/* --------------------------- 登录失败限流 --------------------------- */
/*
 * 策略：同一 (账号, IP) 连续失败 5 次锁 15 分钟；窗口 15 分钟。
 * 为什么按「账号 + IP」而不是只按账号：只按账号的话，攻击者用一个脚本对
 * admin 连续试错就能把管理员锁在门外（拿 DoS 换暴力破解）。按组合锁，
 * 正常用户从自己的 IP 登录不受别人攻击影响。
 * 为什么不用内存 Map：进程重启即清空，等于给了攻击者一个绕过手段。
 *
 * 计数落库，键是 `账号\u0000IP` 的 sha256（不把明文 IP 当主键，避免
 * 日志/库表里堆一堆 IP，也让 key 长度可控）。
 */
export const LOGIN_MAX_FAILURES = Number(process.env.OWCP_LOGIN_MAX_FAILURES || 5);
export const LOGIN_LOCK_SECONDS = Number(process.env.OWCP_LOGIN_LOCK_SECONDS || 15 * 60);
const LOGIN_WINDOW_MS = Number(process.env.OWCP_LOGIN_WINDOW_SECONDS || 15 * 60) * 1000;

function attemptKey(username, ip) {
  return createHash("sha256")
    .update(`${String(username || "").toLowerCase()}\u0000${ip || ""}`)
    .digest("hex");
}

/**
 * 检查是否处于锁定状态。
 *
 * 返回 `{ locked: true, retryAfterSeconds, failures }` 或 `{ locked: false }`。
 * 锁定期过了但计数还在窗口内时不自动解锁——只有窗口整体过期才清零，
 * 否则「锁 15 分钟」会变成「每 15 分钟送你 5 次机会」。
 */
export function checkLoginLock(username, ip) {
  const row = db.prepare("SELECT * FROM login_attempts WHERE key = ?").get(attemptKey(username, ip));
  if (!row) return { locked: false, failures: 0 };
  const now = Date.now();
  if (row.locked_until && new Date(row.locked_until).getTime() > now) {
    return {
      locked: true,
      failures: row.failures,
      retryAfterSeconds: Math.max(1, Math.ceil((new Date(row.locked_until).getTime() - now) / 1000)),
    };
  }
  // 窗口过期，计数作废（惰性清理，不给每次登录加一次写）。
  if (now - new Date(row.first_failed_at).getTime() > LOGIN_WINDOW_MS) {
    db.prepare("DELETE FROM login_attempts WHERE key = ?").run(row.key);
    return { locked: false, failures: 0 };
  }
  return { locked: false, failures: row.failures };
}

/** 记一次失败；达到阈值即锁定。返回本次之后的失败次数与锁定截止时间。 */
export function recordLoginFailure(username, ip) {
  const key = attemptKey(username, ip);
  const now = new Date();
  const row = db.prepare("SELECT * FROM login_attempts WHERE key = ?").get(key);
  const expired = row && now.getTime() - new Date(row.first_failed_at).getTime() > LOGIN_WINDOW_MS;
  const failures = (row && !expired ? row.failures : 0) + 1;
  const firstFailedAt = row && !expired ? row.first_failed_at : now.toISOString();
  const lockedUntil =
    failures >= LOGIN_MAX_FAILURES
      ? new Date(now.getTime() + LOGIN_LOCK_SECONDS * 1000).toISOString()
      : null;
  db.prepare(
    `INSERT INTO login_attempts(key, failures, first_failed_at, last_failed_at, locked_until)
     VALUES(?,?,?,?,?)
     ON CONFLICT(key) DO UPDATE SET failures = excluded.failures,
       first_failed_at = excluded.first_failed_at,
       last_failed_at = excluded.last_failed_at,
       locked_until = excluded.locked_until`
  ).run(key, failures, firstFailedAt, now.toISOString(), lockedUntil);
  return { failures, lockedUntil };
}

/** 登录成功后清零（成功一次就说明密码是对的）。 */
export function clearLoginFailures(username, ip) {
  db.prepare("DELETE FROM login_attempts WHERE key = ?").run(attemptKey(username, ip));
}
