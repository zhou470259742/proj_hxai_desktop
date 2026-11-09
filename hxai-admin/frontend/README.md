# 管理后台 · 前台

管理界面，纯静态资源（`index.html` / `app.js` / `styles.css`），没有构建步骤，也没有依赖。

- 由 `../backend` 以静态资源方式托管，访问 `http://127.0.0.1:8787/` 即可。
- 本地直接改文件、刷新浏览器即生效；后端只在启动时读取 `PUBLIC_DIR`（默认 `../frontend`）。
- 接口一律走同源 `/api`、`/v1`，鉴权用 `Authorization: Bearer <token>`（令牌存 `localStorage`）。

Node 参考实现通过 `../backend/legacy-node/public` 软链复用本目录，改前端不需要两边同步。
