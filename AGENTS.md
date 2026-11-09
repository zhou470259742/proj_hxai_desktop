# AGENTS.md · HX 智能体工作台（proj_octop_desktop）

> 给接手开发的 AI 工具与工程师：先读本文件，再进入 `hxai-octop/` 子目录按其 `AGENTS.md` 工作。

## 1. 项目定位

政企智能体（助手）平台，以腾讯开源 **Octop** 为产品底座做白标改造与后端打通。
面向政府/企业客户，用户以「助手/智能体」而非「项目/工作区」的方式使用产品。
选型结论与候选对比见 `docs/调研与决策.md`，工作项分解见 `docs/改造方案.md`。

## 2. 目录与职责

| 路径 | 职责 |
|---|---|
| `hxai-octop/` | Octop 上游源码（git，origin → TencentCloud/Octop，跟踪上游） |
| `hxai-admin/` | 服务端控制面（Go/Hertz + 无构建前端）。已瘦身剩三块：**身份**（账号/会话，OIDC IdP 待建）、**配置下发**（`/v1/client-config` = features 开关/labels 文案/agentLinks + handoff 配对 + client tokens）、**内容供给**（专家/插件/技能 CRUD 与打包）。端口 **8888**，指标 **9091**；`HXAI_DB=sqlite`（`./data/control.db`）或 mysql（`hx_control_octop`，本机未授权）。zcode 运行时面（/v1/me、mcp、llm 代理、providers、marketplaces）已删除，备份在 `~/hx-work/_archive/proj_octop_desktop/hxai-admin-20261107` |
| `docs/` | 本项目文档：调研结论、改造方案、白标改动登记、更新日志 |
| `tools/` | 本项目工具：`expert2octop.py`（专家记录→expert zip 转换器）、`market_stub.py`（私有市场协议最小实现，验证用）、`out/`（生成的包） |
| `hxai-harness-extensions/` | 源码扩展目录（sso adapter、插件等定制代码，待建） |
| `research/` | （已归档至 `~/hx-work/_archive/proj_octop_desktop/research`，需要时取回或重新 clone） |

`hxai-octop/` 内部的模块边界、测试与提交规范以 `hxai-octop/AGENTS.md` 为准。

## 3. 环境与命令

Python 3.12（uv）、Node 构建前端（本机 v24 可用，官方 pin 20）。

```bash
cd hxai-octop
uv venv --python 3.12 .venv && uv pip install -e .   # 已含 httpx[socks]，勿移除
OCTOP_HOME=$PWD/.octop-dev .venv/bin/octop init \
  --admin-username admin --admin-password 'Admin@12345' --yes
cd dashboard && npm ci && NODE_ENV=production npm run build
cd .. && nohup env OCTOP_HOME=$PWD/.octop-dev \
  OCTOP_PORTAL_ORIGIN=http://127.0.0.1:8931 \
  OCTOP_MARKET_REMOTE_ORIGIN=http://127.0.0.1:8931 \
  .venv/bin/octop run &          # dashboard: http://127.0.0.1:8188
python3 ../tools/market_stub.py ../tools/out 8931 &   # 本地市场桩
```

注意（已踩坑确认）：

- dashboard 产物不入库，`octop run` 启动时挂载——**构建后必须重启**才生效。
- 本机有 SOCKS 代理环境变量，provider 测试报 `socksio` 缺失时确认
  `httpx[socks]` 已装（`uv pip install 'httpx[socks]'`）。
- agent 相关路由用 `agent_id`（如 `KY4AS4`）寻址，不是数字 `id`。
- `pkill -f "octop run"` 会误杀含该串的整条 shell 命令，按 PID kill。

质量门槛（改 hxai-octop/ 代码前必读其 AGENTS.md）：`make all`；前端 `npx tsc -b`。

## 4. 改造原则

- **内部标识不改**：`octop` 包名、`OCTOP_*` env、`~/.octop`、CLI 名保持原样；
  白标只覆盖用户可见层。已替换：zh/en 文案（占位品牌「HX 智能体 / HX
  Agent」，正式名待定）、标题/manifest/offline、favico/logo/PWA/mascot png
  （占位图）。未替换：webm 吉祥物动画、横版 logo（待正式设计稿）。
- **改动登记**：对 `hxai-octop/` 的每处本地改动登记进 `docs/白标改动登记.md`。
- **不动核心**：定制走扩展点（sso adapter、市场协议、REST API、插件）；
  源码级扩展放 `hxai-harness-extensions/`。
- **MIT**：保留 LICENSE 与版权声明。

## 5. 已验证事实（基线 4022e24 / v1.0.3b4，勿重复调研）

