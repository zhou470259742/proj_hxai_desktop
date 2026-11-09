/* HX AI 工作台 · 管理控制面 —— 管理后台前端（无构建步骤） */

/* ------------------------------ 图标 ------------------------------ */
const ICONS = {
  grid: '<path d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  plug: '<path d="M12 22v-5M9 8V2M15 8V2M18 8H6v4a6 6 0 0 0 12 0z"/>',
  store: '<path d="M3.5 9 5.2 3.6A1 1 0 0 1 6.15 3h11.7a1 1 0 0 1 .95.6L20.5 9"/><path d="M4 9h16v10.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19.5z"/><path d="M9.5 21v-6h5v6"/><path d="M3.5 9a2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 2-2.4"/>',
  sparkles: '<path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  send: '<path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  refresh: '<path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="M11 4H4v16h16v-7"/><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  bolt: '<path d="M13 2 3 14h8l-1 8 10-12h-8z"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  cpu: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3"/>',
  key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m11 12 9-9M17 4l3 3M14 7l3 3"/>',
  "arrow-up-right": '<path d="M7 17 17 7M9 7h8v8"/>',
};

const svg = (name, size = 16) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ""}</svg>`;

function hydrateIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((el) => {
    el.innerHTML = svg(el.dataset.icon, el.dataset.size || 16);
  });
}

/* ------------------------------ 基础工具 ------------------------------ */
const $ = (sel) => document.querySelector(sel);
const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const TOKEN_KEY = "owcp_token";
let token = localStorage.getItem(TOKEN_KEY) || "";

async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return {};
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text };
  }
  if (!res.ok) {
    const err = new Error(data.message || `请求失败 (${res.status})`);
    err.status = res.status;
    err.code = data.error;
    throw err;
  }
  return data;
}

async function downloadFile(path, filename) {
  const res = await fetch(path, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || `导出失败 (${res.status})`);
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(await res.blob());
  a.download = filename || "download";
  a.click();
  URL.revokeObjectURL(a.href);
}

async function importFile(path, file) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/octet-stream", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: await file.arrayBuffer(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `导入失败 (${res.status})`);
  return data;
}

function pickFile(accept, handler) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = accept;
  input.onchange = async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      await handler(file);
    } catch (err) {
      toast(err.message, "err");
    }
  };
  input.click();
}

function toast(msg, type = "ok") {
  const el = document.createElement("div");
  el.className = `toast ${type === "err" ? "err" : ""}`;
  el.innerHTML = `${svg(type === "err" ? "alert" : "check", 15)}<span>${esc(msg)}</span>`;
  $("#toasts").appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function confirmDialog({ title, desc, okText = "确认", danger = false }) {
  return new Promise((resolve) => {
    const root = $("#modalRoot");
    root.innerHTML = `
      <div class="modal-scrim">
        <div class="modal">
          <h4>${esc(title)}</h4>
          <p>${desc}</p>
          <div class="foot">
            <button class="btn btn-sm" data-no>取消</button>
            <button class="btn btn-sm ${danger ? "btn-danger" : "btn-primary"}" data-yes>${esc(okText)}</button>
          </div>
        </div>
      </div>`;
    const close = (v) => {
      root.innerHTML = "";
      resolve(v);
    };
    root.querySelector("[data-no]").onclick = () => close(false);
    root.querySelector("[data-yes]").onclick = () => close(true);
    root.querySelector(".modal-scrim").onclick = (e) => {
      if (e.target.classList.contains("modal-scrim")) close(false);
    };
  });
}

function relTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60e3) return "刚刚";
  if (diff < 3600e3) return `${Math.floor(diff / 60e3)} 分钟前`;
  if (diff < 864e5) return `${Math.floor(diff / 3600e3)} 小时前`;
  const pad = (n) => String(n).padStart(2, "0");
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return `${sameYear ? "" : d.getFullYear() + "-"}${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const STATUS_META = {
  published: ["green", "已发布"],
  enabled: ["green", "已启用"],
  draft: ["amber", "草稿"],
  offline: ["gray", "已下线"],
  disabled: ["red", "已停用"],
  active: ["green", "正常"],
};
const statusPill = (s) => {
  const [cls, label] = STATUS_META[s] || ["gray", s];
  return `<span class="pill ${cls}">${esc(label)}</span>`;
};
const AUTH_LABEL = { oauth: "OAuth 2.1", bearer: "Bearer", none: "无需授权" };
const TRANSPORT_LABEL = { streamable_http: "Streamable HTTP", sse: "SSE", stdio: "stdio 本地" };
const PERM_LABEL = { read_only: "只读", confirm_write: "写需确认", full: "完全授权" };
const ROLE_LABEL = { admin: "管理员", publisher: "发布者", member: "成员" };
const hasPerm = (key) => state.perms?.has(key) ?? false;
const roleLabel = (id) => state.roles.find((r) => r.id === id)?.name || ROLE_LABEL[id] || id;
const VIEW_PERMS = { experts: "experts", plugins: "plugins", skills: "skills", users: "users", audit: "audit", "client-config": "client_config", apps: "client_config", instances: "instances" };
function applyNavPerms() {
  document.querySelectorAll(".nav-item").forEach((el) => {
    const perm = VIEW_PERMS[el.dataset.view];
    el.style.display = perm && !hasPerm(perm) ? "none" : "";
  });
}

/* ------------------------------ 状态 ------------------------------ */
const state = {
  user: null,
  perms: new Set(),
  roles: [],
  usersTab: "users",
  view: "overview",
  experts: [],
  plugins: [],
  skills: [],
  providers: [],
  aliases: [],
  users: [],
  overview: null,
  audit: { items: [], total: 0, page: 1 },
  settings: {},
  filters: { skill: "", expertStatus: "all", pluginStatus: "all"},
};

/* ------------------------------ 登录 ------------------------------ */
function showLogin() {
  $("#login").hidden = false;
  $("#app").hidden = true;
  setTimeout(() => $("#username")?.focus(), 60);
}

function showApp() {
  $("#login").hidden = true;
  $("#app").hidden = false;
  const initials = (state.user.displayName || state.user.username).slice(0, 1);
  $("#sideAvatar").textContent = initials;
  $("#sideWho").innerHTML = `${esc(state.user.displayName)}<span>${esc(ROLE_LABEL[state.user.role] || state.user.role)} · ${esc(state.user.department || "—")}</span>`;
  applyNavPerms();
}

$("#loginForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("#loginBtn");
  const err = $("#loginError");
  err.hidden = true;
  btn.disabled = true;
  btn.textContent = "登录中…";
  try {
    const oidcNext = new URLSearchParams(location.search).get("oidc_next");
    const data = await api("/api/auth/login", {
      method: "POST",
      body: {
        username: $("#username").value.trim(),
        password: $("#password").value,
        scope: oidcNext && oidcNext.startsWith("/") ? "oidc" : "console",
      },
    });
    token = data.token;
    localStorage.setItem(TOKEN_KEY, token);
    state.user = data.user;
    state.perms = new Set(data.permissions || []);
    // OIDC 授权续跳：登录完成后回 authorize 端点继续发码（只放行站内路径）
    const next = new URLSearchParams(location.search).get("oidc_next");
    if (next && next.startsWith("/") && !next.startsWith("//")) {
      location.href = next;
      return;
    }
    showApp();
    await loadAll();
    navigate("#/overview");
  } catch (e2) {
    err.hidden = false;
    err.textContent = e2.message || "登录失败";
  } finally {
    btn.disabled = false;
    btn.textContent = "登 录";
  }
});

$("#logoutBtn")?.addEventListener("click", async () => {
  try {
    await api("/api/auth/logout", { method: "POST" });
  } catch {}
  token = "";
  localStorage.removeItem(TOKEN_KEY);
  location.hash = "";
  showLogin();
});

/* ------------------------------ 数据加载 ------------------------------ */
async function loadAll() {
  const grab = (perm, url) =>
    hasPerm(perm) ? api(url).then((r) => r.items).catch(() => []) : Promise.resolve([]);
  const [experts, plugins, skills] = await Promise.all([
    grab("experts", "/api/experts"),
    grab("plugins", "/api/plugins"),
    grab("skills", "/api/skills"),
  ]);
  state.experts = experts;
  state.plugins = plugins;
  state.skills = skills;
  if (hasPerm("users")) {
    try {
      state.users = (await api("/api/users")).items;
    } catch {
      state.users = [];
    }
  }
  if (hasPerm("roles")) {
    try {
      state.roles = (await api("/api/roles")).items;
    } catch {
      state.roles = [];
    }
  }
  $("#countExperts").textContent = state.experts.length;
  $("#countPlugins").textContent = state.plugins.length;
  $("#countSkills").textContent = state.skills.length;
  await refreshMeta();
}

async function refreshMeta() {
  const ov = await api("/api/overview");
  state.overview = ov;
  $("#versionText").textContent = `${ov.counts.experts} 专家 · ${ov.counts.plugins} 插件`;
}

/* ------------------------------ 路由 ------------------------------ */
const VIEW_META = {
  overview: ["概览", "运营"],
  experts: ["专家管理", "运营"],
  plugins: ["插件管理", "运营"],
  skills: ["技能商城", "运营"],
  users: ["用户与权限", "治理"],
  audit: ["审计日志", "治理"],
  apps: ["应用管理", "运营"],
  "client-config": ["客户端配置", "治理"],
  instances: ["实例管理", "治理"],
};

const RENDERERS = {
  overview: renderOverview,
  experts: renderExperts,
  plugins: renderPlugins,
  skills: renderSkills,
  users: renderUsers,
  audit: renderAudit,
  apps: renderAppManager,
  "client-config": renderClientConfig,
  instances: renderInstances,
};

async function navigate(hash) {
  closeDrawer();
  let view = (hash || "#/overview").replace("#/", "") || "overview";
  if (VIEW_PERMS[view] && !hasPerm(VIEW_PERMS[view])) view = "overview";
  state.view = RENDERERS[view] ? view : "overview";
  document.querySelectorAll(".nav-item").forEach((el) => el.classList.toggle("active", el.dataset.view === state.view));
  const [title, crumb] = VIEW_META[state.view];
  $("#pageTitle").textContent = title;
  $("#pageCrumb").textContent = `/ ${crumb}`;
  $("#view").innerHTML = `<div class="card"><div class="card-body"><div class="skeleton" style="width:200px;margin-bottom:12px"></div><div class="skeleton" style="width:60%"></div></div></div>`;
  try {
    await RENDERERS[state.view]();
  } catch (e) {
    if (e.status === 401) {
      token = "";
      localStorage.removeItem(TOKEN_KEY);
      showLogin();
      return;
    }
    $("#view").innerHTML = `<div class="card"><div class="card-body"><div class="notice warn">${svg("alert", 16)}<span>加载失败：${esc(e.message)}</span></div></div></div>`;
  }
  hydrateIcons($("#view"));
}

window.addEventListener("hashchange", () => navigate(location.hash));
document.querySelectorAll(".nav-item").forEach((el) =>
  el.addEventListener("click", () => {
    location.hash = `#/${el.dataset.view}`;
  })
);
$("#refreshBtn").addEventListener("click", async () => {
  await loadAll();
  await navigate(location.hash);
  toast("已刷新");
});
$("#versionChip").addEventListener("click", () => (location.hash = "#/client-config"));

/* ------------------------------ 概览 ------------------------------ */
async function renderOverview() {
  const ov = state.overview || (await api("/api/overview"));
  state.overview = ov;
  const c = ov.counts;
  const total = ov.byCategory.reduce((s, x) => s + x.count, 0) || 1;
  const authColors = { oauth: "#2563eb", bearer: "#d97706", none: "#64748b" };

  $("#view").innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">控制面总览</h1>
        <p class="page-desc">所有已安装的客户端都从这里取配置。清单版本变化时，客户端下次启动自动同步。</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-sm" data-go="audit"><span data-icon="list"></span>查看审计</button>
        <button class="btn btn-sm btn-primary" data-go="experts"><span data-icon="plus"></span>新建专家</button>
      </div>
    </div>

    <div class="stats">
      <div class="stat">
        <div class="stat-icon">${svg("users", 16)}</div>
        <div class="stat-label">专家</div>
        <div class="stat-value">${c.experts}<small>/ ${c.expertsPublished} 已发布</small></div>
        <div class="stat-foot">绑定插件与技能后即可下发</div>
      </div>
      <div class="stat">
        <div class="stat-icon">${svg("plug", 16)}</div>
        <div class="stat-label">插件</div>
        <div class="stat-value">${c.plugins}<small>/ ${c.pluginsEnabled} 已启用</small></div>
        <div class="stat-foot">按 MCP 标准接入业务系统</div>
      </div>
      <div class="stat">
        <div class="stat-icon">${svg("sparkles", 16)}</div>
        <div class="stat-label">技能</div>
        <div class="stat-value">${c.skills}<small>/ ${c.skillsPublished} 已发布</small></div>
        <div class="stat-foot">目录包标准，可跨实例迁移</div>
      </div>
      <div class="stat">
        <div class="stat-icon">${svg("shield", 16)}</div>
        <div class="stat-label">在用账号</div>
        <div class="stat-value">${c.users}</div>
        <div class="stat-foot">近 24h 操作 <b>${c.auditToday}</b> 次</div>
      </div>
    </div>

    <div class="cols-2">
      <div class="card">
        <div class="card-head">
          <h3>插件分类分布</h3>
          <span class="sub">共 ${total} 个接入</span>
          <div class="right"><button class="btn btn-sm btn-ghost" data-go="plugins">管理插件</button></div>
        </div>
        <div class="card-body">
          <div class="bars">
            ${ov.byCategory
              .map(
                (x) => `<div class="bar-row">
                  <span>${esc(x.category || "未分类")}</span>
                  <div class="bar-track"><div class="bar-fill" style="width:${Math.round((x.count / total) * 100)}%"></div></div>
                  <span class="bar-val">${x.count}</span>
                </div>`
              )
              .join("")}
          </div>
          <div class="section-label" style="margin-top:22px">认证方式</div>
          <div class="bars">
            ${ov.authMix
              .map(
                (x) => `<div class="bar-row">
                  <span>${esc(AUTH_LABEL[x.type] || x.type)}</span>
                  <div class="bar-track"><div class="bar-fill" style="width:${Math.round((x.count / total) * 100)}%;background:${authColors[x.type] || "#9aa3b2"}"></div></div>
                  <span class="bar-val">${x.count}</span>
                </div>`
              )
              .join("")}
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <h3>最近操作</h3>
          <div class="right"><button class="btn btn-sm btn-ghost" data-go="audit">全部</button></div>
        </div>
        <div class="card-body" style="padding-top:6px">
          ${ov.recent
            .map(
              (r) => `<div class="log-item">
                <div class="log-dot"></div>
                <div class="log-main">
                  <div class="l1"><b>${esc(r.actor)}</b> ${esc(r.action)} · ${esc(r.target || "—")}</div>
                  <div class="l2">${relTime(r.createdAt)}</div>
                </div>
              </div>`
            )
            .join("") || '<div class="empty">暂无操作记录</div>'}
        </div>
      </div>
    </div>

  `;

  $("#view").querySelectorAll("[data-go]").forEach((el) =>
    el.addEventListener("click", () => (location.hash = `#/${el.dataset.go}`))
  );
}

