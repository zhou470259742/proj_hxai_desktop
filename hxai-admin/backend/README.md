# HX AI 工作台 · 控制面（Go）

管理后台的**后台服务**，运行在 `hxai-admin/backend`。最初是 `legacy-node/` 下 Node 实现按参考技术栈重写的版本，目标不是新开一套后台，而是**在保持 `/api`、`/v1` 契约不变的前提下替换**：前端 `hxai-admin/frontend` 原样复用，桌面端零改动；Node 版保留在 `legacy-node/` 作为契约基准与回退路径。

## 技术栈

| 组件 | 版本 | 用途 |
|---|---|---|
| Go | 1.24.5 | 主要编程语言 |
| Hertz | v0.10.2 | HTTP Web 框架，构建 RESTful API |
| GORM | v1.31.0 | ORM 库，操作 MySQL / SQLite |
| MySQL | 8.4 | 服务端部署：业务数据、会话、审计链 |
| SQLite | modernc（纯 Go，无 CGO） | 桌面内置模式：单文件库，随客户端进程启停 |
| JWT | jwt/v5 v5.2.2 | 身份认证与授权（与 Node 版同构载荷） |
| Prometheus | v1.20.5 | 系统监控和指标收集 |
| go-i18n | v2.6.0 | 错误码国际化（zh-CN / en-US） |

不引入 Redis、Kafka、Asynq 与 Docker：登录锁定用进程内计数，登录码清理与审计封链由进程内定时器承担，当前规模够用且少一层部署负担。

## 目录

```
backend/
├── cmd/control-plane            # HTTP 服务 + 进程内维护任务
├── internal/config              # 环境变量（沿用 OWCP_*）
├── internal/model               # GORM 模型（与 SQLite 表结构对齐）
├── internal/store               # MySQL、会话、设置、审计链、种子
├── internal/service             # 领域逻辑：认证、用户、专家、插件、技能、供应商、下发、网关
├── internal/transport/httpapi   # 路由、中间件、处理器、静态资源
├── internal/platform            # JWT、口令散列、ID、i18n、指标
├── legacy-node/                 # Node 参考实现（契约基准 + 回退），public 软链到 ../frontend
├── data/                        # 插件包与上传文件
└── scripts/export-sqlite.mjs    # SQLite → MySQL 数据迁移
```

## 快速开始（本机 MySQL）

```bash
# 1. 安装并启动 MySQL 8.4（已装可跳过）
brew install mysql@8.4
brew services start mysql@8.4

# 2. 建库建用户（root 无密码时）
mysql -uroot <<'SQL'
CREATE DATABASE IF NOT EXISTS hx_control CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'control'@'127.0.0.1' IDENTIFIED BY 'control';
GRANT ALL PRIVILEGES ON hx_control.* TO 'control'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL

# 3. 启动（首次自动建表并写入默认管理员）
cp .env.example .env        # 按需修改 OWCP_PUBLIC_BASE_URL / OWCP_SECRET
set -a && source .env && set +a
go run ./cmd/control-plane  # http://127.0.0.1:8787，指标 :9090/metrics
```

新库首次启动写入默认管理员 `admin / Admin@12345`，登录后请立即修改密码。进程内维护任务在启动后立即执行一次，之后每分钟清理过期登录码，每天 03:30(UTC) 后首次 tick 做审计封链自查。

## 桌面内置模式（SQLite）

桌面端默认把控制面二进制随客户端打包，启动时由 Electron 主进程拉起，用户不需要单独安装或启动后台：

```bash
HXAI_DB=sqlite HXAI_DB_PATH=~/.hxai/console/control.db \
PORT=0 OWCP_PUBLIC_BASE_URL=auto METRICS_ADDR=127.0.0.1:0 \
./hxai-console
# 就绪后输出：HXAI_CONSOLE_READY http://127.0.0.1:<实际端口>
```

| 变量 | 说明 |
|---|---|
| `HXAI_DB` | `mysql`（默认，服务端部署）或 `sqlite`（桌面内置） |
| `HXAI_DB_PATH` | SQLite 文件路径，默认 `./data/control.db` |
| `PORT` | `0` 表示由进程分配空闲回环端口，启动后用 `HXAI_CONSOLE_READY` 行告知调用方 |
| `OWCP_PUBLIC_BASE_URL` | `auto` 表示按 `HOST`/`PORT` 自动推导，用于动态端口场景 |

- SQLite 使用纯 Go 驱动（modernc），无需 CGO；`busy_timeout` + WAL 允许人工排查时并行读取，连接池固定为 1 以串行化写入。
- 模型为 MySQL 写的 `type:datetime(3)`、`type:bigint unsigned` 会在 SQLite 连接器层改写成 `DATETIME` / `integer PRIMARY KEY AUTOINCREMENT`，否则时间列无法扫描、审计日志拿不到自增 id。
- 登录名与判重统一用 `LOWER()` 比较，避免 SQLite 区分大小写、MySQL 默认不区分造成行为差异。
- 进程收到 `SIGTERM`/`SIGINT`/`SIGHUP` 后优雅退出，桌面端据此在退出时回收子进程。

### 升级兼容

