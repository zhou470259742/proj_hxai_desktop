import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

export class HttpError extends Error {
  constructor(status, message, code = "error", detail = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

export const bad = (msg, detail) => new HttpError(400, msg, "bad_request", detail);
export const unauthorized = (msg = "未登录或登录已过期") => new HttpError(401, msg, "unauthorized");
export const forbidden = (msg = "没有权限执行该操作") => new HttpError(403, msg, "forbidden");
export const notFound = (msg = "资源不存在") => new HttpError(404, msg, "not_found");

/** 极简路由：支持 /a/:id/b 形式的参数 */
function compile(pattern) {
  const keys = [];
  const source = pattern
    .split("/")
    .map((seg) => {
      if (seg.startsWith(":")) {
        keys.push(seg.slice(1));
        return "([^/]+)";
      }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return { re: new RegExp(`^${source}/?$`), keys };
}

export function createApp() {
  const routes = [];

  const add = (method, pattern, handler) => {
    const { re, keys } = compile(pattern);
    routes.push({ method, re, keys, handler, pattern });
  };

  const app = {
    get: (p, h) => add("GET", p, h),
    post: (p, h) => add("POST", p, h),
    patch: (p, h) => add("PATCH", p, h),
    put: (p, h) => add("PUT", p, h),
    delete: (p, h) => add("DELETE", p, h),
    routes,
  };

  async function readBody(req, limit = 4 * 1024 * 1024) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > limit) throw new HttpError(413, "请求体过大", "payload_too_large");
      chunks.push(chunk);
    }
    if (!chunks.length) return {};
    const type = req.headers["content-type"] || "";
    // 二进制上传（插件 zip）：原样返回 Buffer，由路由自行落盘。
    if (type.includes("application/octet-stream") || type.includes("application/zip")) {
      return { __binary: Buffer.concat(chunks) };
    }
    const raw = Buffer.concat(chunks).toString("utf8");
    if (type.includes("application/json")) {
      try {
        return JSON.parse(raw);
      } catch {
        throw bad("请求体不是合法 JSON");
      }
    }
    if (type.includes("application/x-www-form-urlencoded")) {
      return Object.fromEntries(new URLSearchParams(raw));
    }
    return { __raw: raw };
  }

  function send(res, status, body, headers = {}) {
    const isBuffer = Buffer.isBuffer(body);
    const payload = isBuffer ? body : typeof body === "string" ? body : JSON.stringify(body);
    res.writeHead(status, {
      "content-type": isBuffer ? "application/octet-stream" : "application/json; charset=utf-8",
      ...headers,
    });
    res.end(payload);
  }

  async function serveStatic(req, res, publicDir, pathname) {
    let rel = decodeURIComponent(pathname);
    if (rel === "/" || rel === "") rel = "/index.html";
    const target = normalize(join(publicDir, rel));
    if (!target.startsWith(publicDir)) return false;
    try {
      const info = await stat(target);
      if (!info.isFile()) return false;
      const data = await readFile(target);
      res.writeHead(200, {
        "content-type": MIME[extname(target)] || "application/octet-stream",
        "cache-control": "no-cache",
      });
      res.end(data);
      return true;
    } catch {
      return false;
    }
  }

  app.listen = ({ port, host, publicDir }) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
      const pathname = url.pathname;
      const startedAt = Date.now();
      const shouldLog = !/\.(css|js|png|jpg|svg|ico|woff2)$/.test(pathname) && pathname !== "/";
      if (shouldLog) {
        res.on("finish", () => {
          const ms = Date.now() - startedAt;
          console.log(`${new Date().toISOString().slice(11, 19)}  ${String(res.statusCode).padEnd(3)} ${req.method.padEnd(6)} ${pathname}${url.search ? "" : ""}  ${ms}ms`);
        });
      }

      // 统一 CORS：桌面端 / 独立前端调试需要
      res.setHeader("access-control-allow-origin", req.headers.origin || "*");
      res.setHeader("access-control-allow-credentials", "true");
      res.setHeader("access-control-allow-headers", "content-type, authorization, if-none-match");
      res.setHeader("access-control-allow-methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS");
      res.setHeader("x-content-type-options", "nosniff");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        return res.end();
      }

      const match = routes
        .filter((r) => r.method === req.method)
        .map((r) => ({ r, m: r.re.exec(pathname) }))
        .find((x) => x.m);

      if (!match) {
        if (req.method === "GET" && await serveStatic(req, res, publicDir, pathname)) return;
        // 单页应用回退
        if (req.method === "GET" && !pathname.startsWith("/api/") && !pathname.startsWith("/v1/")) {
          if (await serveStatic(req, res, publicDir, "/index.html")) return;
        }
        return send(res, 404, { error: "not_found", message: `接口不存在: ${req.method} ${pathname}` });
      }

      const { r, m } = match;
      const params = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));

      const ctx = {
        req,
        res,
        params,
        query: Object.fromEntries(url.searchParams),
        body: req.method === "GET" || req.method === "DELETE" ? {} : await readBody(req).catch((e) => {
          throw e;
        }),
        headers: req.headers,
        ip: (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "",
      };

      try {
        if (app.before) await app.before(ctx);
        const result = await r.handler(ctx);
        if (res.writableEnded) return;
        if (result && result.__file) {
          res.writeHead(200, { "content-type": result.type, "content-disposition": `attachment; filename="${result.name}"` });
          return res.end(result.body);
        }
        if (result === undefined) return send(res, 204, "");
        const status = result?.__status || 200;
        const payload = result?.__status ? result.body : result;
        return send(res, status, payload ?? { ok: true });
      } catch (err) {
        const status = err.status || 500;
        if (status >= 500) console.error(`[error] ${req.method} ${pathname}`, err);
        return send(res, status, {
          error: err.code || "internal_error",
          message: status >= 500 ? "服务器内部错误" : err.message,
          detail: err.detail || undefined,
        });
      }
    });
    server.listen(port, host);
    return server;
  };

  return app;
}

export const ok = (body) => ({ __status: 200, body });
export const created = (body) => ({ __status: 201, body });