/* ------------------------------ 专家管理 ------------------------------ */
async function renderExperts() {
  const [data, ccfg] = await Promise.all([api("/api/experts"), api("/api/client-config")]);
  state.experts = data.items;
  const filter = state.filters.expertStatus;
  const list = data.items.filter((e) => filter === "all" || e.status === filter);

  $("#view").innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">专家管理</h1>
        <p class="page-desc">专家 = 角色提示词 + 插件白名单 + 技能白名单 + 权限档位。白名单即安全边界，专家只能调用配给它的能力。</p>
      </div>
      <div class="page-actions">
        <button class="btn" data-act="import-expert"><span data-icon="upload"></span>导入专家</button>
        <button class="btn btn-primary" data-act="new-expert"><span data-icon="plus"></span>新建专家</button>
      </div>
    </div>

    <div class="toolbar">
      <div class="seg" data-seg="expertStatus">
        ${[["all", "全部"], ["published", "已发布"], ["draft", "草稿"], ["offline", "已下线"]]
          .map(([v, l]) => `<button class="${filter === v ? "active" : ""}" data-v="${v}">${l}</button>`)
          .join("")}
      </div>
      <span style="color:var(--muted);font-size:12.5px">共 ${list.length} 个专家</span>
    </div>

    <div class="card"><div class="card-body tight table-wrap">
      ${
        list.length
          ? `<table class="tbl">
              <thead><tr>
                <th style="width:25%">专家</th><th>状态</th><th>插件</th><th>技能</th><th>权限档位</th><th>授权范围</th><th>更新</th><th></th>
              </tr></thead>
              <tbody>
                ${list
                  .map(
                    (e) => `<tr>
                      <td>
                        <div class="cell-main">
                          <div class="emoji-box">${esc(e.emoji)}</div>
                          <div>
                            <div class="cell-title">${esc(e.name)}</div>
                            <div class="cell-sub mono">${esc(e.key)}</div>
                          </div>
                        </div>
                      </td>
                      <td>${statusPill(e.status)}</td>
                      <td><div class="taglist">${
                        e.plugins.slice(0, 2).map((p) => `<span class="tag">${esc(p.name)}</span>`).join("") +
                        (e.plugins.length > 2 ? `<span class="tag more">+${e.plugins.length - 2}</span>` : "") ||
                        '<span style="color:var(--muted);font-size:12px">未绑定</span>'
                      }</div></td>
                      <td><div class="taglist">${
                        e.skills.slice(0, 2).map((s) => `<span class="tag">${esc(s.name)}</span>`).join("") +
                        (e.skills.length > 2 ? `<span class="tag more">+${e.skills.length - 2}</span>` : "") ||
                        '<span style="color:var(--muted);font-size:12px">未绑定</span>'
                      }</div></td>
                      <td><span class="pill ${e.permissionMode === "read_only" ? "blue" : e.permissionMode === "full" ? "red" : "amber"}">${esc(PERM_LABEL[e.permissionMode] || e.permissionMode)}</span></td>
                      <td style="font-size:12.5px;color:var(--text-2);white-space:nowrap">${
                        e.visibility === "all"
                          ? "全员可用"
                          : e.grants.length
                          ? esc(e.grants.map((g) => (g.subjectType === "role" ? "按角色" : g.subjectId)).join("、"))
                          : "仅创建者"
                      }</td>
                      <td style="font-size:12px;color:var(--muted);white-space:nowrap">${relTime(e.updatedAt)}</td>
                      <td class="actions"><span class="row-actions">
                        <button class="btn btn-sm btn-ghost" data-act="export-expert" data-id="${e.id}" title="导出专家包"><span data-icon="download"></span></button>
                        <button class="btn btn-sm btn-ghost" data-act="publish-expert" data-id="${e.id}" title="发布为客户端插件包"><span data-icon="send"></span></button>
                        <button class="btn btn-sm btn-ghost" data-act="edit-expert" data-id="${e.id}" title="编辑"><span data-icon="edit"></span></button>
                        <button class="btn btn-sm btn-ghost" data-act="dup-expert" data-id="${e.id}" title="复制"><span data-icon="copy"></span></button>
                        <button class="btn btn-sm btn-ghost" data-act="del-expert" data-id="${e.id}" title="删除"><span data-icon="trash"></span></button>
                      </span></td>
                    </tr>`
                  )
                  .join("")}
              </tbody>
            </table>`
          : `<div class="empty">${svg("users", 30)}<div>该状态下没有专家</div></div>`
      }
    </div></div>
  `;
  const mktE = ccfg.market?.experts || { enabled: true, disabled: [] };
  const expAllowed = new Set(ccfg.market?.experts?.allowed || []);
  $("#view").insertAdjacentHTML("beforeend", `
    <div class="card" style="margin-top:16px">
      <div class="card-head"><h3>官方专家市场</h3><button class="btn btn-sm btn-primary" id="govMktE">${svg("check", 14)} 保存</button></div>
      <div class="card-body">
        <label class="check" style="margin-bottom:10px"><input type="checkbox" id="govMktEOn" ${mktE.enabled !== false ? "checked" : ""} /><span>启用官方专家市场</span></label>
        <div class="hint" style="margin-bottom:8px">默认不开放官方专家——点「添加专家」从目录选择要开放的专家加入清单。</div>
        <div id="govExpAllowed" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px"></div>
        <button class="btn btn-sm btn-primary" id="govExpAdd">${svg("plus", 14)} 添加专家</button>
      </div>
    </div>`);
  let expCatalog = null;
  const renderExpAllowed = () => allowedChips($("#govExpAllowed"), expAllowed, renderExpAllowed);
  renderExpAllowed();
  const SCENE_ZH = {
    ecommerce: "电商", finance: "金融", content: "内容创作", lifestyle: "生活健康",
    marketing: "营销", mysticism: "玄学命理", academic: "学术", legal: "法律",
    tech: "技术", education: "教育", healthcare: "医疗健康", hr: "人力行政",
    media: "影视媒体", design: "设计", productivity: "生产力", dev: "开发",
  };
  const sceneOf = (it) => {
    if (it.scene) return String(it.scene);
    const slug = String(it.slug || it.id || "");
    return slug.includes("-") ? slug.split("-")[0] : "other";
  };
  $("#govExpAdd").addEventListener("click", () => openPickDrawer({
    title: "添加官方专家",
    wide: 920,
    allowedSet: expAllowed,
    slugOf: (it) => it.slug || it.id || "",
    renderCard: pickCardHTML,
    tabsOf: (items) => {
      const scenes = [...new Set(items.map(sceneOf))];
      return [{ key: "all", label: "全部" },
        ...scenes.map((s) => ({ key: s, label: SCENE_ZH[s] || s, filter: (it) => sceneOf(it) === s }))];
    },
    onChange: renderExpAllowed,
    loadItems: async () => {
      if (expCatalog) return expCatalog;
      const r = await api("/api/skillhub/catalog?size=200");
      expCatalog = r.items || r.data || r.skillsets || r.skillSets || [];
      return expCatalog;
    },
  }));
  $("#govMktE").addEventListener("click", () =>
    govPatch((c) => ({ ...c, market: { ...(c.market || {}), experts: { enabled: $("#govMktEOn").checked, disabled: [...(ccfg.market?.experts?.disabled || [])], allowed: [...expAllowed] } } })));

  $("#view").querySelectorAll("[data-seg='expertStatus'] button").forEach((b) =>
    b.addEventListener("click", () => {
      state.filters.expertStatus = b.dataset.v;
      renderExperts().then(() => hydrateIcons($("#view")));
    })
  );
  bind("#view", "[data-act='new-expert']", "click", () => openExpertDrawer(null));
  bind("#view", "[data-act='import-expert']", "click", () =>
    pickFile(".json,application/json", async (file) => {
      const r = await importFile("/api/experts/import", file);
      const bits = [`已导入：${r.expert.name}`];
      if (r.keyRemapped) bits.push(`标识改为 ${r.expert.key}`);
      if (r.missingPlugins.length) bits.push(`缺插件 ${r.missingPlugins.join("、")}`);
      if (r.missingSkills.length) bits.push(`缺技能 ${r.missingSkills.join("、")}`);
      toast(bits.join(" · "));
      await loadAll();
      await renderExperts();
      hydrateIcons($("#view"));
    })
  );
  bind("#view", "[data-act='export-expert']", "click", async (e) => {
    const item = state.experts.find((x) => x.id === e.currentTarget.dataset.id);
    try {
      await downloadFile(`/api/experts/${item.id}/export`, `${item.key}.expert.json`);
      toast("已导出专家包");
    } catch (err) {
      toast(err.message, "err");
    }
  });
  bind("#view", "[data-act='edit-expert']", "click", (e) => {
    const id = e.currentTarget.dataset.id;
    openExpertDrawer(state.experts.find((x) => x.id === id));
  });
  bind("#view", "[data-act='publish-expert']", "click", async (e) => {
    const id = e.currentTarget.dataset.id;
    const item = state.experts.find((x) => x.id === id);
    const ok = await confirmDialog({
      title: `发布「${item.name}」到客户端？`,
      desc: "会把专家的角色提示词、白名单内的技能与 MCP 插件打包成一个 ZCode 插件，登记到当前市场。客户端下次拉取市场清单即可安装。",
      okText: "发布",
    });
    if (!ok) return;
    try {
      const r = await api(`/api/experts/${id}/publish`, { method: "POST" });
      toast(`已发布：${r.pluginName} v${r.version || "1.0.0"}（${r.skillCount} 技能 / ${r.mcpServerNames.length} MCP）`);
      await loadAll();
      await renderExperts();
      hydrateIcons($("#view"));
    } catch (err) {
      toast(err.message, "err");
    }
  });
  bind("#view", "[data-act='dup-expert']", "click", async (e) => {
    await api(`/api/experts/${e.currentTarget.dataset.id}/duplicate`, { method: "POST" });
    toast("已复制为草稿");
    await loadAll();
    await renderExperts();
    hydrateIcons($("#view"));
  });
  bind("#view", "[data-act='del-expert']", "click", async (e) => {
    const id = e.currentTarget.dataset.id;
    const item = state.experts.find((x) => x.id === id);
    if (!(await confirmDialog({ title: `删除专家「${item.name}」？`, desc: "删除后客户端下次同步将不再收到该专家，已发生的对话不受影响。", okText: "删除", danger: true })))
      return;
    await api(`/api/experts/${id}`, { method: "DELETE" });
    toast("已删除");
    await loadAll();
    await renderExperts();
    hydrateIcons($("#view"));
  });
}

function openExpertDrawer(expert) {
  const isNew = !expert;
  const e = expert || {
    id: "",
    key: "",
    name: "",
    roleTitle: "",
    emoji: "🧭",
    summary: "",
    rolePrompt: "",
    version: "1.0.0",
    model: { provider: "internal", name: "deepseek-v3" },
    permissionMode: "confirm_write",
    pluginIds: [],
    skillIds: [],
    visibility: "all",
    status: "draft",
    grants: [],
  };
  const departments = [...new Set(state.users.map((u) => u.department).filter(Boolean))];
  const currentGrants = (e.grants || []).map((g) => `${g.subjectType}:${g.subjectId}`);

  openDrawer({
    title: isNew ? "新建专家" : `编辑专家 · ${e.name}`,
    sub: isNew ? "定义角色、绑定能力、设置权限边界" : `标识 ${e.key} · 更新于 ${relTime(e.updatedAt)}`,
    body: `
      <div class="form-row">
        <div class="field">
          <label>专家名称</label>
          <input class="input" id="f-name" value="${esc(e.name)}" placeholder="如：合同审查专员" />
        </div>
        <div class="field">
          <label>角色头衔</label>
          <input class="input" id="f-roleTitle" value="${esc(e.roleTitle)}" placeholder="如：法务 · 合同风险" />
        </div>
      </div>
      <div class="form-row" style="grid-template-columns:0.9fr 1fr 1fr">
        <div class="field">
          <label>图标（emoji）</label>
          <input class="input" id="f-emoji" value="${esc(e.emoji)}" maxlength="4" />
        </div>
        <div class="field">
          <label>标识 key</label>
          <input class="input" id="f-key" value="${esc(e.key)}" placeholder="自动生成，可改写" ${isNew ? "" : "disabled"} />
          <div class="hint">英文与连字符，客户端按它识别专家</div>
        </div>
        <div class="field">
          <label>版本</label>
          <input class="input" id="f-version" value="${esc(e.version || "1.0.0")}" placeholder="1.0.0" />
          <div class="hint">写进专家包 plugin.json</div>
        </div>
      </div>
      <div class="field">
        <label>一句话说明</label>
        <input class="input" id="f-summary" value="${esc(e.summary)}" placeholder="在专家列表里显示，建议写清边界" />
      </div>

      <div class="section-label">市场信息（可选，发布到客户端市场时展示）</div>
      <div class="form-row" style="grid-template-columns:1.2fr 0.8fr 0.8fr">
        <div class="field">
          <label>欢迎语</label>
          <input class="input" id="f-mwelcome" value="${esc(typeof e.marketMeta?.welcomeMessage === "object" ? (e.marketMeta.welcomeMessage.zh || "") : (e.marketMeta?.welcomeMessage || ""))}" placeholder="缺省用角色头衔" />
        </div>
        <div class="field">
          <label>主题色</label>
          <input class="input" id="f-mcolor" value="${esc(e.marketMeta?.color || "")}" placeholder="#6366f1" />
        </div>
        <div class="field">
          <label>市场图标名</label>
          <input class="input" id="f-micon" value="${esc(e.marketMeta?.iconName || "")}" placeholder="lucide 名，如 zap" />
          <div class="hint">缺省用上方 emoji</div>
        </div>
      </div>
      <div class="field">
        <label>快捷指令</label>
        <textarea class="textarea" id="f-mprompts" rows="3" placeholder="每行一条：标题|提示词">${esc((e.marketMeta?.quickPrompts || []).map((q) => `${q.title || ""}|${q.prompt || ""}`).join("\n"))}</textarea>
        <div class="hint">专家卡片上的快捷提问入口，写进 manifest.quick_prompts</div>
      </div>
      <div class="field">
        <label>任务示例</label>
        <textarea class="textarea" id="f-mexamples" rows="3" placeholder="每行一条示例任务">${esc(((e.marketMeta?.taskExamples || {}).zh || []).join("\n"))}</textarea>
        <div class="hint">写进 manifest.task_examples.zh</div>
      </div>

      <div class="section-label">角色定义</div>
      <div class="field">
        <label>角色提示词</label>
        <textarea class="textarea" id="f-rolePrompt" rows="8" placeholder="写清：怎么干活、输出什么、什么不能做">${esc(e.rolePrompt)}</textarea>
        <div class="hint">建议三段式：工作方式 / 输出格式 / 边界（不能做什么）</div>
      </div>
      <div class="form-row">
        <div class="field">
          <label>模型</label>
          <div class="form-row">
            <input class="input" id="f-modelProvider" value="${esc(e.model?.provider || "")}" placeholder="供应商 key，如 hxai-gateway" />
            <input class="input" id="f-modelName" value="${esc(e.model?.name || "")}" placeholder="模型 ID，如 deepseek-v4.1-flash-1017" />
          </div>
          <div class="hint">格式 = Octop 侧的 provider:model；真实密钥在 Octop 实例上，这里只存引用</div>
        </div>
        <div class="field">
          <label>状态</label>
          <select class="select" id="f-status">
            ${[["published", "已发布"], ["draft", "草稿"], ["offline", "已下线"]]
              .map(([v, l]) => `<option value="${v}" ${e.status === v ? "selected" : ""}>${l}</option>`)
              .join("")}
          </select>
        </div>
      </div>

      <div class="section-label">权限档位</div>
      <div class="radio-row" id="f-perm">
        ${[
          ["read_only", "只读", "只能查，不能改"],
          ["confirm_write", "写需确认", "每次写操作弹确认"],
          ["full", "完全授权", "写操作直接执行"],
        ]
          .map(
            ([v, t, d]) => `<div class="radio-card ${e.permissionMode === v ? "on" : ""}" data-v="${v}"><b>${t}</b><span>${d}</span></div>`
          )
          .join("")}
      </div>

      <div class="section-label">插件白名单（连接器）</div>
      <div class="check-grid" id="f-plugins">
        ${state.plugins
          .map(
            (p) => `<label class="check-item">
              <input type="checkbox" value="${p.id}" ${e.pluginIds.includes(p.id) ? "checked" : ""} ${p.status !== "enabled" ? "disabled" : ""} />
              <span>${esc(p.name)}</span>
              <span class="ci-sub">${esc(AUTH_LABEL[p.authType])}${p.status !== "enabled" ? " · 未启用" : ""}</span>
            </label>`
          )
          .join("")}
      </div>

      <div class="section-label">技能白名单</div>
      <div class="check-grid" id="f-skills">
        ${state.skills
          .map(
            (s) => `<label class="check-item">
              <input type="checkbox" value="${s.id}" ${e.skillIds.includes(s.id) ? "checked" : ""} ${s.status !== "published" ? "disabled" : ""} />
              <span>${esc(s.name)}</span>
              <span class="ci-sub">v${esc(s.version)}${s.status !== "published" ? " · 未发布" : ""}</span>
            </label>`
          )
          .join("")}
      </div>

      <div class="section-label">授权范围</div>
      <div class="field">
        <label>可见范围</label>
        <select class="select" id="f-visibility">
          ${[
            ["all", "全员可用"],
            ["restricted", "按部门 / 角色授权"],
            ["private", "仅创建者"],
          ]
            .map(([v, l]) => `<option value="${v}" ${e.visibility === v ? "selected" : ""}>${l}</option>`)
            .join("")}
        </select>
      </div>
      <div class="field" id="grantBox">
        <label>授权对象</label>
        <div class="check-grid" style="max-height:none">
          ${departments
            .map(
              (d) => `<label class="check-item">
                <input type="checkbox" value="department:${esc(d)}" ${currentGrants.includes(`department:${d}`) ? "checked" : ""} />
                <span>${esc(d)}</span><span class="ci-sub">部门</span>
              </label>`
            )
            .join("")}
          <label class="check-item">
            <input type="checkbox" value="role:all" ${currentGrants.includes("role:all") ? "checked" : ""} />
            <span>全体成员</span><span class="ci-sub">角色</span>
          </label>
        </div>
      </div>
    `,
    foot: `
      <button class="btn" data-drawer-cancel>取消</button>
      <div class="spacer"></div>
      <button class="btn btn-primary" id="saveExpert">${isNew ? "创建专家" : "保存修改"}</button>
    `,
    onMount: (root) => {
      let perm = e.permissionMode;
      root.querySelectorAll("#f-perm .radio-card").forEach((card) =>
        card.addEventListener("click", () => {
          perm = card.dataset.v;
          root.querySelectorAll("#f-perm .radio-card").forEach((c) => c.classList.toggle("on", c === card));
        })
      );
      root.querySelector("#saveExpert").onclick = async () => {
        const name = root.querySelector("#f-name").value.trim();
        const rolePrompt = root.querySelector("#f-rolePrompt").value.trim();
        if (!name || !rolePrompt) return toast("专家名称与角色提示词必填", "err");
        const provider = root.querySelector("#f-modelProvider").value.trim();
        const modelName = root.querySelector("#f-modelName").value.trim();
        const marketMeta = {};
        const mw = root.querySelector("#f-mwelcome").value.trim();
        const mc = root.querySelector("#f-mcolor").value.trim();
        const mp = root.querySelector("#f-mprompts").value
          .split("\n").map((l) => l.trim()).filter(Boolean)
          .map((l) => {
            const i = l.indexOf("|");
            return i > 0
              ? { title: l.slice(0, i).trim(), prompt: l.slice(i + 1).trim() }
              : { title: l, prompt: l };
          });
        const me = root.querySelector("#f-mexamples").value
          .split("\n").map((l) => l.trim()).filter(Boolean);
        const mi = root.querySelector("#f-micon").value.trim();
        if (mw) marketMeta.welcomeMessage = mw;
        else if (e.marketMeta?.welcomeMessage && typeof e.marketMeta.welcomeMessage === "object") {
          marketMeta.welcomeMessage = e.marketMeta.welcomeMessage;
        }
        if (mc) marketMeta.color = mc;
        if (mi) marketMeta.iconName = mi;
        if (mp.length) marketMeta.quickPrompts = mp;
        if (me.length) marketMeta.taskExamples = { zh: me };
        const payload = {
          name,
          key: root.querySelector("#f-key").value.trim(),
          roleTitle: root.querySelector("#f-roleTitle").value.trim(),
          emoji: root.querySelector("#f-emoji").value.trim() || "🧭",
          summary: root.querySelector("#f-summary").value.trim(),
          rolePrompt,
          version: root.querySelector("#f-version").value.trim() || "1.0.0",
          model: { provider, name: modelName },
          permissionMode: perm,
          status: root.querySelector("#f-status").value,
          visibility: root.querySelector("#f-visibility").value,
          pluginIds: [...root.querySelectorAll("#f-plugins input:checked")].map((i) => i.value),
          skillIds: [...root.querySelectorAll("#f-skills input:checked")].map((i) => i.value),
          grants: [...root.querySelectorAll("#grantBox input:checked")].map((i) => {
            const [subjectType, subjectId] = i.value.split(":");
            return { subjectType, subjectId };
          }),
          marketMeta,
        };
        try {
          if (isNew) await api("/api/experts", { method: "POST", body: payload });
          else await api(`/api/experts/${e.id}`, { method: "PATCH", body: payload });
          toast(isNew ? "专家已创建" : "已保存");
          closeDrawer();
          await loadAll();
          await renderExperts();
          hydrateIcons($("#view"));
        } catch (err) {
          toast(err.message, "err");
        }
      };
    },
  });
}

/* ------------------------------ 插件管理 ------------------------------ */
async function renderPlugins() {
  const [data, ccfg] = await Promise.all([api("/api/plugins"), api("/api/client-config")]);
  state.plugins = data.items;
  const filter = state.filters.pluginStatus;
  const list = data.items.filter((p) => filter === "all" || p.status === filter);

  $("#view").innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">插件管理</h1>
        <p class="page-desc">每个业务系统包成一个 MCP Server 注册在这里。客户端不保存账号密码，登录走 OAuth 2.1 授权码 + PKCE。</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-primary" data-act="new-plugin"><span data-icon="plus"></span>注册插件</button>
      </div>
    </div>

    <div class="toolbar">
      <div class="seg">
        ${[["all", "全部"], ["enabled", "已启用"], ["draft", "草稿"], ["disabled", "已停用"]]
          .map(([v, l]) => `<button class="${filter === v ? "active" : ""}" data-v="${v}">${l}</button>`)
          .join("")}
      </div>
      <span style="color:var(--muted);font-size:12.5px">共 ${list.length} 个插件</span>
    </div>

    <div class="card"><div class="card-body tight table-wrap">
      ${
        list.length
          ? `<table class="tbl">
              <thead><tr>
                <th style="width:26%">插件</th><th>分类</th><th>传输</th><th>认证方式</th><th>可见范围</th><th>状态</th><th>连通性</th><th></th>
              </tr></thead>
              <tbody>
                ${list
                  .map(
                    (p) => `<tr>
                      <td>
                        <div class="cell-main">
                          <div class="emoji-box">${svg("plug", 15)}</div>
                          <div>
                            <div class="cell-title">${esc(p.name)}</div>
                            <div class="cell-sub mono">${esc(p.key)} · v${esc(p.version)}</div>
                          </div>
                        </div>
                      </td>
                      <td style="font-size:12.5px;color:var(--text-2)">${esc(p.category || "—")}</td>
                      <td style="font-size:12.5px">${esc(TRANSPORT_LABEL[p.transport] || p.transport)}</td>
                      <td><span class="pill ${p.authType === "oauth" ? "blue" : p.authType === "none" ? "gray" : "amber"} no-dot">${esc(AUTH_LABEL[p.authType] || p.authType)}</span></td>
                      <td style="font-size:12.5px;color:var(--text-2)">${
                        p.visibility === "all" ? "全员" : p.visibility === "restricted" ? "指定专家" : "仅管理员"
                      }</td>
                      <td>${statusPill(p.status)}</td>
                      <td><span class="pill gray no-dot" data-test-result="${p.id}">未测试</span></td>
                      <td class="actions"><span class="row-actions">
                        <button class="btn btn-sm btn-ghost" data-act="test-plugin" data-id="${p.id}" title="测试连通"><span data-icon="bolt"></span></button>
                        <button class="btn btn-sm btn-ghost" data-act="upload-package" data-id="${p.id}" title="上传插件包（zip）">${p.hasPackage ? "包✓" : "上传包"}</button>
                        <button class="btn btn-sm btn-ghost" data-act="edit-plugin" data-id="${p.id}" title="编辑"><span data-icon="edit"></span></button>
                        <button class="btn btn-sm btn-ghost" data-act="del-plugin" data-id="${p.id}" title="删除"><span data-icon="trash"></span></button>
                      </span></td>
                    </tr>`
                  )
                  .join("")}
              </tbody>
            </table>`
          : `<div class="empty">${svg("plug", 30)}<div>该状态下没有插件</div></div>`
      }
    </div></div>

    <div class="notice info" style="margin-top:14px">${svg("info", 16)}<span>
      演示数据里的插件地址指向 <code class="mono">*.hx.local</code>，内网环境下不可达，测试连通会显示失败——这是预期行为。
      接真实系统时把端点换成实际 MCP 地址即可。<br />
      <b>上传插件包</b>：zip 内必须有 <code class="mono">.zcode-plugin/plugin.json</code>（<code class="mono">name</code> 须与上表「标识」一致），
      否则客户端安装会报 <code class="mono">plugin_manifest_not_found</code>；后台已在上传时校验并拒收。
    </span></div>
  `;
  const conDis = ccfg.connectors?.disabled || [];
  const conAllowed = new Set(ccfg.connectors?.allowed || []);
  $("#view").insertAdjacentHTML("beforeend", `
    <div class="card" style="margin-top:16px">
      <div class="card-head"><h3>内置连接器</h3><button class="btn btn-sm btn-primary" id="govConn">${svg("check", 14)} 保存</button></div>
      <div class="card-body">
        <div class="hint" style="margin-bottom:8px">默认不开放内置连接器——点「添加连接器」从实例上报的目录选择要开放的项。</div>
        <div id="govConAllowed" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px"></div>
        <button class="btn btn-sm btn-primary" id="govConAdd">${svg("plus", 14)} 添加连接器</button>
      </div>
    </div>`);
  let conCatalog = null;
  const renderConAllowed = () => allowedChips($("#govConAllowed"), conAllowed, renderConAllowed);
  renderConAllowed();
  $("#govConAdd").addEventListener("click", () => openPickDrawer({
    title: "添加内置连接器",
    wide: 920,
    allowedSet: conAllowed,
    slugOf: (it) => it.id || it.slug || "",
    renderCard: (it) => `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        <span style="width:30px;height:30px;border-radius:8px;background:#eef0f3;display:inline-flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0">${esc((it.name || it.id || "?").slice(0, 1))}</span>
        <b style="font-size:13px">${esc(it.name || it.id)}</b>
      </div>
      <div class="muted" style="font-size:11px">${esc(it.id)}</div>`,
    onChange: renderConAllowed,
    loadItems: async () => {
      if (conCatalog) return conCatalog;
      const r = await api("/api/connectors/catalog");
      conCatalog = r.items || [];
      return conCatalog;
    },
  }));
  $("#govConn").addEventListener("click", () =>
    govPatch((c) => ({ ...c, connectors: { disabled: [...(ccfg.connectors?.disabled || [])], allowed: [...conAllowed], catalog: (ccfg.connectors || {}).catalog } })));

  $("#view").querySelectorAll(".seg button").forEach((b) =>
    b.addEventListener("click", () => {
      state.filters.pluginStatus = b.dataset.v;
      renderPlugins().then(() => hydrateIcons($("#view")));
    })
  );
  bind("#view", "[data-act='new-plugin']", "click", () => openPluginDrawer(null));
  bind("#view", "[data-act='edit-plugin']", "click", (e) => openPluginDrawer(state.plugins.find((x) => x.id === e.currentTarget.dataset.id)));
  bind("#view", "[data-act='test-plugin']", "click", async (e) => {
    const id = e.currentTarget.dataset.id;
    const cell = $(`[data-test-result='${id}']`);
    cell.textContent = "测试中…";
    try {
      const r = await api(`/api/plugins/${id}/test`, { method: "POST" });
      cell.className = `pill ${r.reachable ? "green" : "red"} no-dot`;
      cell.textContent = r.reachable ? `可达 ${r.latencyMs}ms` : "不可达";
      cell.title = r.detail || "";
      toast(r.detail, r.reachable ? "ok" : "err");
    } catch (err) {
      cell.textContent = "失败";
      toast(err.message, "err");
    }
  });
  bind("#view", "[data-act='upload-package']", "click", (e) => {
    const id = e.currentTarget.dataset.id;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".zip,application/zip";
    input.onchange = async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      try {
        const buf = await file.arrayBuffer();
        const res = await fetch(`/api/plugins/${id}/package`, {
          method: "POST",
          headers: { "content-type": "application/zip", authorization: `Bearer ${token}` },
          body: buf,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || `上传失败 (${res.status})`);
        const bits = [`${(data.size / 1024).toFixed(1)} KB`];
        if (data.manifestVersion) bits.push(`v${data.manifestVersion}`);
        if (data.skillCount) bits.push(`${data.skillCount} 个技能`);
        if (data.hasMcpServers) bits.push("含 MCP");
        toast(`已上传：${data.fileName}（${bits.join(" · ")}）`);
        await renderPlugins();
        hydrateIcons($("#view"));
      } catch (err) {
        toast(err.message, "err");
      }
    };
    input.click();
  });
  bind("#view", "[data-act='del-plugin']", "click", async (e) => {
    const item = state.plugins.find((x) => x.id === e.currentTarget.dataset.id);
    if (!(await confirmDialog({ title: `删除插件「${item.name}」？`, desc: "已绑定该插件的专家将失去这项能力，相关技能可能无法执行。", okText: "删除", danger: true }))) return;
    await api(`/api/plugins/${item.id}`, { method: "DELETE" });
    toast("已删除");
    await loadAll();
    await renderPlugins();
    hydrateIcons($("#view"));
  });
}