- 库结构版本记录在 `schema_meta`，代码侧为 `internal/store/migrate.go` 的 `SchemaVersion`。只加表/加列不动版本，由 AutoMigrate 追加；改列语义、拆表、批量回填要在 `dataMigrations` 加可重入迁移并把版本 +1。
- 已有库且版本落后时，先用 `VACUUM INTO` 生成 `<control.db>.pre-upgrade-<UTC 时间>-<pid>.bak`（0600，保留最近 3 份）再迁移；快照失败即中止，原库不动。
- 数据迁移与版本号同事务提交，失败回滚不推进版本；库版本高于程序时拒绝启动，避免旧程序按旧语义写新库。
- `OWCP_SECRET` 由桌面端持久化，升级换二进制不换密钥，已签发令牌继续有效。

## 已覆盖范围

- **认证与用户**：登录/登出/me/改密，用户 CRUD，JWT + 会话表，登录失败按「账号 + IP」在进程内计数锁定。
- **桌面登录**：`POST /api/desktop/handoff` 生成一次性登录码，`POST /v1/auth/desktop-handoff/exchange` 兑换会话；深链与响应结构与 Node 版一致。
- **下发链路**：`/v1/client-config`、`/v1/provider-config.json`（网关/直连两种模式）、`/api/provider-config/preview`、网关令牌轮换、客户端令牌 CRUD。
- **桌面策略**：`/v1/me/desktop-config`、`/v1/me/orgs`、`/v1/org`、`/v1/features`、`/v1/app-version`、`/v1/desktop/manifest`。
- **资源管理**：专家/插件/技能/模型供应商/模型别名完整 CRUD，专家复制、专家包预览/下载/发布，插件包上传与匿名下载，`marketplace.json`。
- **专家/技能导入导出**：`GET /api/experts/:id/export`（`<key>.expert.json`，插件/技能按 key 引用）、`POST /api/experts/import`、`GET /api/skills/:id/export`（原生 `SKILL.md`）、`POST /api/skills/import`；key 冲突自动改名，导入一律落草稿，缺失的插件/技能 key 在响应的 `missingPlugins` / `missingSkills` 中回报。
- **客户端资源接口**：`/v1/me/experts`、`/v1/me/active-expert`、`/v1/mcp-connections`、`/v1/me/library`、`/v1/resources`、`/v1/marketplaces`、`/v1/marketplaces/:id/resolved`、`/v1/plugins/:id/resolved`、`/v1/resolved-plugins`；专家作用域裁剪与失败原因（`not_found` / `not_in_expert_scope`）与 Node 版一致。
- **模型网关**：`/v1/llm/:providerKey/models`、`/v1/llm/:providerKey/chat/completions`（别名解析 + SSE 流式透传）。
- **审计**：哈希链写入（MySQL 单行链表头加行锁，多实例不分叉）、`/api/audit`、`/api/audit/verify`。
- **可观测**：`/metrics`（请求量/耗时/登录结果/登录码兑换/维护任务）、结构化启动日志。

## 从 Node 版迁移

```bash
# 1. 导出（可重复执行）
node scripts/export-sqlite.mjs \
  --db legacy-node/data/control-plane.db \
  --out migrations/from-sqlite.sql

# 2. 先让 Go 服务建表：首次启动必须关掉种子，否则默认 admin 会占用唯一用户名
OWCP_SEED_DISABLE=1 go run ./cmd/control-plane   # 看到"启动于"后 Ctrl+C

# 3. 导入（连接字符集必须是 utf8mb4）
mysql --default-character-set=utf8mb4 -h127.0.0.1 -ucontrol -pcontrol hx_control < migrations/from-sqlite.sql
```

- 口令散列格式沿用 `scrypt$N$salt$hash`，Node / Go 双向可校验；
- JWT 载荷（sub/role/jti/iat/exp）与签名密钥沿用 `OWCP_SECRET`，旧令牌在会话数据迁移后可继续使用；
- 会话表、一次性登录码、客户端令牌一并迁移；
- 审计链表头自动接续最后一条已封链记录；
- 导入完成后以正常方式启动（不再设置 `OWCP_SEED_DISABLE`），种子只会在用户表为空时写入。

### 切换与回退

Go 版已于 2026-11-05 接管 8787，Node 版保留在 `legacy-node/`：

1. **回退**：停掉 Go 进程，`cd legacy-node && node src/server.mjs` 即恢复 8787（SQLite 数据未被修改）；
2. **再次切换**：停掉 Node，`cd backend && go run ./cmd/control-plane`；
3. 两个实现不能同时监听同一端口，切换前先确认 `lsof -nP -iTCP:8787 -sTCP:LISTEN`。

## 与 Node 版的行为差异

- 登录失败计数从 SQLite `login_attempts` 移到进程内计数，迁移不搬运该表；多实例部署时锁定状态不共享；
- 新增 `audit_chain_head` 表用于并发安全的链头，不属于业务数据；
- 错误文案由 go-i18n 按 `Accept-Language` / `X-Client-Language` 渲染，错误码与 Node 版一致；
- 登录码清理与审计封链改为进程内定时任务，不再依赖队列与 worker 进程。

## 已知边界

- 多实例部署时登录锁定与维护任务不跨节点协调，当前按单实例设计；
- MCP OAuth 授权端点仅保留 `.well-known` 元数据，未实现完整授权流程；
- 视觉与交互由 `../frontend` 提供，Go 版只做静态托管，不改前端。