- 登录：`POST /api/auth/login` → `{access_token, token_type, expires_in, user}`。
- provider 写操作在 admin 路由：`POST /api/admin/providers`（kind=`openai` 即
  OpenAI-compatible），`POST /api/admin/providers/{id}/test` 实测我们网关
  `https://ai.ctaigw.cn/v1` 通过（`chat_completions`）。
- agent 绑模型：`PATCH /api/agents/{agent_id}` → `default_model:
  "providerName:modelId"`；模型清单 `GET /api/providers/resolved`。
- 专家安装链路：`tools/expert2octop.py` 产 zip → market_stub 供目录 →
  `POST /api/experts/hub/{slug}/install` → agent 创建成功。
- 市场协议细节见 `hxai-octop/docs/private-market.md`：目录 ≤1MiB、缓存 30s、
  详情字段内嵌列表项、download_url 源站须与 REMOTE_ORIGIN 一致。
- OIDC 适配器硬性要求：discovery issuer 严格匹配、JWKS、id_token 仅
  RS256/ES256（拒 HS256）、PKCE S256、nonce。
- 本机 dev 数据：`.octop-dev`（admin/Admin@12345）；勿用 `~/.octop` 真实数据。桌面壳 dev 也须带 `OCTOP_HOME=$PWD/.hxai-oct-dev`，否则 shell 配置会写入 `~/.octop`。

## 6. 启动动作

收到「客户端和工作台后台一同启动」（或类似表述，如「启动开发模式」）时，
执行以下**开发模式**启动——前端热更新、后端热重载，改代码即时生效：

```bash
cd hxai-octop
# 依赖缺失时先补（.venv 或 node_modules 不存在才跑）
[ -d .venv ] || { uv venv --python 3.12 .venv && uv pip install -e . \
  && uv pip install 'httpx[socks]'; }
[ -d dashboard/node_modules ] || (cd dashboard && npm ci)

# 后台：uvicorn 热重载，改 Python 源码自动重启（:8088）
nohup env OCTOP_HOME=$PWD/.octop-dev \
  OCTOP_PORTAL_ORIGIN=http://127.0.0.1:8931 \
  OCTOP_MARKET_REMOTE_ORIGIN=http://127.0.0.1:8931 \
  .venv/bin/octop run --reload > /tmp/octop-dev.log 2>&1 &

# 前端：vite dev server + HMR，/api 自动代理到 127.0.0.1:8188
(cd dashboard && nohup npm run dev > /tmp/octop-vite.log 2>&1 &)

# 市场桩（可选，验证专家市场链路时）
[ -d tools/out ] || python3 tools/expert2octop.py <expert.json> -o tools/out
nohup python3 ../tools/market_stub.py ../tools/out 8931 > /tmp/octop-market.log 2>&1 &
```

- 访问入口：**vite 地址**（`npm run dev` 输出，默认 :5173），不是 :8088——
  :8088 是后端+生产构建产物，开发走 vite 才有 HMR。
- 等价官方目标：`make dev`（前后端同拉，但我们用上面分进程方式便于日志分离）。
- 注意：Python 改动经 uvicorn `--reload` 生效；改 `dashboard/` 由 vite HMR 生效；
  **改完前端要出正式产物仍须 `npm run build` + 重启**（生产路径才走构建产物）。
- 登录 dev 实例：`admin / Admin@12345`（`.octop-dev` 数据目录，勿用 `~/.octop`）。
- 管理后台（hxai-admin）是独立服务：`cd hxai-admin/backend &&
  set -a && source .env && set +a && go run ./cmd/control-plane`（:8888）。

## 7. 交接日志（每次改动必做）

**每次对本项目做任何修改（代码、配置、文档、运行态、目录结构、数据），收尾前
必须向 `docs/更新日志.md` 追加一条记录**，让其他线程/会话不看聊天上下文也能接手。

格式（新条目追加在文件顶部，倒序）：

```markdown
### YYYY-MM-DD HH:mm · <一句话主题>
- 改了什么：<文件/命令/接口，列要点>
- 为什么：<触发原因/对应工作项 W? >
- 验证：<跑了什么、结果；没跑要如实写>
- 遗留：<未完成项、坑、下一步>
```

规则：粒度按「一次任务」合并，不为每个文件开条目；对外行为/端口/凭据/数据
位置变化必须记；运行中进程（octop run、市场桩、admin）的启停与端口也记。

## 7. 不要做的事

- 不要把 Octop 内部标识改名；不要把真实密钥写进代码/文档/git（现有
  `ce5f82…` 网关 key 只允许出现在 .octop-dev 本地数据中，不提交）。
- 不要引入 MySQL（接受 PostgreSQL/SQLite）。
- 不要把 `research/` 参考源码当依赖编译。
- 不要删 `tools/` 里的本项目文件；上游 `git pull` 前先看
  `docs/白标改动登记.md`。