function openPluginDrawer(plugin) {
  const isNew = !plugin;
  const p = plugin || {
    id: "",
    key: "",
    name: "",
    summary: "",
    category: "业务系统",
    transport: "streamable_http",
    endpoint: "",
    command: "",
    args: [],
    authType: "oauth",
    authConfig: {},
    visibility: "all",
    version: "1.0.0",
    status: "draft",
  };
  openDrawer({
    title: isNew ? "注册插件" : `编辑插件 · ${p.name}`,
    sub: isNew ? "把一个业务系统的 MCP Server 接进来" : `标识 ${p.key} · v${p.version}`,
    body: `
      <div class="form-row">
        <div class="field"><label>插件名称</label><input class="input" id="f-name" value="${esc(p.name)}" placeholder="如：OA 协同办公" /></div>
        <div class="field"><label>标识 key</label><input class="input" id="f-key" value="${esc(p.key)}" placeholder="自动生成" ${isNew ? "" : "disabled"} /></div>
      </div>
      <div class="field"><label>功能说明</label><input class="input" id="f-summary" value="${esc(p.summary)}" placeholder="这个插件能做什么，会写进专家的能力清单" /></div>
      <div class="form-row">
        <div class="field"><label>分类</label>
          <select class="select" id="f-category">
            ${["办公协同", "业务系统", "数据", "研发", "通讯"].map((c) => `<option ${p.category === c ? "selected" : ""}>${c}</option>`).join("")}
          </select>
        </div>
        <div class="field"><label>版本</label><input class="input" id="f-version" value="${esc(p.version)}" /></div>
      </div>

      <div class="section-label">传输方式</div>
      <div class="radio-row" id="f-transport">
        ${[["streamable_http", "Streamable HTTP", "远程服务，推荐"], ["stdio", "stdio", "本地进程"], ["sse", "SSE", "旧版远程"]]
          .map(([v, t, d]) => `<div class="radio-card ${p.transport === v ? "on" : ""}" data-v="${v}"><b>${t}</b><span>${d}</span></div>`)
          .join("")}
      </div>
      <div class="field" id="endpointBox" style="margin-top:12px">
        <label>端点 URL</label>
        <input class="input" id="f-endpoint" value="${esc(p.endpoint || "")}" placeholder="https://oa.hx.local/mcp" />
      </div>
      <div id="stdioBox" style="display:none">
        <div class="field"><label>启动命令</label><input class="input" id="f-command" value="${esc(p.command || "")}" placeholder="npx" /></div>
        <div class="field"><label>参数（每行一个）</label><textarea class="textarea code" id="f-args" rows="3">${esc((p.args || []).join("\n"))}</textarea></div>
      </div>

      <div class="section-label">授权方式</div>
      <div class="radio-row" id="f-auth">
        ${[["oauth", "OAuth 2.1", "用户登录后授权"], ["bearer", "Bearer", "服务账号令牌"], ["none", "无需授权", "本地工具"]]
          .map(([v, t, d]) => `<div class="radio-card ${p.authType === v ? "on" : ""}" data-v="${v}"><b>${t}</b><span>${d}</span></div>`)
          .join("")}
      </div>
      <div id="oauthBox" style="margin-top:12px">
        <div class="field"><label>授权服务器</label><input class="input" id="f-as" value="${esc(p.authConfig.authorizationServer || "")}" placeholder="https://sso.hx.local" /></div>
        <div class="form-row">
          <div class="field"><label>Scope</label><input class="input" id="f-scopes" value="${esc((p.authConfig.scopes || []).join(" "))}" placeholder="oa.read oa.write" /></div>
          <div class="field"><label>Client ID</label><input class="input" id="f-client" value="${esc(p.authConfig.clientId || "")}" placeholder="hx-workbench" /></div>
        </div>
        <div class="hint" style="margin-top:-6px">客户端按 RFC 9728 发现授权服务器，回环端口 + PKCE(S256) 完成登录；令牌存系统密钥环，不进渲染进程。</div>
      </div>

      <div class="section-label">可见范围与状态</div>
      <div class="form-row">
        <div class="field"><label>可见范围</label>
          <select class="select" id="f-visibility">
            <option value="all" ${p.visibility === "all" ? "selected" : ""}>全员可用</option>
            <option value="restricted" ${p.visibility === "restricted" ? "selected" : ""}>仅指定专家</option>
            <option value="admin" ${p.visibility === "admin" ? "selected" : ""}>仅管理员</option>
          </select>
        </div>
        <div class="field"><label>状态</label>
          <select class="select" id="f-status">
            <option value="enabled" ${p.status === "enabled" ? "selected" : ""}>已启用</option>
            <option value="draft" ${p.status === "draft" ? "selected" : ""}>草稿</option>
            <option value="disabled" ${p.status === "disabled" ? "selected" : ""}>已停用</option>
          </select>
        </div>
      </div>
    `,
    foot: `<button class="btn" data-drawer-cancel>取消</button><div class="spacer"></div><button class="btn btn-primary" id="savePlugin">${isNew ? "注册插件" : "保存修改"}</button>`,
    onMount: (root) => {
      let transport = p.transport;
      let authType = p.authType;
      const syncTransport = () => {
        root.querySelector("#endpointBox").style.display = transport === "stdio" ? "none" : "";
        root.querySelector("#stdioBox").style.display = transport === "stdio" ? "" : "none";
      };
      const syncAuth = () => {
        root.querySelector("#oauthBox").style.display = authType === "oauth" ? "" : "none";
      };
      syncTransport();
      syncAuth();
      root.querySelectorAll("#f-transport .radio-card").forEach((c) =>
        c.addEventListener("click", () => {
          transport = c.dataset.v;
          root.querySelectorAll("#f-transport .radio-card").forEach((x) => x.classList.toggle("on", x === c));
          syncTransport();
        })
      );
      root.querySelectorAll("#f-auth .radio-card").forEach((c) =>
        c.addEventListener("click", () => {
          authType = c.dataset.v;
          root.querySelectorAll("#f-auth .radio-card").forEach((x) => x.classList.toggle("on", x === c));
          syncAuth();
        })
      );
      root.querySelector("#savePlugin").onclick = async () => {
        const name = root.querySelector("#f-name").value.trim();
        if (!name) return toast("插件名称必填", "err");
        const payload = {
          name,
          key: root.querySelector("#f-key").value.trim(),
          summary: root.querySelector("#f-summary").value.trim(),
          category: root.querySelector("#f-category").value,
          version: root.querySelector("#f-version").value.trim() || "1.0.0",
          transport,
          endpoint: root.querySelector("#f-endpoint").value.trim(),
          command: root.querySelector("#f-command").value.trim(),
          args: root.querySelector("#f-args").value.split("\n").map((s) => s.trim()).filter(Boolean),
          authType,
          authConfig:
            authType === "oauth"
              ? {
                  authorizationServer: root.querySelector("#f-as").value.trim(),
                  scopes: root.querySelector("#f-scopes").value.split(/\s+/).filter(Boolean),
                  clientId: root.querySelector("#f-client").value.trim(),
                }
              : {},
          visibility: root.querySelector("#f-visibility").value,
          status: root.querySelector("#f-status").value,
        };
        try {
          if (isNew) await api("/api/plugins", { method: "POST", body: payload });
          else await api(`/api/plugins/${p.id}`, { method: "PATCH", body: payload });
          toast(isNew ? "插件已注册" : "已保存");
          closeDrawer();
          await loadAll();
          await renderPlugins();
          hydrateIcons($("#view"));
        } catch (err) {
          toast(err.message, "err");
        }
      };
    },
  });
}

