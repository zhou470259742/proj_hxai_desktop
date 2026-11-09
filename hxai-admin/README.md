# HX AI 工作台 · 管理后台

管理后台项目，包含两个包：

| 目录 | 角色 | 说明 |
|---|---|---|
| `backend/` | **后台** | Go 控制面（Hertz + GORM + MySQL），提供 `/api`、`/v1`，并托管前台静态资源 |
| `frontend/` | **前台** | 管理界面（原生 HTML/CSS/JS，无构建），由后台以静态资源方式提供 |

后台最初由 `backend/legacy-node/` 的 Node 零依赖实现迁移而来。Node 版仍保留在 `backend/legacy-node/`：它是**接口契约的事实源**，也是出问题时的回退路径。

## 启动

```bash
cd hxai-admin/backend
cp .env.example .env          # 首次
set -a && source .env && set +a
go run ./cmd/control-plane     # http://127.0.0.1:8787，指标 :9090/metrics
```

打开 <http://127.0.0.1:8787/> 即为管理界面。默认账号 `admin / Admin@12345`，首次登录后立即改密。

前置条件：MySQL 8.4 已启动，库 `hx_control` 与用户 `control/control` 已建好（见 `backend/README.md`「快速开始」）。

## 回退到 Node 版

停掉 Go 进程，然后：

```bash
cd hxai-admin/backend/legacy-node
node src/server.mjs            # 同样监听 8787，读写原 SQLite
```

两个实现不能同时占用 8787。SQLite 数据在迁移时是只读导出，未被修改。

## 改前必读

- 接口契约以 `backend/legacy-node/src/api.mjs` 为准，Go 侧修改必须两端对齐。
- 前端没有构建步骤，直接改 `frontend/` 下的文件，刷新页面即生效。
- 详细接口、数据模型、安全策略见 `backend/legacy-node/README.md`；Go 侧实现范围与差异见 `backend/README.md`。