/* ------------------------------ 市场管理 ------------------------------ */
// 这里只管桌面端「插件市场 → 市场源」里那些默认源的运营策略：
// 停用市场 / 停用市场内插件后，客户端拉到的 client-config 会带上禁用清单，不再展示对应插件。
// 后台只保存清单快照用于勾选，插件本体仍由客户端从原始市场源拉取，不做镜像分发。
async function renderSkills() {
  const [data, ccfg] = await Promise.all([api("/api/skills"), api("/api/client-config")]);
  state.skills = data.items;
  const q = state.filters.skill.trim().toLowerCase();
  const list = data.items.filter(
    (s) => !q || s.name.toLowerCase().includes(q) || (s.summary || "").toLowerCase().includes(q) || (s.category || "").toLowerCase().includes(q)
  );

  $("#view").innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">技能商城</h1>
        <p class="page-desc">技能是一个完整目录：核心是 SKILL.md，复杂技能还包含脚本与参考资料等多层文件。发布后由专家按需引用，客户端按目录整体加载。</p>
      </div>
      <div class="page-actions">
        <button class="btn" data-act="import-skill"><span data-icon="upload"></span>导入技能</button>
        <button class="btn btn-primary" data-act="new-skill"><span data-icon="plus"></span>上传技能</button>
      </div>
    </div>

    <h3 style="margin:4px 0 10px;font-size:15px">自有技能</h3>
    <div class="toolbar">
      <div class="search">
        ${svg("search", 15)}
        <input class="input" id="skillSearch" placeholder="搜索技能名称、说明或分类" value="${esc(state.filters.skill)}" />
      </div>
      <span style="color:var(--muted);font-size:12.5px">${list.length} 个技能 · ${data.items.filter((s) => s.status === "published").length} 个已发布</span>
    </div>

    <div class="skill-grid" id="skillGrid">
      ${list
        .map(
          (s) => `<div class="skill-card" data-act="open-skill" data-id="${s.id}">
            <div class="top">
              <div class="emoji-box">${svg("sparkles", 15)}</div>
              <div style="flex:1;min-width:0">
                <h4>${esc(s.name)}</h4>
                <div class="ver" title="${esc(s.key)}">v${esc(s.version)}</div>
              </div>
              <div style="display:flex;gap:4px;align-items:center">
                ${s.hasPackage ? `<span class="pill purple no-dot" title="包含完整目录包 (SKILL.md + 附属文件)">📦 目录包</span>` : ""}
                ${statusPill(s.status)}
              </div>
            </div>
            <div class="desc">${esc(s.summary || s.content.replace(/^---\n[\s\S]*?---\n/, "").slice(0, 90))}</div>
            <div class="foot">
              <span class="tag">${esc(s.category || "通用")}</span>
              <span class="meta">${s.installs} 次引用</span>
            </div>
          </div>`
        )
        .join("") || `<div class="empty" style="grid-column:1/-1">${svg("search", 30)}<div>没有匹配的技能</div></div>`}
    </div>
  `;
  const mktS = ccfg.market?.skills || { enabled: true, disabled: [] };
  const skillOrigin = ccfg.market?.skillsetOrigin || "";
  $("#view").insertAdjacentHTML("beforeend", `
    <div class="card" style="margin-top:16px">
      <div class="card-head"><h3>公开技能</h3><button class="btn btn-sm btn-primary" id="govMktS">${svg("check", 14)} 保存</button></div>
      <div class="card-body">
        <label class="check" style="margin-bottom:10px"><input type="checkbox" id="govMktSOn" ${mktS.enabled !== false ? "checked" : ""} /><span>启用技能市场（客户端可见入口）</span></label>
        <div class="field" style="margin-bottom:10px">
          <label>技能源地址（换源时填自建市场，留空=官方 api.skillhub.cn）</label>
          <input class="input" id="govSkillOrigin" style="max-width:420px" value="${esc(skillOrigin)}" placeholder="https://api.skillhub.cn" />
        </div>
        <div class="hint" style="margin-bottom:8px">设置哪些技能开放给客户端选择。点「添加技能」从目录挑选加入公开清单。</div>
        <div id="govSkillAllowed" class="skill-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px;margin-bottom:10px"></div>
        <button class="btn btn-sm btn-primary" id="govSkillAdd">${svg("plus", 14)} 添加技能</button>
      </div>
    </div>`);
  let skillCatalog = null;
  const allowedSet = new Set(ccfg.market?.skills?.allowed || []);
  const metaOf = (slug) => (skillCatalog || []).find((it) => (it.slug || it.id) === slug) || null;
  const renderAllowed = () => {
    const box = $("#govSkillAllowed");
    box.innerHTML = [...allowedSet].map((s) => {
      const it = metaOf(s) || {};
      const loading = !skillCatalog && allowedSet.size;
      const name = it.displayName || it.name || s;
      const icon = it.iconUrl || it.icon_url || it.icon || "";
      return `<div class="skill-card" style="cursor:default">
        <div class="top">
          <div class="emoji-box" style="overflow:hidden">${icon ? `<img src="${esc(icon)}" style="width:100%;height:100%;border-radius:8px" alt="">` : svg("sparkles", 15)}</div>
          <div style="flex:1;min-width:0">
            <h4>${esc(name)}</h4>
            <div class="ver" title="${esc(s)}">${esc(s)}</div>
          </div>
          <button type="button" class="allow-x" data-slug="${esc(s)}" title="移除" style="border:none;background:none;cursor:pointer;color:#c00000;font-size:16px;line-height:1">×</button>
        </div>
        ${loading && !it.slug ? `<div class="desc muted">加载中…</div>` : (it.summary || it.description ? `<div class="desc">${esc(it.summary || it.description)}</div>` : "")}
      </div>`;
    }).join("");
    box.querySelectorAll(".allow-x").forEach((b) =>
      b.addEventListener("click", (e) => { e.preventDefault(); allowedSet.delete(b.dataset.slug); renderAllowed(); }));
  };
  const openSkillPickDrawer = () => {
    openDrawer({
      title: "添加官方技能",
      sub: "从当前技能源目录选择要开放的技能",
      wide: 920,
      body: `
        <div id="skillWrap" style="display:flex;flex-direction:column;height:100%;min-height:0">
        <div id="skillTabs" style="display:flex;gap:4px;background:#f1f3f5;border-radius:10px;padding:4px;margin-bottom:12px">
          ${[["recommended","为你推荐"],["trending","近期飙升"],["hot","下载热榜"],["newest","最近上新"]].map(([k,l]) =>
            `<button type="button" class="skill-tab" data-type="${k}" style="flex:1;padding:7px 0;border:none;border-radius:8px;font-size:13px;cursor:pointer;background:transparent;color:var(--text-secondary,#6b7280)">${l}</button>`).join("")}
        </div>
        <input class="input" id="skillQ" placeholder="搜索技能名 / slug / 描述…" style="margin-bottom:12px" />
        <div id="drawerSkillList" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;flex:1;min-height:0;overflow-y:auto;align-content:start">
          <div class="muted small">加载目录中…</div>
        </div>
        </div>`,
      onMount: async () => {
        const renderCards = (q = "") => {
          const box = $("#drawerSkillList");
          if (!skillCatalog) return;
          const ql = q.trim().toLowerCase();
          const items = skillCatalog.filter((it) => {
            const name = it.displayName || it.name || "";
            return !ql || name.toLowerCase().includes(ql)
              || (it.slug || "").toLowerCase().includes(ql)
              || (it.summary || it.description || "").toLowerCase().includes(ql);
          });
          box.innerHTML = items.length ? items.map((it) => {
            const slug = it.slug || it.id || "";
            const name = it.displayName || it.name || slug;
            const icon = it.iconUrl || it.icon_url || it.icon || "";
            const inAllow = allowedSet.has(slug);
            return `<div class="skill-card" style="padding:14px;min-width:0;overflow:hidden;border:1px solid ${inAllow ? "#fca5a5" : "#eef0f3"};border-radius:10px;background:#fff;display:flex;flex-direction:column;gap:6px">
              <div style="display:flex;align-items:center;gap:8px;min-width:0">
                ${icon ? `<img src="${esc(icon)}" style="width:30px;height:30px;border-radius:8px;flex-shrink:0" alt="">` : `<span style="width:30px;height:30px;border-radius:8px;background:#eef0f3;display:inline-flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0">${esc(name.slice(0, 1))}</span>`}
                <b style="font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1">${esc(name)}</b>
              </div>
              <div class="muted small" style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;line-height:1.5;min-height:36px">${esc(it.summary || it.description || "")}</div>
              <div style="display:flex;align-items:center;justify-content:space-between;margin-top:2px">
                <span class="muted" style="font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:60%">${esc(slug)}</span>
                <button type="button" class="btn btn-sm ${inAllow ? "" : "btn-primary"} skill-add" data-slug="${esc(slug)}" style="flex-shrink:0">${inAllow ? "已开放" : "＋ 开放"}</button>
              </div>
            </div>`;
          }).join("") : `<div class="muted small">无匹配技能。</div>`;
          box.querySelectorAll(".skill-add").forEach((b) =>
            b.addEventListener("click", () => {
              if (allowedSet.has(b.dataset.slug)) allowedSet.delete(b.dataset.slug);
              else allowedSet.add(b.dataset.slug);
              renderAllowed(); renderCards($("#skillQ").value);
            }));
        };
        const tabCache = {};
        let curType = "recommended";
        const setTab = (k) => {
          curType = k;
          $("#skillTabs").querySelectorAll(".skill-tab").forEach((b) => {
            const on = b.dataset.type === k;
            b.style.background = on ? "#fff" : "transparent";
            b.style.color = on ? "var(--text,#111)" : "var(--text-secondary,#6b7280)";
            b.style.boxShadow = on ? "0 1px 3px rgba(0,0,0,.08)" : "none";
            b.style.fontWeight = on ? "500" : "400";
          });
        };
        const loadType = async (k) => {
          setTab(k);
          if (tabCache[k]) { skillCatalog = tabCache[k]; renderCards($("#skillQ").value); return; }
          $("#drawerSkillList").innerHTML = `<div class="muted small">加载目录中…</div>`;
          try {
            const o = $("#govSkillOrigin").value.trim();
            const r = await api(`/api/skillhub/catalog?type=${k}${o ? "&origin=" + encodeURIComponent(o) : ""}`);
            const items = r.items || r.data || r.skillsets || r.skillSets || r.skills || (r.section ? r.skills : []) || [];
            skillCatalog = tabCache[k] = items;
            renderCards($("#skillQ").value); renderAllowed();
          } catch (e) {
            $("#drawerSkillList").innerHTML = `<div class="muted small">${esc(e.message || "目录加载失败")}</div>`;
          }
        };
        $("#skillTabs").querySelectorAll(".skill-tab").forEach((b) =>
          b.addEventListener("click", () => loadType(b.dataset.type)));
        $("#skillQ").addEventListener("input", (e) => renderCards(e.target.value));
        await loadType(curType);
      },
    });
  };
  renderAllowed();
  // allowed 非空但目录未载：后台拉全量目录补卡片 meta（图标/名称/描述）
  if (allowedSet.size && !skillCatalog) {
    const o = $("#govSkillOrigin")?.value?.trim() || "";
    Promise.all(["skillsets", "recommended", "hot", "trending", "newest"].map(async (k) => {
      try {
        const r = await api(`/api/skillhub/catalog?${k === "skillsets" ? "size=200" : "type=" + k}${o ? "&origin=" + encodeURIComponent(o) : ""}`);
        return r.items || r.data || r.skillsets || r.skillSets || r.skills || [];
      } catch { return []; }
    })).then((lists) => {
      const merged = {};
      lists.flat().forEach((it) => { const s = it.slug || it.id; if (s && !merged[s]) merged[s] = it; });
      skillCatalog = Object.values(merged);
      renderAllowed();
    });
  }
  $("#govSkillAdd").addEventListener("click", openSkillPickDrawer);
  $("#govMktS").addEventListener("click", () =>
    govPatch((c) => {
      return { ...c, market: {
        ...(c.market || {}),
        skills: { enabled: $("#govMktSOn").checked, disabled: [...(ccfg.market?.skills?.disabled || [])], allowed: [...allowedSet] },
        skillsetOrigin: $("#govSkillOrigin").value.trim() || undefined,
      } };
    }));

  const search = $("#skillSearch");
  let timer;
  search.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.filters.skill = search.value;
      renderSkills().then(() => {
        hydrateIcons($("#view"));
        const el = $("#skillSearch");
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      });
    }, 200);
  });
  bind("#view", "[data-act='new-skill']", "click", () => openSkillDrawer(null));
  bind("#view", "[data-act='import-skill']", "click", () =>
    pickFile(".md,.markdown,.txt,.json", async (file) => {
      const r = await importFile("/api/skills/import", file);
      const bits = [`已导入：${r.skill.name}`];
      if (r.keyRemapped) bits.push(`标识改为 ${r.skill.key}`);
      toast(bits.join(" · "));
      await loadAll();
      await renderSkills();
      hydrateIcons($("#view"));
    })
  );
  bind("#view", "[data-act='open-skill']", "click", (e) => openSkillDrawer(state.skills.find((x) => x.id === e.currentTarget.dataset.id)));
}

function openSkillDrawer(skill) {
  const isNew = !skill;
  const s = skill || { id: "", key: "", name: "", summary: "", category: "通用", version: "1.0.0", trigger: "", content: "", status: "draft" };
  openDrawer({
    title: isNew ? "上传技能" : `编辑技能 · ${s.name}`,
    sub: isNew ? "粘贴或上传一份 SKILL.md" : `标识 ${s.key} · v${s.version} · ${s.installs} 次引用`,
    wide: true,
    body: `
      <div class="form-row">
        <div class="field"><label>技能名称</label><input class="input" id="f-name" value="${esc(s.name)}" placeholder="如：合同风险审查清单" /></div>
        <div class="field"><label>标识 key</label><input class="input" id="f-key" value="${esc(s.key)}" placeholder="自动生成" ${isNew ? "" : "disabled"} /></div>
      </div>
      <div class="form-row">
        <div class="field"><label>分类</label>
          <select class="select" id="f-category">
            ${["法务合规", "业务处置", "公文写作", "数据分析", "通用"].map((c) => `<option ${s.category === c ? "selected" : ""}>${c}</option>`).join("")}
          </select>
        </div>
        <div class="field"><label>版本</label><input class="input" id="f-version" value="${esc(s.version)}" /></div>
      </div>
      <div class="field"><label>一句话说明</label><input class="input" id="f-summary" value="${esc(s.summary)}" placeholder="在商城里显示" /></div>
      <div class="field"><label>触发时机</label><input class="input" id="f-trigger" value="${esc(s.trigger)}" placeholder="如：审查合同、比对条款差异时" /></div>
      <div class="field">
        <label style="display:flex;align-items:center;gap:10px">
          <span>SKILL.md 内容</span>
          <button class="btn btn-sm" id="uploadBtn" type="button" style="margin-left:auto"><span data-icon="upload"></span>选择 .md 文件</button>
          <input type="file" id="fileInput" accept=".md,.markdown,.txt" hidden />
        </label>
        <textarea class="textarea code" id="f-content" rows="16" placeholder="# 技能名称&#10;&#10;## 何时使用&#10;...">${esc(s.content)}</textarea>
        <div class="hint" id="charCount">${s.content.length} 字符</div>
      </div>
      <div class="field"><label>状态</label>
        <select class="select" id="f-status">
          <option value="published" ${s.status === "published" ? "selected" : ""}>已发布（客户端可见）</option>
          <option value="draft" ${s.status === "draft" ? "selected" : ""}>草稿</option>
          <option value="offline" ${s.status === "offline" ? "selected" : ""}>已下线</option>
        </select>
      </div>
    `,
    foot: `
      ${isNew ? "" : '<button class="btn btn-danger" id="delSkill"><span data-icon="trash"></span>删除</button><button class="btn" id="exportSkill"><span data-icon="download"></span>导出 SKILL.md</button><button class="btn" id="pkgUpload" title="上传整个技能目录 zip（含 SKILL.md + scripts/references 等附属文件）"><span data-icon="upload"></span>目录包</button>'}
      <div class="spacer"></div>
      <button class="btn" data-drawer-cancel>取消</button>
      <button class="btn btn-primary" id="saveSkill">${isNew ? "创建技能" : "保存修改"}</button>
    `,
    onMount: (root) => {
      const ta = root.querySelector("#f-content");
      const cnt = root.querySelector("#charCount");
      ta.addEventListener("input", () => (cnt.textContent = `${ta.value.length} 字符`));
      const fileInput = root.querySelector("#fileInput");
      root.querySelector("#uploadBtn").onclick = () => fileInput.click();
      fileInput.onchange = () => {
        const f = fileInput.files[0];
        if (!f) return;
        const reader = new FileReader();
        reader.onload = () => {
          ta.value = String(reader.result || "");
          cnt.textContent = `${ta.value.length} 字符`;
          const nameEl = root.querySelector("#f-name");
          if (!nameEl.value) {
            const base = f.name.replace(/\.(md|markdown|txt)$/i, "");
            nameEl.value = base;
          }
          const h1 = ta.value.match(/^#\s+(.+)$/m);
          if (h1 && root.querySelector("#f-summary").value === "") {
            const first = ta.value.split("\n").find((l) => l.trim() && !l.startsWith("#"));
            root.querySelector("#f-summary").value = (first || "").slice(0, 60);
          }
          toast("已读取文件");
        };
      const pkgBtn = root.querySelector("#pkgUpload");
      if (pkgBtn) {
        pkgBtn.onclick = () => {
          const input = document.createElement("input");
          input.type = "file";
          input.accept = ".zip,application/zip";
          input.onchange = async () => {
            const f = input.files && input.files[0];
            if (!f) return;
            try {
              const buf = await f.arrayBuffer();
              const res = await fetch(`/api/skills/${e.id}/package`, {
                method: "POST",
                headers: { "content-type": "application/zip", authorization: `Bearer ${token}` },
                body: buf,
              });
              const data = await res.json();
              if (!res.ok) throw new Error(data.message || `上传失败 (${res.status})`);
              toast(`目录包已上传：${data.file}（${(data.size / 1024).toFixed(1)} KB）`);
            } catch (err) {
              toast(err.message, "err");
            }
          };
          input.click();
        };
      }
        reader.readAsText(f);
      };
      root.querySelector("#saveSkill").onclick = async () => {
        const name = root.querySelector("#f-name").value.trim();
        const content = ta.value.trim();
        if (!name || !content) return toast("技能名称与内容必填", "err");
        const payload = {
          name,
          key: root.querySelector("#f-key").value.trim(),
          summary: root.querySelector("#f-summary").value.trim(),
          category: root.querySelector("#f-category").value,
          version: root.querySelector("#f-version").value.trim() || "1.0.0",
          trigger: root.querySelector("#f-trigger").value.trim(),
          content,
          status: root.querySelector("#f-status").value,
        };
        try {
          if (isNew) await api("/api/skills", { method: "POST", body: payload });
          else await api(`/api/skills/${s.id}`, { method: "PATCH", body: payload });
          toast(isNew ? "技能已创建" : "已保存");
          closeDrawer();
          await loadAll();
          await renderSkills();
          hydrateIcons($("#view"));
        } catch (err) {
          toast(err.message, "err");
        }
      };
      const del = root.querySelector("#delSkill");
      if (del)
        del.onclick = async () => {
          if (!(await confirmDialog({ title: `删除技能「${s.name}」？`, desc: "引用该技能的专家将失去这项能力。", okText: "删除", danger: true }))) return;
          await api(`/api/skills/${s.id}`, { method: "DELETE" });
          toast("已删除");
          closeDrawer();
          await loadAll();
          await renderSkills();
          hydrateIcons($("#view"));
        };
      const exp = root.querySelector("#exportSkill");
      if (exp)
        exp.onclick = async () => {
          try {
            await downloadFile(`/api/skills/${s.id}/export`, `${s.key}.md`);
            toast("已导出 SKILL.md");
          } catch (err) {
            toast(err.message, "err");
          }
        };
    },
  });
}

/* ------------------------------ 模型与供应商 ------------------------------ */
async function renderUsers() {
  if (!hasPerm("users") && !hasPerm("roles")) {
    $("#view").innerHTML = `<div class="card"><div class="card-body"><div class="notice warn">${svg("alert", 16)}<span>没有用户与权限模块的访问权限。</span></div></div></div>`;
    return;
  }
  if (state.usersTab === "roles") return renderRoles();
  if (!hasPerm("users")) {
    state.usersTab = "roles";
    return renderRoles();
  }
  const data = await api("/api/users");
  state.users = data.items;
  try {
    state.roles = (await api("/api/roles")).items;
    state.permCatalog = (await api("/api/permissions")).items;
    state.settings = (await api("/api/settings")).settings || {};
  } catch {
    state.roles = state.roles || [];
  }
  $("#view").innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">用户与权限</h1>
        <p class="page-desc">管理员登录管理后台（角色定权限）；普通用户是智能体终端使用者，经 SSO/代理登录，不开放后台访问。</p>
      </div>
      <div class="page-actions"><button class="btn btn-primary" data-act="new-user"><span data-icon="plus"></span>新增账号</button></div>
    </div>

    ${hasPerm("roles") ? `<div class="seg" style="margin-bottom:14px">
      <button class="${state.usersTab === "users" ? "active" : ""}" data-act="tab-users">用户管理</button>
      <button class="${state.usersTab === "roles" ? "active" : ""}" data-act="tab-roles">角色管理</button>
    </div>` : ""}

    <div class="card" style="margin-bottom:14px"><div class="card-body tight">
      <h3 style="margin:0 0 4px;font-size:14px">默认注册角色</h3>
      <div class="muted small" style="margin-bottom:10px">单体模式下本地注册/建档的普通用户，自动绑定此处选定的<b>智能体角色</b>（harness 域权限包，非用户账号）。</div>
      <div style="display:flex;gap:8px;align-items:center">
        <select class="select" id="defaultRegRole" style="max-width:320px">
          <option value="">不绑定角色</option>
          ${(state.roles || [])
            .filter((r) => r.domain === "harness")
            .map((r) => `<option value="${r.id}" ${state.settings?.default_register_role === r.id ? "selected" : ""}>${esc(r.name)}${r.nameEn ? " / " + esc(r.nameEn) : ""} · 智能体角色</option>`)
            .join("")}
        </select>
        <button class="btn btn-sm btn-primary" id="setRegRole">设置</button>
      </div>
    </div></div>

    <div class="card"><div class="card-body tight table-wrap">
      <table class="tbl">
        <thead><tr><th style="width:24%">用户</th><th>部门</th><th>类型</th><th>角色</th><th>状态</th><th>最近登录</th><th></th></tr></thead>
        <tbody>
          ${data.items
            .map(
              (u) => `<tr>
                <td><div class="cell-main">
                  <div class="avatar avatar-lg">${esc((u.displayName || u.username).slice(-2))}</div>
                  <div><div class="cell-title">${esc(u.displayName)}</div><div class="cell-sub mono">${esc(u.username)}${u.email ? " · " + esc(u.email) : ""}</div></div>
                </div></td>
                <td style="font-size:12.5px;color:var(--text-2)">${esc(u.department || "—")}</td>
                <td><span class="pill ${u.kind === "user" ? "blue" : "red"} no-dot">${u.kind === "user" ? "普通用户" : "管理员"}</span></td>
                <td>${u.kind === "user" ? `<span class="pill gray no-dot">—</span>` : `<span class="pill ${u.role === "admin" ? "red" : u.role === "publisher" ? "blue" : "gray"} no-dot">${esc(roleLabel(u.role))}</span>`}</td>
                <td>${statusPill(u.status)}</td>
                <td style="font-size:12px;color:var(--muted)">${relTime(u.lastLoginAt)}</td>
                <td class="actions"><span class="row-actions">
                  <button class="btn btn-sm btn-ghost" data-act="edit-user" data-id="${u.id}" title="编辑"><span data-icon="edit"></span></button>
                  <button class="btn btn-sm btn-ghost" data-act="reset-user" data-id="${u.id}" title="重置密码"><span data-icon="key"></span></button>
                  <button class="btn btn-sm btn-ghost" data-act="del-user" data-id="${u.id}" title="删除"><span data-icon="trash"></span></button>
                </span></td>
              </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div></div>
  `;
  bind("#view", "[data-act='tab-roles']", "click", () => { state.usersTab = "roles"; renderUsers(); });
  bind("#view", "[data-act='new-user']", "click", () => openUserDrawer(null));
  $("#setRegRole")?.addEventListener("click", async () => {
    try {
      await api("/api/settings", { method: "PATCH", body: { default_register_role: $("#defaultRegRole").value } });
      toast("默认注册角色已更新");
    } catch (err) {
      toast(err.message, "warn");
    }
  });
  bind("#view", "[data-act='edit-user']", "click", (e) => openUserDrawer(state.users.find((x) => x.id === e.currentTarget.dataset.id)));
  bind("#view", "[data-act='reset-user']", "click", async (e) => {
    const item = state.users.find((x) => x.id === e.currentTarget.dataset.id);
    if (!(await confirmDialog({
      title: `重置「${item.displayName}」的密码？`,
      desc: "将生成一次性临时密码，该用户的全部已登录会话立即失效。",
      okText: "重置",
    }))) return;
    try {
      const d = await api(`/api/users/${item.id}/reset-password`, { method: "POST" });
      const w = window.open("", "_blank", "width=420,height=220");
      if (w) {
        w.document.write(`<pre style="font:13px/1.6 monospace;padding:20px">账号 ${item.username} 的临时密码（只显示这一次，请立即转交）：\n\n${d.password}</pre>`);
      } else {
        prompt(`账号 ${item.username} 的临时密码（只显示这一次）：`, d.password);
      }
    } catch (err) {
      toast(err.message, "err");
    }
  });
  bind("#view", "[data-act='del-user']", "click", async (e) => {
    const item = state.users.find((x) => x.id === e.currentTarget.dataset.id);
    if (!(await confirmDialog({ title: `删除账号「${item.displayName}」？`, desc: "该账号的所有登录会话立即失效。建议优先改为「停用」而不是删除。", okText: "删除", danger: true }))) return;
    try {
      await api(`/api/users/${item.id}`, { method: "DELETE" });
      toast("已删除");
      await renderUsers();
      hydrateIcons($("#view"));
    } catch (err) {
      toast(err.message, "err");
    }
  });
  hydrateIcons($("#view"));
}

async function renderRoles() {
  const [rolesData, permsData, harnessData] = await Promise.all([
    api("/api/roles"),
    api("/api/permissions"),
    api("/api/harness-permissions").catch(() => ({ items: [] })),
  ]);
  state.roles = rolesData.items;
  state.permCatalog = permsData.items;
  state.harnessPerms = harnessData.items;
  const canEdit = hasPerm("roles");
  $("#view").innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">用户与权限</h1>
        <p class="page-desc">角色 = 一组权限键，用户绑角色生效。内置角色不可删除，管理员恒为全量权限。</p>
      </div>
      ${canEdit ? `<div class="page-actions"><button class="btn" data-act="sync-harness"><span data-icon="refresh"></span>同步智能体权限目录</button><button class="btn btn-primary" data-act="new-role"><span data-icon="plus"></span>新增角色</button></div>` : ""}
    </div>

    <div class="seg" style="margin-bottom:14px">
      <button class="${state.usersTab === "users" ? "active" : ""}" data-act="tab-users">用户管理</button>
      <button class="${state.usersTab === "roles" ? "active" : ""}" data-act="tab-roles">角色管理</button>
    </div>

    <div class="card"><div class="card-body tight table-wrap">
      <table class="tbl">
        <thead><tr><th style="width:26%">角色</th><th>域</th><th>描述</th><th>权限数</th><th>用户</th><th></th></tr></thead>
        <tbody>
          ${rolesData.items
            .map(
              (r) => `<tr>
                <td><div class="cell-title">${esc(r.name)}${r.builtin ? ` <span class="pill gray no-dot">内置</span>` : ""}<div class="cell-sub mono">${esc(r.id)}</div></td>
                <td><span class="pill ${(r.domain || "console") === "harness" ? "blue" : "gray"} no-dot">${(r.domain || "console") === "harness" ? "智能体" : "控制台"}</span></td>
                <td style="font-size:12.5px;color:var(--text-2)">${esc(r.description || "—")}</td>
                <td><span class="pill blue no-dot">${r.id === "admin" ? "全部" : r.permissions.length}</span></td>
                <td style="font-size:12.5px;color:var(--text-2)">${r.userCount} 人</td>
                <td class="actions"><span class="row-actions">
                  ${canEdit && r.id !== "admin" ? `<button class="btn btn-sm btn-ghost" data-act="edit-role" data-id="${r.id}" title="编辑"><span data-icon="edit"></span></button>` : ""}
                  ${canEdit && !r.builtin ? `<button class="btn btn-sm btn-ghost" data-act="del-role" data-id="${r.id}" title="删除"><span data-icon="trash"></span></button>` : ""}
                </span></td>
              </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div></div>
  `;
  bind("#view", "[data-act='tab-users']", "click", () => { state.usersTab = "users"; renderUsers(); });
  if (!canEdit) return;
  bind("#view", "[data-act='sync-harness']", "click", async () => {
    try {
      const d = await api("/api/harness-permissions/sync", { method: "POST" });
      toast(`已同步 ${d.count} 个智能体权限键`);
      await renderRoles();
      hydrateIcons($("#view"));
    } catch (err) {
      toast(err.message, "err");
    }
  });
  bind("#view", "[data-act='new-role']", "click", () => openRoleDrawer(null));
  bind("#view", "[data-act='edit-role']", "click", (e) => openRoleDrawer(state.roles.find((x) => x.id === e.currentTarget.dataset.id)));
  bind("#view", "[data-act='del-role']", "click", async (e) => {
    const item = state.roles.find((x) => x.id === e.currentTarget.dataset.id);
    if (!(await confirmDialog({ title: `删除角色「${item.name}」？`, desc: "仅当没有用户绑定该角色时才能删除。", okText: "删除", danger: true }))) return;
    try {
      await api(`/api/roles/${item.id}`, { method: "DELETE" });
      toast("已删除");
      await renderRoles();
      hydrateIcons($("#view"));
    } catch (err) {
      toast(err.message, "err");
    }
  });
  hydrateIcons($("#view"));
}

const PERM_GROUP_LABEL = { nav: "基础", content: "内容供给", governance: "治理", system: "系统" };

function openRoleDrawer(role) {
  const isNew = !role;
  const r = role || { id: "", name: "", nameEn: "", description: "", domain: "console", permissions: [], builtin: false };
  const held = new Set(r.permissions || []);
  // 智能体权限组名英→中（目录里部分 category 是英文键）
  const HARNESS_GROUP_LABEL = { nav: "导航", settings: "设置", control: "控制", admin: "系统管理" };
  // 渲染分组权限树：组头复选（全选/半选）+ 组名 + n/m 计数 + chip 项，
  // 与 octop 角色编辑器同款交互。
  const renderPermTree = (groups, domain) => Object.entries(groups)
    .map(([cat, perms]) => {
      const gname = domain === "harness" ? (HARNESS_GROUP_LABEL[cat] || cat) : (PERM_GROUP_LABEL[cat] || cat);
      const chips = perms
        .map((p) => {
          const lbl = domain === "harness" ? (p.labelZh || p.label || p.key) : p.labelZh;
          return `<label class="perm-chip${held.has(p.key) ? " checked" : ""}">
            <input type="checkbox" class="f-perm" data-domain="${domain}" data-group="${esc(cat)}" value="${p.key}"
              ${held.has(p.key) ? "checked" : ""} ${locked ? "disabled" : ""} /><span>${esc(lbl)}</span>
          </label>`;
        })
        .join("");
      return `<div class="field perm-group" data-group="${esc(cat)}">
        <div class="perm-group-head">
          <input type="checkbox" class="perm-group-all" data-group="${esc(cat)}" ${locked ? "disabled" : ""} />
          <span class="perm-group-name">${esc(gname)}</span>
          <span class="perm-group-count" data-count-for="${esc(cat)}"></span>
        </div>
        <div class="perm-chip-grid">${chips}</div>
      </div>`;
    })
    .join("");

  const groups = {};
  (state.permCatalog || []).forEach((p) => (groups[p.category] = groups[p.category] || []).push(p));
  const hGroups = {};
  (state.harnessPerms || []).forEach((p) => {
    const g = p.pageLabel || p.page || p.category || "其他";
    (hGroups[g] = hGroups[g] || []).push(p);
  });
  const locked = r.id === "admin";
  openDrawer({
    title: isNew ? "新增角色" : `编辑角色 · ${r.name}`,
    sub: locked ? "内置管理员恒为全量权限，仅展示" : "勾选该角色可访问的管理模块",
    body: `
      <div class="field"><label>权限域</label>
        <select class="select" id="f-rdomain" ${locked || !isNew ? "disabled" : ""}>
          <option value="console" ${(r.domain || "console") === "console" ? "selected" : ""}>控制台（后台模块权限）</option>
          <option value="harness" ${r.domain === "harness" ? "selected" : ""}>智能体（实例侧功能权限）</option>
        </select>
      </div>
      <div class="form-row">
        <div class="field"><label>角色名称</label><input class="input" id="f-rname" value="${esc(r.name)}" ${locked ? "disabled" : ""} /></div>
        <div class="field"><label>英文名称</label><input class="input" id="f-rnameEn" value="${esc(r.nameEn || "")}" ${locked ? "disabled" : ""} /></div>
      </div>
      <div class="field"><label>描述</label><input class="input" id="f-rdesc" value="${esc(r.description || "")}" ${locked ? "disabled" : ""} /></div>
      <div id="permConsole" ${r.domain === "harness" ? 'style="display:none"' : ""}>
      ${renderPermTree(groups, "console")}
      </div>
      <div id="permHarness" ${r.domain === "harness" ? "" : 'style="display:none"'}>
      ${Object.keys(hGroups).length ? renderPermTree(hGroups, "harness") : `<div class="notice warn">${svg("alert", 16)}<span>智能体权限目录未同步——先点页面上方「同步智能体权限目录」。</span></div>`}
      </div>
    `,
    foot: locked
      ? `<button class="btn" data-drawer-cancel>关闭</button>`
      : `<button class="btn" data-drawer-cancel>取消</button><div class="spacer"></div><button class="btn btn-primary" id="saveRole">${isNew ? "创建角色" : "保存修改"}</button>`,
    onMount: (root) => {
      const btn = root.querySelector("#saveRole");
      if (!btn) return;
      const domainSel = root.querySelector("#f-rdomain");
      const syncDomain = () => {
        const isH = domainSel.value === "harness";
        root.querySelector("#permConsole").style.display = isH ? "none" : "";
        root.querySelector("#permHarness").style.display = isH ? "" : "none";
      };
      domainSel.onchange = syncDomain;

      // 分组全选/半选 + n/m 计数（octop 角色编辑器同款）
      const refreshGroup = (g) => {
        const boxes = [...root.querySelectorAll(`.f-perm[data-group="${g}"]`)];
        const on = boxes.filter((b) => b.checked);
        const all = root.querySelector(`.perm-group-all[data-group="${g}"]`);
        const cnt = root.querySelector(`[data-count-for="${g}"]`);
        if (all) { all.checked = boxes.length > 0 && on.length === boxes.length; all.indeterminate = on.length > 0 && on.length < boxes.length; }
        if (cnt) cnt.textContent = `${on.length}/${boxes.length}`;
        boxes.forEach((b) => b.closest(".perm-chip")?.classList.toggle("checked", b.checked));
      };
      root.querySelectorAll(".perm-group-all").forEach((all) => {
        all.onchange = () => {
          const g = all.dataset.group;
          root.querySelectorAll(`.f-perm[data-group="${g}"]`).forEach((b) => { if (!b.disabled) b.checked = all.checked; });
          refreshGroup(g);
        };
      });
      root.querySelectorAll(".f-perm").forEach((b) => {
        b.onchange = () => refreshGroup(b.dataset.group);
      });
      new Set([...root.querySelectorAll(".f-perm")].map((b) => b.dataset.group)).forEach(refreshGroup);

      btn.onclick = async () => {
        const name = root.querySelector("#f-rname").value.trim();
        if (!name) return toast("角色名称必填", "err");
        const domain = domainSel.value;
        const permissions = [...root.querySelectorAll(`.f-perm:checked[data-domain='${domain}']`)].map((x) => x.value);
        const payload = {
          name,
          domain,
          nameEn: root.querySelector("#f-rnameEn").value.trim(),
          description: root.querySelector("#f-rdesc").value.trim(),
          permissions,
        };
        try {
          if (isNew) await api("/api/roles", { method: "POST", body: payload });
          else await api(`/api/roles/${r.id}`, { method: "PATCH", body: payload });
          toast(isNew ? "角色已创建" : "已保存");
          closeDrawer();
          await renderRoles();
          hydrateIcons($("#view"));
        } catch (err) {
          toast(err.message, "err");
        }
      };
    },
  });
}

function openUserDrawer(user) {
  const isNew = !user;
  const u = user || { id: "", username: "", displayName: "", email: "", department: "", role: "member", kind: "console", status: "active", extraPerms: [] };

  openDrawer({
    title: isNew ? "新增账号" : `编辑账号 · ${u.displayName}`,
    sub: isNew ? "创建后把账号密码交给本人，首次登录请改密码" : `用户名 ${u.username} 不可修改`,
    body: `
      <div class="form-row">
        <div class="field"><label>姓名</label><input class="input" id="f-displayName" value="${esc(u.displayName)}" /></div>
        <div class="field"><label>用户名</label><input class="input" id="f-username" value="${esc(u.username)}" ${isNew ? "" : "disabled"} /></div>
      </div>
      <div class="field"><label>邮箱</label><input class="input" id="f-email" value="${esc(u.email)}" placeholder="name@hx.local" /></div>
      <div class="form-row">
        <div class="field"><label>部门</label>
          <input class="input" id="f-department" value="${esc(u.department)}" list="deptList" placeholder="如：法务部" />
          <datalist id="deptList">
            ${[...new Set(state.users.map((x) => x.department).filter(Boolean))].map((d) => `<option>${esc(d)}</option>`).join("")}
          </datalist>
        </div>
        <div class="field"><label>类型</label>
          <select class="select" id="f-kind">
            <option value="admin" ${u.kind !== "user" ? "selected" : ""}>管理员</option>
            <option value="user" ${u.kind === "user" ? "selected" : ""}>普通用户</option>
          </select>
        </div>
      </div>
      <div id="consoleOnly">
      <div class="form-row">
        <div class="field"><label>角色</label>
          <select class="select" id="f-role">
            ${(() => {
              const domain = u.kind === "user" ? "harness" : "console";
              const list = (state.roles.length ? state.roles : [
                { id: "member", name: "成员", description: "只能使用", domain: "console" },
                { id: "publisher", name: "发布者", description: "管专家/插件/技能", domain: "console" },
                { id: "admin", name: "管理员", description: "全部权限", domain: "console" },
              ]).filter((r) => (r.domain || "console") === domain);
              return list.map((r) => `<option value="${esc(r.id)}" data-domain="${esc(r.domain || "console")}" ${u.role === r.id ? "selected" : ""}>${esc(r.name)}${r.description ? " · " + esc(r.description) : ""}</option>`).join("");
            })()}
            ${u.role && !(state.roles.length ? state.roles : []).find((r) => r.id === u.role) ? `<option value="${esc(u.role)}" selected>${esc(u.role)}（角色已删除）</option>` : ""}
          </select>
        </div>
      </div>
      <div class="form-row">
        ${isNew ? `<div class="field"><label>初始密码</label>
          <input class="input" id="f-password" type="password" placeholder="至少 8 位" />
        </div>` : ""}
        <div class="field"><label>状态</label>
          <select class="select" id="f-status">
            <option value="active" ${u.status === "active" ? "selected" : ""}>正常</option>
            <option value="disabled" ${u.status === "disabled" ? "selected" : ""}>停用</option>
          </select>
        </div>
      </div>
      </div>
      <div id="publisherHint" style="display:none"><div class="notice info" style="margin-top:6px">${svg("info", 16)}<span>普通用户是智能体终端使用者：在实例上使用（登录走 SSO），角色取 harness 域权限。</span></div></div>
    `,
    foot: `<button class="btn" data-drawer-cancel>取消</button><div class="spacer"></div><button class="btn btn-primary" id="saveUser">${isNew ? "创建账号" : "保存修改"}</button>`,
    onMount: (root) => {
      const kindSel = root.querySelector("#f-kind");
      const roleSel = root.querySelector("#f-role");
      const syncKind = () => {
        const domain = kindSel.value === "user" ? "harness" : "console";
        root.querySelector("#publisherHint").style.display =
          kindSel.value === "user" ? "" : "none";
        // 按域过滤角色选项（admin→console，user→harness）
        [...roleSel.options].forEach((o) => {
          o.style.display = (o.dataset.domain || "console") === domain ? "" : "none";
        });
        const vis = [...roleSel.options].find((o) => o.style.display !== "none");
        if (vis) roleSel.value = vis.value;
      };
      kindSel.onchange = syncKind;
      syncKind();
      root.querySelector("#saveUser").onclick = async () => {
        const displayName = root.querySelector("#f-displayName").value.trim();
        const username = root.querySelector("#f-username").value.trim();
        const password = root.querySelector("#f-password")?.value || "";
        if (!displayName) return toast("姓名必填", "err");
        if (isNew && (!username || !password)) return toast("用户名与初始密码必填", "err");
        if (isNew && password.length < 8) return toast("密码至少 8 位", "err");
        const payload = {
          displayName,
          username,
          email: root.querySelector("#f-email").value.trim(),
          department: root.querySelector("#f-department").value.trim(),
          role: root.querySelector("#f-role").value,
          kind: root.querySelector("#f-kind").value,
          status: root.querySelector("#f-status").value,
        };
        if (password) payload.password = password;
        try {
          if (isNew) await api("/api/users", { method: "POST", body: payload });
          else await api(`/api/users/${u.id}`, { method: "PATCH", body: payload });
          toast(isNew ? "账号已创建" : "已保存");
          closeDrawer();
          await renderUsers();
          hydrateIcons($("#view"));
          const users = await api("/api/users");
          state.users = users.items;
        } catch (err) {
          toast(err.message, "err");
        }
      };
    },
  });
}

function formatAuditDetail(d) {
  if (!d || typeof d !== "object" || Object.keys(d).length === 0) {
    return `<span style="color:var(--muted)">—</span>`;
  }
  const pairs = Object.entries(d).map(([k, v]) => {
    const valStr = typeof v === "object" ? JSON.stringify(v) : String(v);
    return `<span class="tag mono" style="font-size:11px;background:var(--surface-2)">${esc(k)}: <b style="color:var(--text)">${esc(valStr)}</b></span>`;
  });
  return `<div style="display:flex;flex-wrap:wrap;gap:4px;max-width:320px">${pairs.join("")}</div>`;
}

/* ------------------------------ 审计日志 ------------------------------ */
async function renderAudit() {
  const data = await api(`/api/audit?limit=60&page=1`);
  const ACTION_TONE = (a) =>
    a.startsWith("删除") ? "red" : a.startsWith("发布") || a.startsWith("启用") ? "green" : a.startsWith("新增") ? "blue" : "gray";

  $("#view").innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">审计日志</h1>
        <p class="page-desc">谁在什么时候改了什么，全部落库。客户端侧的插件调用记录另行回传（二期）。</p>
      </div>
    </div>
    <div class="card"><div class="card-body tight table-wrap">
      <table class="tbl">
        <thead><tr><th style="width:130px">时间</th><th style="width:110px">操作人</th><th style="width:130px">动作</th><th>对象</th><th>来源 IP</th><th>详情</th></tr></thead>
        <tbody>
          ${data.items
            .map(
              (r) => `<tr>
                <td style="font-size:12.5px;color:var(--muted);white-space:nowrap">${relTime(r.createdAt)}</td>
                <td style="font-size:13px">${esc(r.actor)}</td>
                <td><span class="pill ${ACTION_TONE(r.action)} no-dot">${esc(r.action)}</span></td>
                <td><div class="cell-title" style="font-weight:400;font-size:13px">${esc(r.target || "—")}</div><div class="cell-sub">${esc(r.targetType || "")}</div></td>
                <td class="mono">${esc(r.ip || "—")}</td>
                <td>${formatAuditDetail(r.detail)}</td>
              </tr>`
            )
            .join("") || '<tr><td colspan="6"><div class="empty">暂无日志</div></td></tr>'}
        </tbody>
      </table>
    </div></div>
    <div style="text-align:center;color:var(--muted);font-size:12.5px;margin-top:14px">共 ${data.total} 条记录，显示最近 ${data.items.length} 条</div>
  `;
}

/* ------------------------------ 下发配置 ------------------------------ */
/* ------------------------------ 抽屉 ------------------------------ */
let drawerCleanup = null;

function openDrawer({ title, sub, body, foot, onMount, wide = false }) {
  const drawer = $("#drawer");
  $("#drawerTitle").textContent = title;
  $("#drawerSub").textContent = sub || "";
  $("#drawerBody").innerHTML = body;
  $("#drawerFoot").innerHTML = foot || "";
  drawer.style.width = typeof wide === "number" ? `${wide}px` : (wide ? "760px" : "620px");
  drawer.classList.add("open");
  $("#scrim").classList.add("open");
  hydrateIcons(drawer);
  drawerCleanup = onMount || null;
  if (drawerCleanup) drawerCleanup(drawer);
  drawer.querySelectorAll("[data-drawer-cancel]").forEach((b) => (b.onclick = closeDrawer));
}
function closeDrawer() {
  $("#drawer").classList.remove("open");
  $("#scrim").classList.remove("open");
  setTimeout(() => {
    if (!$("#drawer").classList.contains("open")) $("#drawerBody").innerHTML = "";
  }, 240);
}
$("#drawerClose").onclick = closeDrawer;
$("#scrim").onclick = closeDrawer;
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeDrawer();
});

/* ------------------------------ 事件绑定辅助 ------------------------------ */
function bind(rootSel, sel, event, handler) {
  document.querySelectorAll(`${rootSel} ${sel}`).forEach((el) => el.addEventListener(event, handler));
}

/* ------------------------------ 桌面客户端授权 ------------------------------ */
const isDesktopAuth = new URLSearchParams(location.search).get("desktopAuth") === "1";

async function startHandoff() {
  $("#login").hidden = true;
  $("#app").hidden = true;
  $("#handoff").hidden = false;
  hydrateIcons(document);

  if (token) {
    try {
      const me = await api("/api/auth/me");
    state.perms = new Set(me.permissions || []);
      state.user = me.user;
      state.perms = new Set(me.permissions || []);
      return renderHandoffGrant();
    } catch {
      token = "";
      localStorage.removeItem(TOKEN_KEY);
    }
  }
  renderHandoffLogin();
}

function renderHandoffLogin(error) {
  const body = $("#handoffBody");
  body.innerHTML = `
    <h3>登录后授权这台电脑</h3>
    <p class="lead">桌面客户端需要一次性登录码完成登入。请先用组织账号验证身份，验证后生成登录码，5 分钟内有效。</p>
    ${error ? `<div class="login-error" style="margin-bottom:14px">${esc(error)}</div>` : ""}
    <form id="handoffForm">
      <div class="field"><label>账号</label><input class="input" id="hUser" placeholder="用户名或邮箱" autocomplete="username" required /></div>
      <div class="field"><label>密码</label><input class="input" id="hPass" type="password" placeholder="请输入密码" autocomplete="current-password" required /></div>
      <button class="btn btn-primary btn-block" type="submit" id="hBtn">验证并生成登录码</button>
    </form>
  `;
  $("#handoffFoot").innerHTML = `<span style="font-size:12px;color:var(--muted)">控制面 ${esc(location.origin)}</span>`;
  $("#handoffForm").onsubmit = async (e) => {
    e.preventDefault();
    const btn = $("#hBtn");
    btn.disabled = true;
    btn.textContent = "验证中…";
    try {
      const data = await api("/api/auth/login", {
        method: "POST",
        body: { username: $("#hUser").value.trim(), password: $("#hPass").value },
      });
      token = data.token;
      localStorage.setItem(TOKEN_KEY, token);
      state.user = data.user;
      await renderHandoffGrant();
    } catch (err) {
      renderHandoffLogin(err.message);
    }
  };
  $("#hUser")?.focus();
}

async function renderHandoffGrant() {
  const body = $("#handoffBody");
  body.innerHTML = `<h3>正在生成登录码…</h3>`;
  let data;
  try {
    data = await api("/api/desktop/handoff", { method: "POST" });
  } catch (err) {
    body.innerHTML = `<h3>生成失败</h3><p class="lead">${esc(err.message)}</p>
      <button class="btn" onclick="location.reload()">重试</button>`;
    return;
  }
  const expires = new Date(data.expiresAt);
  const hhmm = `${String(expires.getHours()).padStart(2, "0")}:${String(expires.getMinutes()).padStart(2, "0")}`;
  body.innerHTML = `
    <h3>登录码已生成</h3>
    <p class="lead">把这串码粘贴到桌面客户端，即可用 <b>${esc(state.user.displayName)}</b> 的身份登入。</p>
    <div class="code-box" id="grantCode">${esc(data.grant)}</div>
    <button class="btn btn-primary" style="width:100%" id="openDesktop"><span data-icon="arrow-up-right"></span>在桌面客户端完成登录</button>
    <div class="handoff-actions" style="margin-top:8px">
      <button class="btn" style="flex:1" id="copyGrant"><span data-icon="copy"></span>复制登录码</button>
      <button class="btn btn-sm btn-ghost" style="flex:1" id="copyLink">复制授权链接</button>
    </div>
    <ol class="handoff-steps">
      <li><span class="n">1</span><span>页面会自动唤起桌面客户端并完成登录，无需复制</span></li>
      <li><span class="n">2</span><span>若没有自动跳转，点上方「在桌面客户端完成登录」</span></li>
      <li><span class="n">3</span><span>仍不行时复制登录码，在客户端「登录码」框粘贴并点「登录」· 只能用一次，${hhmm} 前有效</span></li>
    </ol>
    <div class="handoff-user" style="margin-top:14px">
      <div class="avatar" style="width:26px;height:26px;font-size:11px">${esc(state.user.displayName.slice(0, 1))}</div>
      <div>${esc(state.user.displayName)}<span style="color:var(--muted)"> · ${esc(state.user.department || "—")} · ${esc(ROLE_LABEL[state.user.role] || state.user.role)}</span></div>
    </div>
  `;
  hydrateIcons(body);
  const copy = (text, label) => {
    navigator.clipboard?.writeText(text);
    toast(`${label}已复制`);
  };
  const openDesktop = () => {
    if (!data.deepLink) return;
    // 自定义协议导航不保证有返回值；失败时页面留在原地，用户可走复制登录码兜底。
    window.location.href = data.deepLink;
  };
  $("#openDesktop").onclick = openDesktop;
  const autoOpenKey = `hx:autoOpen:${data.grant}`;
  try {
    if (!sessionStorage.getItem(autoOpenKey)) {
      sessionStorage.setItem(autoOpenKey, "1");
      setTimeout(openDesktop, 600);
    }
  } catch {
    setTimeout(openDesktop, 600);
  }
  $("#copyGrant").onclick = () => copy(data.grant, "登录码");
  $("#copyLink").onclick = () => copy(data.deepLink, "授权链接");
  $("#handoffFoot").innerHTML = `
    <span style="font-size:12px;color:var(--muted)">控制面 ${esc(data.baseUrl)}</span>
    <button class="btn btn-sm btn-ghost" style="margin-left:auto" id="refreshGrant"><span data-icon="refresh"></span>重新生成</button>
  `;
  hydrateIcons($("#handoffFoot"));
  $("#refreshGrant").onclick = () => renderHandoffGrant();
}

/* ------------------------------ 启动 ------------------------------ */
(async function boot() {
  hydrateIcons(document);
  if (isDesktopAuth) return startHandoff();
  const oidcNext = new URLSearchParams(location.search).get("oidc_next");
  const oidcNextOk = oidcNext && oidcNext.startsWith("/") && !oidcNext.startsWith("//");
  // prompt=login（切换账号）：authorize 要求重输凭证，跳过自动续跳直接显表单。
  const forceReauth =
    oidcNextOk && new URL(oidcNext, location.origin).searchParams.get("prompt") === "login";
  if (!token || forceReauth) return showLogin();
  try {
    const me = await api("/api/auth/me");
    // 已登录且带着授权续跳参数：直接回 authorize 发码，不进控制台。
    // 防环：authorize 若再弹回来（会话被清但本地 token 尚在），
    // 不再二次续跳，落回登录页重认证。
    if (oidcNextOk) {
      if (sessionStorage.getItem("oidcResume")) {
        sessionStorage.removeItem("oidcResume");
      } else {
        sessionStorage.setItem("oidcResume", "1");
        location.href = oidcNext;
        return;
      }
    }
    state.user = me.user;
    state.perms = new Set(me.permissions || []);
    showApp();
    await loadAll();
    await navigate(location.hash || "#/overview");
  } catch {
    token = "";
    localStorage.removeItem(TOKEN_KEY);
    showLogin();
  }
})();

// 治理节保存：拉当前配置 → 变更 → 全量 PATCH 回写（其他节不动）
async function govPatch(mutate) {
  const cfg = await api("/api/client-config");
  await api("/api/client-config", { method: "PATCH", body: mutate(cfg) });
  toast("已保存并下发");
}

// 通用白名单选择抽屉：搜索 + 目录卡片 + 「＋开放/已开放」切换
// opts: {title, allowedSet, loadItems():Promise<items>, renderCard(it, inAllow), slugOf(it), onChange()}
function openPickDrawer(opts) {
  let items = null;
  openDrawer({
    title: opts.title,
    sub: "从目录选择要开放的项加入白名单",
    wide: opts.wide || true,
    body: `
      <div id="pickWrap" style="display:flex;flex-direction:column;height:100%;min-height:0">
      <div id="pickTabs" style="display:${opts.tabs ? "flex" : "none"};gap:4px;background:#f1f3f5;border-radius:10px;padding:4px;margin-bottom:12px;flex-wrap:wrap"></div>
      <input class="input" id="pickQ" placeholder="搜索…" style="margin-bottom:12px" />
      <div id="pickList" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;flex:1;min-height:0;overflow-y:auto;align-content:start">
        <div class="muted small">加载中…</div>
      </div>
      </div>`,
    onMount: async () => {
      let curTab = opts.tabs ? opts.tabs[0].key : null;
      const syncTabs = () => {
        if (!opts.tabs) return;
        $("#pickTabs").innerHTML = opts.tabs.map((tb) =>
          `<button type="button" class="pick-tab" data-k="${esc(tb.key)}" style="padding:7px 14px;border:none;border-radius:8px;font-size:13px;cursor:pointer;background:${tb.key === curTab ? "#fff" : "transparent"};color:${tb.key === curTab ? "var(--text,#111)" : "var(--text-secondary,#6b7280)"};box-shadow:${tb.key === curTab ? "0 1px 3px rgba(0,0,0,.08)" : "none"};font-weight:${tb.key === curTab ? "500" : "400"}">${esc(tb.label)}</button>`).join("");
        $("#pickTabs").querySelectorAll(".pick-tab").forEach((b) =>
          b.addEventListener("click", () => { curTab = b.dataset.k; syncTabs(); render($("#pickQ").value); }));
      };
      const render = (q = "") => {
        const box = $("#pickList");
        if (!items) return;
        const ql = q.trim().toLowerCase();
        const tabDef = opts.tabs && opts.tabs.find((tb) => tb.key === curTab);
        const list = items.filter((it) => {
          if (tabDef && tabDef.filter && !tabDef.filter(it)) return false;
          const s = `${opts.slugOf(it)} ${it.displayName || it.name || ""} ${it.summary || it.description || ""}`.toLowerCase();
          return !ql || s.includes(ql);
        });
        box.innerHTML = list.length ? list.map((it) => {
          const slug = opts.slugOf(it);
          const inAllow = opts.allowedSet.has(slug);
          return `<div style="display:flex;gap:10px;padding:12px;min-width:0;overflow:hidden;border:1px solid ${inAllow ? "#fca5a5" : "#eef0f3"};border-radius:10px;background:#fff">
            <div style="flex:1;min-width:0">${opts.renderCard(it)}</div>
            <button type="button" class="btn btn-sm ${inAllow ? "" : "btn-primary"} pick-add" data-slug="${esc(slug)}" style="align-self:flex-start;flex-shrink:0">${inAllow ? "已开放" : "＋ 开放"}</button>
          </div>`;
        }).join("") : `<div class="muted small">无匹配项。</div>`;
        box.querySelectorAll(".pick-add").forEach((b) =>
          b.addEventListener("click", () => {
            if (opts.allowedSet.has(b.dataset.slug)) opts.allowedSet.delete(b.dataset.slug);
            else opts.allowedSet.add(b.dataset.slug);
            opts.onChange(); render($("#pickQ").value);
          }));
      };
      $("#pickQ").addEventListener("input", (e) => render(e.target.value));
      try {
        items = await opts.loadItems();
      } catch (e) {
        $("#pickList").innerHTML = `<div class="muted small">${esc(e.message || "加载失败")}</div>`;
        return;
      }
      // 动态 tabs（从数据推导场景）：loadItems 后可再计算
      if (opts.tabsOf) { opts.tabs = opts.tabsOf(items); curTab = opts.tabs[0].key; }
      syncTabs();
      render();
    },
  });
}

// 目录卡内容渲染（图标+名+描述+slug，三场景共用）
const pickCardHTML = (it) => {
  const slug = it.slug || it.id || "";
  const name = it.displayName || it.name || slug;
  const icon = it.iconUrl || it.icon_url || it.icon || "";
  return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
      ${icon ? `<img src="${esc(icon)}" style="width:24px;height:24px;border-radius:6px" alt="">` : `<span style="width:24px;height:24px;border-radius:6px;background:#eef0f3;display:inline-flex;align-items:center;justify-content:center;font-size:12px">${esc(name.slice(0, 1))}</span>`}
      <b style="font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0">${esc(name)}</b>
    </div>
    <div class="muted small" style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;line-height:1.5">${esc(it.summary || it.description || "")}</div>
    <div class="muted" style="font-size:11px;margin-top:4px">${esc(slug)}</div>`;
};
const allowedChips = (box, allowedSet, onChange) => {
  box.innerHTML = allowedSet.size
    ? [...allowedSet].map((s) => `<span class="chip" style="display:inline-flex;align-items:center;gap:4px;padding:4px 8px;border:1px solid #fecaca;border-radius:6px;background:#fff;font-size:12px">${esc(s)} <button type="button" class="allow-x" data-slug="${esc(s)}" style="border:none;background:none;cursor:pointer;color:#c00000;font-size:13px">×</button></span>`).join("")
    : "";
  box.querySelectorAll(".allow-x").forEach((b) =>
    b.addEventListener("click", (e) => { e.preventDefault(); allowedSet.delete(b.dataset.slug); onChange(); }));
};

// 应用图标库：通用 + 业务域（隐患/矿山/文档/知识库/工业/办公…）
const APP_ICONS = [
  "⚠️","🛡️","🦺","🚧","⛑️","⛏️","🏗️","🏭","⚙️","🔩",
  "📄","📋","📝","📑","📚","🗂️","📖","🧠","🔖","📰",
  "🔍","🔎","📷","📸","🎥","📊","📈","📉","🗄️","💾",
  "🤖","💬","🗨️","💡","🧪","🔬","⚗️","🧬","🛰️","🚀",
  "🏢","🏛️","🌐","🖥️","💻","📱","☁️","🔒","🔑","🛠️",
  "📞","📮","📦","🧰","🧲","🩺","🏥","🚒","🚔","🎯",
];
const APP_COLORS = [
  "#c00000","#e03131","#e8590c","#f08c00","#f59f00","#74b816",
  "#2f9e44","#0ca678","#099268","#0b7285","#1098ad","#1c7ed6",
  "#4263eb","#3b5bdb","#7048e8","#ae3ec9","#d6336c","#6C757D",
];
// 图标/颜色点选弹层：挂在 row 的隐藏 input 上，选完写回
function openAppPicker(anchor, row) {
  document.querySelectorAll(".app-pick-pop").forEach((n) => n.remove());
  const iconIn = row.querySelector(".app-icon");
  const colorIn = row.querySelector(".app-color");
  const pop = document.createElement("div");
  pop.className = "app-pick-pop";
  pop.style.cssText = "position:fixed;z-index:1200;background:#fff;border:1px solid #e2e8f0;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.12);padding:12px;width:340px";
  const r = anchor.getBoundingClientRect();
  pop.style.left = Math.min(r.left, innerWidth - 360) + "px";
  pop.style.top = (r.bottom + 6) + "px";
  pop.innerHTML = `
    <div style="font-size:12px;color:var(--muted,#6b7280);margin-bottom:6px">图标（点击选用，也可自定义文字）</div>
    <div style="display:grid;grid-template-columns:repeat(10,1fr);gap:4px;margin-bottom:10px">
      ${APP_ICONS.map((i) => `<button type="button" class="pick-ico" data-v="${i}" style="border:1px solid #eef0f3;border-radius:6px;padding:4px 0;font-size:15px;cursor:pointer;background:${iconIn.value === i ? "#fee2e2" : "#fff"}">${i}</button>`).join("")}
    </div>
    <div style="display:flex;gap:6px;margin-bottom:10px">
      <input class="input pick-custom" style="flex:1;height:30px" placeholder="自定义图标字/emoji" value="${esc(iconIn.value)}" maxlength="4" />
      <button type="button" class="btn btn-sm pick-clear">清除</button>
    </div>
    <div style="font-size:12px;color:var(--muted,#6b7280);margin-bottom:6px">配色</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
      ${APP_COLORS.map((c) => `<button type="button" class="pick-col" data-v="${c}" title="${c}" style="width:22px;height:22px;border-radius:50%;border:${colorIn.value === c ? "2px solid #111" : "2px solid transparent"};background:${c};cursor:pointer"></button>`).join("")}
    </div>
    <input class="input pick-hex" style="height:30px" placeholder="自定义色值 #rrggbb" value="${esc(colorIn.value)}" />`;
  document.body.appendChild(pop);
  const sync = () => {
    row.querySelector(".app-iconview").textContent = iconIn.value || (row.querySelector(".app-name").value || "＋").slice(0, 1);
    const sw = row.querySelector(".app-colorswatch");
    sw.style.background = colorIn.value || "#e2e8f0";
    document.querySelectorAll(".app-pick-pop").forEach((n) => n.remove());
  };
  pop.querySelectorAll(".pick-ico").forEach((b) =>
    b.addEventListener("click", () => { iconIn.value = b.dataset.v; sync(); }));
  pop.querySelectorAll(".pick-col").forEach((b) =>
    b.addEventListener("click", () => { colorIn.value = b.dataset.v; sync(); }));
  pop.querySelector(".pick-custom").addEventListener("input", (e) => { iconIn.value = e.target.value.trim(); });
  pop.querySelector(".pick-hex").addEventListener("input", (e) => { colorIn.value = e.target.value.trim(); });
  pop.querySelector(".pick-clear").addEventListener("click", () => { iconIn.value = ""; sync(); });
  const onDoc = (e) => {
    if (!pop.contains(e.target) && e.target !== anchor) {
      pop.remove(); document.removeEventListener("mousedown", onDoc);
    }
  };
  setTimeout(() => document.addEventListener("mousedown", onDoc), 0);
}

/* --------------------- 应用管理（外部应用 agentLinks） --------------------- */
async function renderAppManager() {
  const cfg = await api("/api/client-config");
  $("#view").innerHTML = `
    <div class="card">
      <div class="card-head">
        <div><h3>应用管理</h3><span class="sub">外部智能体/编排系统的入口链接（如内部 Dify 类平台）。客户端侧栏「应用」区展示，点击内嵌打开。</span></div>
        <button class="btn btn-sm btn-primary" id="amAdd">${svg("plus", 14)} 添加应用</button>
      </div>
      <div class="card-body">
        <div class="grid" style="display:grid;grid-template-columns:120px 1fr 1fr 76px 86px 90px 76px 32px;gap:8px;margin-bottom:6px">
          <span class="muted small">名称</span><span class="muted small">URL</span><span class="muted small">描述</span><span class="muted small">图标字</span><span class="muted small">颜色</span><span class="muted small">打开方式</span><span class="muted small">启用</span><span></span>
        </div>
        <div id="amRows"></div>
      </div>
    </div>
    <div class="card" style="margin-top:14px"><div class="card-body" style="display:flex;gap:12px;justify-content:flex-end">
      <button class="btn btn-ghost" id="amReload">重新加载</button>
      <button class="btn btn-primary" id="amSave">${svg("check", 14)} 保存并下发</button>
    </div></div>`;

  const apps = (cfg.agentLinks || []).map((a) => ({
    id: a.id || "", name: a.name || "", url: a.url || "", desc: a.desc || "",
    icon: a.icon || "", color: a.color || "",
    openMode: a.openMode === "external" ? "external" : "iframe",
    enabled: a.enabled !== false,
  }));
  const appRow = (a, i) => `
    <div class="zc-app-row" data-idx="${i}" style="display:grid;grid-template-columns:120px 1fr 1fr 76px 86px 90px 76px 32px;gap:8px;align-items:center;margin-bottom:8px">
      <input class="input app-name" value="${esc(a.name)}" placeholder="名称" />
      <input class="input app-url" value="${esc(a.url)}" placeholder="https://…" />
      <input class="input app-desc" value="${esc(a.desc)}" placeholder="描述（可选）" />
      <button type="button" class="btn btn-sm app-iconpick" title="选择图标" style="width:100%;height:32px;font-size:14px"><span class="app-iconview">${a.icon || (a.name || "＋").slice(0, 1)}</span></button>
      <input type="hidden" class="app-icon" value="${esc(a.icon)}" />
      <button type="button" class="app-colorswatch" title="选择配色" style="width:26px;height:26px;border-radius:50%;border:2px solid #e2e8f0;background:${a.color || "#e2e8f0"};cursor:pointer;margin:auto"></button>
      <input type="hidden" class="app-color" value="${esc(a.color)}" />
      <select class="select app-mode">
        <option value="iframe" ${a.openMode === "iframe" ? "selected" : ""}>内嵌</option>
        <option value="external" ${a.openMode === "external" ? "selected" : ""}>外部</option>
      </select>
      <label class="check" style="margin:0"><input type="checkbox" class="app-enabled" ${a.enabled ? "checked" : ""} /><span>启用</span></label>
      <button class="btn btn-sm btn-ghost app-del" data-i="${i}" title="删除">${svg("trash", 14)}</button>
    </div>`;
  const renderRows = () => {
    $("#amRows").innerHTML = apps.length
      ? apps.map(appRow).join("")
      : `<div class="muted">暂无外部应用，点右上角「添加应用」。</div>`;
    $("#amRows").querySelectorAll(".app-iconpick, .app-colorswatch").forEach((b) =>
      b.addEventListener("click", () => openAppPicker(b, b.closest(".zc-app-row"))));
    $("#amRows").querySelectorAll(".app-del").forEach((b) =>
      b.addEventListener("click", () => {
        apps.splice(Number(b.dataset.i), 1);
        renderRows();
      }),
    );
  };
  const collectApps = () => {
    const out = [];
    $("#amRows").querySelectorAll(".zc-app-row").forEach((row, i) => {
      const name = row.querySelector(".app-name").value.trim();
      const url = row.querySelector(".app-url").value.trim();
      if (!name || !url) return;
      const a = apps[i] || {};
      out.push({
        id: a.id || `app_${Date.now().toString(36)}${i}`,
        name, url,
        desc: row.querySelector(".app-desc").value.trim() || undefined,
        icon: row.querySelector(".app-icon").value.trim() || undefined,
        color: row.querySelector(".app-color").value.trim() || undefined,
        enabled: row.querySelector(".app-enabled").checked,
        openMode: row.querySelector(".app-mode").value === "external" ? "external" : undefined,
      });
    });
    return out;
  };
  renderRows();
  $("#amAdd").addEventListener("click", () => {
    apps.push({ id: "", name: "", url: "", desc: "", icon: "", color: "", openMode: "iframe", enabled: true });
    renderRows();
  });
  $("#amReload").addEventListener("click", () => renderAppManager());
  $("#amSave").addEventListener("click", async () => {
    try {
      // 合并现有配置，只替换 agentLinks——避免覆盖市场/连接器等其他节
      await api("/api/client-config", {
        method: "PATCH",
        body: { ...cfg, features: {}, labels: {}, agentLinks: collectApps() },
      });
      toast("已保存并下发");
      await renderAppManager();
    } catch (e) {
      toast(e.message || "保存失败", "err");
    }
  });
}

/* --------------------- 客户端配置 --------------------- */
// 停用清单输入框：每行一个 slug/id，保存时转成数组。
const disabledListField = (id, list, placeholder) => `
  <div class="field"><label>${placeholder}</label>
    <textarea class="textarea" id="${id}" rows="3" placeholder="每行一个标识">${esc((list || []).join("\n"))}</textarea>
  </div>`;

const parseLines = (id) =>
  [...new Set($("#" + id).value.split(/[\n,，\s]+/).map((s) => s.trim()).filter(Boolean))];

async function renderClientConfig() {
  const [cfg, tokens] = await Promise.all([
    api("/api/client-config"),
    api("/api/client-config/tokens"),
  ]);

  $("#view").innerHTML = `
    <div class="grid" style="display:grid;gap:16px">

      <div class="card">
        <div class="card-head"><h3>下发状态</h3><span class="chip ok">已启用</span></div>
        <div class="card-body">
          <div class="kv-row"><span>客户端拉取地址</span><code>${esc(location.origin)}/v1/client-config</code></div>
          <div class="kv-row"><span>当前版本</span><code>${esc(cfg.version || "—")}</code></div>
          <div class="kv-row"><span>最后更新</span><span>${esc(cfg.updatedBy || "—")} · ${esc(cfg.updatedAt || "—")}</span></div>
          <div class="notice" style="margin-top:12px">
            ${svg("info", 16)}
            <span>客户端登录后拉取本页配置并应用，重启即生效，无需重新打包。</span>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>组织与品牌</h3><span class="sub">全局基础下发属性</span></div>
        <div class="card-body">
          <div class="field"><label>显示名称（影响界面文案）</label><input class="input" id="zcBrand" value="${esc(cfg.brandProductName || "")}" placeholder="HX 智能体" /></div>
        </div>
      </div>





      <div class="card">
        <div class="card-head"><h3>客户端接入令牌</h3><button class="btn btn-sm btn-primary" id="zcNewToken">${svg("key", 14)} 生成令牌</button></div>
        <div class="card-body">
          <div id="zcNewTokenBox"></div>
          ${
            (tokens.items || []).length === 0
              ? `<div class="muted">还没有令牌。生成后配置到客户端的访问令牌。</div>`
              : (tokens.items || [])
                  .map(
                    (t) => `
              <div class="list-row" style="display:flex;align-items:center;justify-content:space-between">
                <div><strong style="font-size:13.5px">${esc(t.label)}</strong><div class="muted small">${esc(t.created_by || "—")} · ${esc(t.created_at)}</div></div>
                <div>
                ${
                  t.revoked
                    ? `<span class="chip warn">已撤销</span>`
                    : `<button class="btn btn-sm btn-ghost" data-revoke-token="${esc(t.id)}">撤销</button>`
                }
                </div>
              </div>`
                  )
                  .join("")
          }
        </div>
      </div>

      <div class="card">
        <div class="card-body" style="display:flex;gap:12px;justify-content:flex-end">
          <button class="btn btn-ghost" id="zcReload">重新加载</button>
          <button class="btn btn-primary" id="zcSave">${svg("check", 14)} 保存并下发</button>
        </div>
      </div>
    </div>`;

  $("#zcSave").addEventListener("click", async () => {
    // 合并现配置只改品牌——避免整档替换抹掉 market/agentLinks 等其他节
    const body = { ...cfg, brandProductName: $("#zcBrand").value.trim() || undefined };
    try {
      await api("/api/client-config", { method: "PATCH", body });
      toast("已保存，客户端重启后生效");
      await renderClientConfig();
    } catch (e) {
      toast(e.message, "warn");
    }
  });
  $("#zcReload").addEventListener("click", () => renderClientConfig());

  $("#zcNewToken").addEventListener("click", async () => {
    const label = prompt("令牌用途备注（如：测试机）");
    if (!label) return;
    try {
      const r = await api("/api/client-config/token", { method: "POST", body: { label } });
      $("#zcNewTokenBox").innerHTML = `
        <div class="notice ok" style="margin-bottom:12px">
          ${svg("check", 16)}
          <div>
            <div><strong>令牌已生成，只显示一次</strong></div>
            <code style="word-break:break-all">${esc(r.token)}</code>
          </div>
        </div>`;
      toast("令牌已生成");
    } catch (e) {
      toast(e.message, "warn");
    }
  });

  document.querySelectorAll("[data-revoke-token]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      if (!confirm("撤销后使用该令牌的客户端将无法拉取配置，确定？")) return;
      try {
        await api(`/api/client-config/tokens/${btn.dataset.revokeToken}`, { method: "DELETE" });
        toast("已撤销");
        await renderClientConfig();
      } catch (e) {
        toast(e.message, "warn");
      }
    })
  );
}

/* ------------------------------ 实例管理 ------------------------------ */
async function renderInstances() {
  if (!hasPerm("instances")) {
    $("#view").innerHTML = `<div class="card"><div class="card-body"><div class="notice warn">${svg("alert", 16)}<span>只有管理员可以管理实例。</span></div></div></div>`;
    return;
  }
  const data = await api("/api/instances");
  state.instances = data.items;
  $("#view").innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">实例管理</h1>
        <p class="page-desc">登记各 Octop 实例的地址与管理员令牌，拉取式聚合实例内用户——不做表同步，数据永远以实例为准。</p>
      </div>
      <div class="page-actions"><button class="btn btn-primary" data-act="new-inst"><span data-icon="plus"></span>登记实例</button></div>
    </div>
    <div class="card"><div class="card-body tight table-wrap">
      <table class="tbl">
        <thead><tr><th style="width:22%">实例</th><th>地址</th><th>最近可达</th><th>状态</th><th></th></tr></thead>
        <tbody>
          ${data.items.map((i) => `<tr>
            <td><div class="cell-main"><div class="avatar avatar-lg">${esc(i.name.slice(0,2))}</div><div><div class="cell-title">${esc(i.name)}</div><div class="cell-sub mono">${esc(i.id)}</div></div></div></td>
            <td class="mono" style="font-size:12.5px">${esc(i.baseUrl)}</td>
            <td style="font-size:12px;color:var(--muted)">${i.lastSeenAt ? relTime(i.lastSeenAt) : "—"}</td>
            <td>${i.lastError ? `<span class="pill red no-dot" title="${esc(i.lastError)}">异常</span>` : `<span class="pill gray no-dot">未探测</span>`}</td>
            <td class="actions"><span class="row-actions">
              <button class="btn btn-sm" data-act="inst-users" data-id="${i.id}"><span data-icon="users"></span>用户</button>
              <button class="btn btn-sm btn-ghost" data-act="del-inst" data-id="${i.id}" title="删除"><span data-icon="trash"></span></button>
            </span></td>
          </tr>`).join("") || `<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:32px">还没有登记实例，点右上角「登记实例」添加一台 Octop。</td></tr>`}
        </tbody>
      </table>
    </div></div>
    <div id="inst-users"></div>
  `;
  bind("#view", "[data-act='new-inst']", "click", openInstanceDrawer);
  bind("#view", "[data-act='inst-users']", "click", (e) => renderInstanceUsers(e.currentTarget.dataset.id));
  bind("#view", "[data-act='del-inst']", "click", async (e) => {
    const inst = state.instances.find((x) => x.id === e.currentTarget.dataset.id);
    if (!(await confirmDialog({ title: `删除实例「${inst.name}」？`, desc: "只删除登记记录，不影响实例本身的数据。", okText: "删除", danger: true }))) return;
    try {
      await api(`/api/instances/${inst.id}`, { method: "DELETE" });
      toast("已删除");
      await renderInstances();
    } catch (err) { toast(err.message || String(err), "error"); }
  });
}

async function renderInstanceUsers(id) {
  const inst = state.instances.find((x) => x.id === id);
  const box = $("#inst-users");
  box.innerHTML = `<div class="card" style="margin-top:16px"><div class="card-body"><div class="notice">正在从 ${esc(inst.baseURL)} 拉取用户…</div></div></div>`;
  try {
    const data = await api(`/api/instances/${id}/users`);
    box.innerHTML = `
      <div class="card" style="margin-top:16px"><div class="card-body tight table-wrap">
        <div style="padding:4px 0 12px;font-weight:600">${esc(inst.name)} · 实例内用户（${data.items.length}）</div>
        <table class="tbl">
          <thead><tr><th>用户名</th><th>显示名</th><th>邮箱</th><th>登录方式</th><th>角色</th><th>状态</th></tr></thead>
          <tbody>
            ${data.items.map((u) => `<tr>
              <td class="mono">${esc(u.username)}</td>
              <td>${esc(u.displayName || "—")}</td>
              <td style="font-size:12.5px;color:var(--text-2)">${esc(u.email || "—")}</td>
              <td>${esc(u.authType)}</td>
              <td><span class="pill ${u.role === "admin" ? "red" : "gray"} no-dot">${esc(u.roleName || u.role)}</span></td>
              <td>${u.disabled ? '<span class="pill red no-dot">停用</span>' : '<span class="pill blue no-dot">正常</span>'}</td>
            </tr>`).join("")}
          </tbody>
        </table>
      </div></div>`;
  } catch (err) {
    box.innerHTML = `<div class="card" style="margin-top:16px"><div class="card-body"><div class="notice warn">${svg("alert", 16)}<span>拉取失败：${esc(err.message || String(err))}</span></div></div></div>`;
  }
}

function openInstanceDrawer() {
  const html = `
    <div class="field"><label>实例名称</label><input id="fi-name" class="input" placeholder="如：本地开发实例 / 服务端生产"></div>
    <div class="field"><label>实例地址</label><input id="fi-url" class="input mono" placeholder="http://127.0.0.1:8188"></div>
    <div class="field"><label>管理员令牌</label><input id="fi-token" class="input mono" placeholder="实例 admin 的 JWT（POST /api/auth/login 获取）"></div>
    <div class="field-hint">令牌用于后台代你查询实例 /api/users 等只读接口，存在服务端不落前端。</div>
  `;
  openDrawer({
    title: "登记 Octop 实例",
    body: html,
    foot: `<button class="btn" data-drawer-cancel>取消</button><div class="spacer"></div><button class="btn btn-primary" id="saveInst">登记</button>`,
    onMount: (root) => {
      root.querySelector("#saveInst").onclick = async () => {
        const name = root.querySelector("#fi-name").value.trim();
        const baseUrl = root.querySelector("#fi-url").value.trim().replace(/\/+$/,"");
        const adminToken = root.querySelector("#fi-token").value.trim();
        if (!name || !baseUrl || !adminToken) return toast("三项必填", "err");
        try {
          await api("/api/instances", { method: "POST", body: { name, baseUrl, adminToken } });
          toast("已登记");
          closeDrawer();
          await renderInstances();
        } catch (err) {
          toast(err.message, "err");
        }
      };
    },
  });
}
