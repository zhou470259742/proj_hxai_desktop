# 和信 AI 工作台 · 管理后台（Node 参考实现）

> **状态**：2026-11-05 起 8787 由 Go 控制面（`../`）接管，本目录保留为**接口契约的事实源**与**回退路径**。
> 前端已移到 `../../frontend`，本目录的 `public` 是指向它的软链；日常改前端请去那边。

一个零依赖的 Node 服务（`node:http` + `node:sqlite` + `node:crypto`），管住 ZCode 桌面端的**插件市场、技能、专家、模型、用户权限、审计**，并把配置**下发到客户端**。

---

## 一、启动

```bash
cd hxai-admin/backend/legacy-node
node src/server.mjs
```

需要 Node ≥ 22.5（用到内置 `node:sqlite`）。启动前先停掉 Go 控制面，两个实现不能同时占用 8787。

```
管理后台   http://127.0.0.1:8787/
客户端配置 http://127.0.0.1:8787/v1/client-config
市场清单   http://127.0.0.1:8787/v1/marketplace.json
数据文件   ./data/control-plane.db（data 为软链，实际落在 ~/.hxai-data/admin-console）
```

**默认账号**：`admin` / `Admin@12345` —— 首次登录后立刻改密码。

演示账号：`zhangmin`（发布者）、`lijie` / `wangyu` / `chenxi`（成员，密码 `Hx@12345`）。

### 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `8787` | 监听端口 |
| `HOST` | `127.0.0.1` | 监听地址；局域网访问改 `0.0.0.0` |
| `OWCP_SECRET` | 开发固定值 | **会话签名密钥，生产必须设置** |
| `OWCP_TOKEN_TTL` | `43200` | 令牌有效期（秒） |
| `OWCP_PUBLIC_BASE_URL` | `http://127.0.0.1:8787` | **对外地址**：插件包下载链接、模型下发 `baseUrl` 都用它拼。装在别的机器上的客户端会连不上默认值，对外部署必须改 |
| `OWCP_ORG_NAME` | `和信智慧应急` | 组织名 |
| `DATA_DIR` | `./data` | 数据目录 |
| `OWCP_ANON_CONFIG` | 关 | 设 `1` 允许匿名拉配置（仅调试） |
| `OWCP_LOGIN_MAX_FAILURES` | `5` | 同一「账号+IP」允许的连续登录失败次数 |
| `OWCP_LOGIN_LOCK_SECONDS` | `900` | 达到上限后的锁定时长（秒） |
| `OWCP_LOGIN_WINDOW_SECONDS` | `900` | 失败计数窗口；窗口过期才清零 |

---

## 二、接入 ZCode 客户端

### 1. 后台生成令牌

登录 → **ZCode 客户端配置** → 「生成令牌」→ 复制明文（**只显示一次**）。

### 2. 配置到客户端

```bash
export ZCODE_REMOTE_CONFIG_URL=http://your-server:8787/v1/client-config
export ZCODE_REMOTE_CONFIG_TOKEN=<刚才生成的令牌>
pnpm dev:desktop
```

客户端启动时会拉取配置，日志出现：

```
[main] [hx] remote config applied (source=remote)
```

### 3. 生效范围

| 后台改动 | 生效 | 说明 |
|---|---|---|
| 插件市场源 | 重启后 | 追加到市场列表 |
| 隐藏分类 | 重启后 | 市场页面不再显示这些分区 |
| 组织 / 品牌文案 | 重启后 | 安装包身份不受影响 |
| 插件清单 | 重启后 | 客户端从 `/v1/marketplace.json` 拉取 |

**不需要重新打包。**

---

## 三、页面

| 页面 | 作用 |
|---|---|
| **概览** | 总量统计、分类分布、最近操作、清单版本 |
| **专家管理** | 专家 = 角色提示词 + 插件白名单 + 技能白名单 + 权限档位 + 授权范围 |
| **插件管理** | 注册 MCP Server（传输方式 / 端点 / 认证），一键探测连通性 |
| **技能商城** | 上传或粘贴 SKILL.md，版本化管理，发布/下线 |
| **模型与供应商** | 供应商管真实后端（地址 + 密钥），别名管员工看到的「标准 / 高级」 |
| **用户与权限** | 三种角色：管理员 / 发布者 / 成员；停用即令牌失效 |
| **审计日志** | 谁在什么时候改了什么，含来源 IP |
| **下发配置** | 客户端接入文件、策略开关、清单预览 |
| **ZCode 客户端配置** | 组织与品牌、市场分类开关、自有市场源、接入令牌 |

---

## 四、核心设计

### 1. 白名单就是安全边界

专家的 `pluginIds` / `skillIds` 是硬白名单，模型再强也只能调配给它的东西。这是这个后台存在的首要理由。

### 2. 市场清单自动生成

「插件管理」里状态为 `enabled`、可见性非 `admin` 的插件，自动转成 ZCode 可消费的 `marketplace.json`：

```json
GET /v1/marketplace.json
{
  "name": "hx-plugins",
  "owner": { "name": "和信智慧应急", "url": "..." },
  "plugins": [
    { "name": "oa-system", "source": "./plugins/oa-system", "category": "办公协同" }
  ]
}
```

若该插件已上传 zip 包，`source` 自动升级为可下载的远程包：

```json
{
  "name": "oa-system",
  "version": "2.3.1",
  "category": "办公协同",
  "source": {
    "source": "url",
    "type": "zip",
    "url": "http://your-server:8787/v1/packages/plg_xxx/oa-system-2.3.1.zip",
    "sha256": "f17bb477...973c9",
    "size": 2808
  }
}
```

客户端据此直接下载、校验 sha256、解压安装。运营只需在后台维护插件与包，不用手写 JSON。

### 2.1 插件包规范（上传前必读）

ZCode 安装插件时**强制要求包内存在清单文件**，否则报 `plugin_manifest_not_found`。包结构与清单示例：

```
oa-system.zip
└── oa-system/                  # 单层目录会被自动剥离
    ├── .zcode-plugin/
    │   └── plugin.json         # 必需
    └── skills/
        └── oa-approval/
            └── SKILL.md
```

```json
{
  "name": "oa-system",
  "version": "2.3.1",
  "description": "连接和信内网 OA 协同办公系统",
  "author": { "name": "和信智慧应急" },
  "license": "MIT",
  "skills": "skills",
  "mcpServers": {
    "oa": {
      "type": "http",
      "url": "https://oa.hx.local/mcp",
      "headers": { "Authorization": "Bearer ${user_config.oa_token}" }
    }
  },
  "userConfig": {
    "oa_token": { "type": "string", "title": "OA 访问令牌", "sensitive": true }
  }
}
```

约束（后台上传时逐条校验，不合规直接拒收）：

| 校验项 | 规则 |
|---|---|
| 清单存在 | `.zcode-plugin/plugin.json` 或 `.claude-plugin/plugin.json` 或 `.codex-plugin/plugin.json` |
| 清单合法 | 必须是 JSON 对象，`name` 匹配 `^[a-z0-9][a-z0-9._-]{0,127}$` |
| 名称一致 | 清单 `name` 必须与后台插件「标识」完全相同，否则安装后名称对不上 |
| 版本 | 以清单 `version` 为准，落盘文件名也用它 |
| 大小 | ≤ 50 MB |

> `mcpServers` 里引用 `user_config` 的变量时，客户端未配置该项会导致 MCP Server 不注册
> （`mcp: none` + `plugin_variable_missing` 诊断）。需要用户先填令牌；无敏感配置的插件
> 可省略 `userConfig`，MCP 会直接注册。

### 2.2 专家（数字员工）如何下发到客户端

后台的「专家」不是另一个概念，它就是**编译成插件包的数字员工**：

| 后台字段 | 编译产物 |
|---|---|
| 角色提示词 `rolePrompt` | `agents/<专家key>.md` 的正文 |
| 权限档位 `permissionMode` | 同文件 frontmatter 的 `permissionMode` |
| 模型 `modelProvider/modelName` | 同文件 frontmatter 的 `model`（internal 则留空继承） |
| 技能白名单 `skillIds` | 包内 `skills/<技能key>/SKILL.md`，**白名单外不打包** |
| 插件白名单 `pluginIds` | 同文件 `mcpServers` 列表 + 市场清单 `dependencies` |

权限档位映射（`permissionMode` 是安全语义的核心，插件 agent 只能收紧父会话，不会再放宽）：

| 后台档位 | ZCode permissionMode | 含义 |
|---|---|---|
| `read_only` | `plan` | 只读，只能查看检索 |
| `confirm_write` | `default` | 写操作需确认 |
| `full` | `bypassPermissions` | 完全授权 |

**白名单即包内容**：技能没授权就不会进包，MCP 没授权就不会出现在 `mcpServers` 里。
这比运行时校验更硬——客户端拿到的包里根本没有多余能力。

操作路径：**专家管理 → 行尾「发布」按钮**（或 `POST /api/experts/:id/publish`）。
发布后自动登记为一个市场插件，客户端装它时会因为 `dependencies` 自动带上所需的 MCP 插件。

> 约束：专家 `key` 同时是插件名，必须匹配 `^[a-z0-9][a-z0-9._-]{0,127}$`。
> 只有 `status = enabled` 且已上传包的 MCP 插件才会进入 `dependencies`——缺包的依赖会让安装整体失败，所以自动跳过。

### 2.3 专家与技能的导入导出

导出的是**可移植定义**，不是编译产物：换一套库、换一个租户也能落地。

```jsonc
// <key>.expert.json
{
  "kind": "hxai.expert",
  "version": 1,
  "exportedAt": "2026-11-06T00:00:00.000Z",
  "expert": {
    "key": "contract-reviewer", "name": "合同审查专员",
    "roleTitle": "...", "emoji": "📄", "summary": "...", "rolePrompt": "...",
    "version": "1.0.0",
    "model": { "provider": "internal", "name": "deepseek-v3" },
    "permissionMode": "read_only",
    "pluginKeys": ["oa-system"], "skillKeys": ["contract-risk-checklist"],
    "visibility": "all",
    "grants": [{ "subjectType": "department", "subjectId": "dept_xxx" }]
  }
}
```

- 插件/技能/授权对象一律用 **key / subjectId** 引用，不落库 id；导入时按 key 重新解析。
- key 冲突时改名 `base-import-xxxx` 并在响应 `keyRemapped: true`；解析不到的引用不阻断导入，只在 `missingPlugins` / `missingSkills` 回报。
- 导入结果一律 `draft`，必须人工确认后再发布，避免把外部定义直接推进市场。
- 版本号 `version > 1` 的包直接拒绝（「请升级后台后再导入」），保证旧服务不会误解新字段。

技能导出为**客户端原生 `SKILL.md`**，frontmatter 只写客户端认识的 `name` / `description`，运营字段 `version` / `category` / `trigger` 也放在 frontmatter 里；导入同时接受裸 markdown 与 `{ "kind": "hxai.skill", "version": 1, "skill": { ... } }`。



### 3. 配置下发是幂等的

客户端把配置写入 `process.env` 供 Host / Agent / 插件市场播种读取，同时落盘 `~/.zcode/hx-remote-config.json` 作为离线兜底。服务不可用时降级到缓存，**不影响用户打开应用**。

### 4. 优先级

```
构建期环境变量  >  远程下发配置  >  上游默认值
```

构建期优先，因为它代表「这一版产品确实如此」；远程配置只做运营微调。

### 5. 模型别名是对外契约

员工只看到「标准 / 高级」，真实模型名和上游密钥都不出服务端。换模型、换供应商、轮换密钥，客户端不用动。

### 6. 模型怎么下发到客户端

后台模型页右上角 **「下发给客户端」** 打开抽屉，里面是照抄就能用的内容：下发地址、网关令牌、
环境变量块、模型别名清单、完整 JSON（可下载）、令牌轮换按钮。

客户端只需两个环境变量：

```bash
ZCODE_REMOTE_PROVIDER_CONFIG_URL=https://<后台地址>/v1/provider-config.json
ZCODE_REMOTE_CONFIG_TOKEN=owg_xxxxxxxx
```

启动时 `fetchRemoteProviderConfig` 会拉取并原子写入 `provider_config.json`
（临时文件 + rename，不会写坏半份配置）。

**两种模式**：

| | 网关模式（默认） | 直连模式（`?direct=1`） |
|---|---|---|
| `apiKey` | `owg_…` 网关令牌 | 真实上游密钥 |
| `baseUrl` | `{后台地址}/v1/llm/<providerKey>` | 供应商自己的地址 |
| 模型名 | 只有别名（`std`/`pro`） | 真实模型名 |
| 谁能拉 | 网关令牌或登录会话 | 仅客户端令牌 |
| 用途 | 交付给最终用户 | 内网排障 |

三条不变量（改代码时不能破）：

1. **网关模式下客户端只能看到别名**——真实模型名会暴露选型，也挡住了换模型的自由度。
   `defaultModelSelection.modelId` 必须与 `personalModelIds` 同一命名空间，否则客户端选中项匹配不到。
2. **网关令牌换不到上游密钥**——`?direct=1` 只认 `client_tokens`，拿网关令牌访问返回 401。
3. **配置端点不能匿名**——它下发的是能烧上游额度的令牌。

`provider_config.json` 是 **zod strict schema**，多一个字段整份拒绝；
`schemaVersion` 在顶层，`modelConfigRules` 的 `providerModelRules` 和
`manualProviderModelRules` 两个数组必须都在。完整形状见 `docs/hx/改造记录.md` 第 10.7 节。

**轮换令牌**：`POST /api/provider-config/rotate-token`（admin）。
旧令牌立即失效，没有新旧并行窗口——并行窗口意味着「已泄露的令牌还能再用一会儿」。
轮换后已下发的客户端需要重新同步配置。

**验证**（后台需已启动）：

```bash
node scripts/e2e-model-gateway.mjs              # 42 项，完整链路（自己起 mock 上游，跑完还原）
SKIP_DB=1 node scripts/e2e-model-gateway.mjs    # 只验结构与鉴权，不改数据库
```

---

## 五、数据模型

```
users           账号（scrypt 口令散列，role: admin|publisher|member）
sessions        会话（jti 主键，可撤销）
plugins         插件 = MCP Server 注册项
skills          技能 = SKILL.md 全文 + 版本 + 状态
experts         专家 = 角色提示词 + 插件/技能白名单 + 权限档位
grants          授权范围（department / role / user）
llm_providers   模型供应商（base_url + api_key，密钥仅服务端）
model_aliases   模型别名（name/badge → provider_ref + target_model）
client_tokens   ZCode 客户端接入令牌（仅存 SHA-256）
audit_logs      审计（带 prev_hash/hash 哈希链）
login_attempts  登录失败计数（按「账号+IP」组合，用于限流锁定）
settings        组织名、下发策略、ZCode 客户端配置
handoffs        桌面端一次性登录码
```

权限三档：`read_only`（只读）/ `confirm_write`（写需确认）/ `full`（完全授权）。

---

## 六、接口

### 管理接口（`/api/`，需 Bearer 或会话 Cookie）

沿用原 control-plane 的 70 条路由（专家 / 插件 / 技能 / 模型 / 用户 / 审计）。

新增 ZCode 相关：

| 方法 | 路径 | 说明 | 最低角色 |
|---|---|---|---|
| GET | `/api/client-config` | 读取当前配置 | 登录 |
| PATCH | `/api/client-config` | 保存配置 | publisher |
| POST | `/api/client-config/token` | 生成客户端令牌 | admin |
| GET | `/api/client-config/tokens` | 令牌列表 | 登录 |
| DELETE | `/api/client-config/tokens/:id` | 撤销令牌 | admin |

### 客户端接口（`/v1/`）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/v1/client-config` | **ZCode 客户端启动时拉取**（Bearer） |
| GET | `/v1/marketplace.json` | 插件市场清单 |
| GET | `/v1/packages/:id/:file` | 插件包下载（供客户端安装） |
| GET | `/v1/provider-config.json` | **模型配置下发**（需网关令牌或登录；`?direct=1` 只认客户端令牌） |
| GET | `/v1/llm/:providerKey/models` | 网关：模型列表（只返回别名） |
| POST | `/v1/llm/:providerKey/chat/completions` | 网关：对话（别名在此解析成真实模型） |
| GET | `/v1/system/health` | 健康检查 |

| GET | `/api/audit` | 审计列表（支持 `action` / `actor` / `since` 过滤） | 登录 |
| GET | `/api/audit/verify` | 校验哈希链完整性，返回第一条断裂记录 | admin |

### 模型下发管理

| 方法 | 路径 | 说明 | 最低角色 |
|---|---|---|---|
| GET | `/api/provider-config/preview` | 三份配置：展示用 / 直连 / 真正下发 | 登录 |
| POST | `/api/provider-config/rotate-token` | 轮换网关令牌（旧令牌立即失效） | admin |

### 插件包管理

| 方法 | 路径 | 说明 | 最低角色 |
|---|---|---|---|
| POST | `/api/plugins/:id/package` | 上传 zip（`Content-Type: application/zip`，≤50MB），校验清单并算 sha256 | publisher |

### 专家下发

| 方法 | 路径 | 说明 | 最低角色 |
|---|---|---|---|
| GET | `/api/experts/:id/package/preview` | 预览编译结果（包内文件、技能、MCP、权限映射） | 登录 |
| GET | `/api/experts/:id/package` | 下载编译好的插件包 zip | 登录 |
| POST | `/api/experts/:id/publish` | 编译并登记进市场（自动注入 `dependencies`） | publisher |
| GET | `/api/experts/:id/export` | 导出可移植专家包 `<key>.expert.json` | 登录 |
| POST | `/api/experts/import` | 导入专家包（JSON 原文，key 冲突自动改名） | publisher |

### 技能导入导出

| 方法 | 路径 | 说明 | 最低角色 |
|---|---|---|---|
| GET | `/api/skills/:id/export` | 导出原生 `SKILL.md`（frontmatter 带 name/description/version/category/trigger） | 登录 |
| POST | `/api/skills/import` | 导入 `SKILL.md` 或 `{kind:"hxai.skill"}` JSON 包 | publisher |

---

## 七、安全说明

| 项 | 做法 |
|---|---|
| 口令 | `scrypt`（N=16384, keylen=64）+ 16 字节随机盐，`timingSafeEqual` |
| 会话 | HMAC-SHA256 签名，载荷含 `jti`，服务端可撤销 |
| 登录限流 | 同一「账号 + IP」连续失败 5 次锁 15 分钟（落库，重启不失效）；锁定期先拒后验，不发口令探测的机会 |
| CSRF | Cookie 认证的写操作校验 `Origin`/`Referer` 同源；Bearer 请求免疫（浏览器不自动带 `Authorization`） |
| 审计防篡改 | 每行存 `prev_hash` + `hash`（sha256 链），`GET /api/audit/verify` 报告第一条断裂记录 |
| 客户端令牌 | 24 字节随机，仅存 SHA-256，明文只返回一次 |
| 密钥剥离 | 插件 `authConfig` 中的 `token/secret/password/clientSecret` 入库与下发时都丢弃 |
| 上游密钥 | 只存 `llm_providers.api_key`，接口只回掩码 |
| 网关令牌 | `owg_…` 存 `settings`；能调模型但**换不到**上游密钥（`?direct=1` 拒绝） |
| 越权 | 成员不能写；发布者不能删；只有管理员能管账号 |
| 传输 | 默认只绑 `127.0.0.1`。对外必须挂 HTTPS 反代 |

### 6.1 登录限流为什么按「账号 + IP」

只按账号锁：攻击者用脚本对 `admin` 连续试错，就能把管理员锁在门外——拿 DoS 换暴力破解。
按「账号 + IP」组合锁：正常用户从自己的 IP 登录不受别人攻击影响，而攻击者换 IP 就要重新攒失败次数。

计数落库（`login_attempts` 表）而不是内存 Map：内存方案一重启就清零，等于给攻击者一个绕过手段。
键是 `账号\0IP` 的 sha256，库里不堆明文 IP。

锁定期过了但失败窗口没过时**不自动解锁**——否则「锁 15 分钟」会变成「每 15 分钟白送 5 次机会」。
只有整个窗口过期才清零。

可调：`OWCP_LOGIN_MAX_FAILURES`（默认 5）、`OWCP_LOGIN_LOCK_SECONDS`（默认 900）、
`OWCP_LOGIN_WINDOW_SECONDS`（默认 900）。

### 6.2 CSRF 只保护 Cookie 会话

前端主路径用 `localStorage` + `Authorization: Bearer`，这类请求天然免疫 CSRF（浏览器不会替第三方站点
自动附加该头）。风险在 Cookie 兜底路径上：Cookie 会被浏览器自动带上，所以只要请求是靠 Cookie 认出用户的，
写操作就必须同源。

判据优先 `Origin`，缺失时回退 `Referer`；两者都没有则放行（curl/脚本，不存在被借用的浏览器身份）。
允许列表 = 请求自身 `Host` 的 origin + `OWCP_PUBLIC_BASE_URL` 的 origin（反代会改写 `Host`，两者可能不同）。

### 6.3 审计哈希链能证明什么

`hash = sha256(prev_hash ␀ actor_id ␀ actor_name ␀ action ␀ target_* ␀ detail ␀ ip ␀ created_at)`。
改字段、删行、插行都会让后续 `prev_hash` 对不上，`/api/audit/verify` 直接给出断裂的 `id`。

**它防的是「改了没痕迹」，不是「有库写权限的人」**——对方能重算整条链。要做真正的防伪造，
得把链头定期锚到外部（另一套日志系统 / 定时邮件摘要 / 对象存储的不可变桶）。

启用时会对已有记录做一次性封链（`sealAuditChain()`，幂等），启动日志会打印补了多少条。
封链本身无法证明历史未被改过，所以**取证有效性从封链那一刻开始**。


---

## 八、目录

```
legacy-node/
├── src/
│   ├── server.mjs          入口
│   ├── http.mjs            路由 + 静态资源
│   ├── api.mjs             业务路由 + 配置下发 + 市场清单生成
│   ├── auth.mjs            会话与角色校验
│   ├── crypto.mjs          scrypt 口令 + HMAC 令牌
│   ├── db.mjs              建表 + 演示数据
│   ├── zip.mjs             ZIP 读写 + 插件清单校验（无第三方依赖）
│   ├── expert-package.mjs  专家 → ZCode 插件包编译
│   └── config.mjs          配置
├── public -> ../../frontend  管理界面（原生 HTML/CSS/JS，无构建）
├── scripts/                自测与工具脚本
│   ├── smoke-test.mjs          功能自测（133 项，含权限/裁剪/审计/限流/CSRF）
│   ├── e2e-marketplace.mjs     插件与专家下发链路（34 项）
│   ├── e2e-model-gateway.mjs   模型下发 + 网关链路（42 项，自带 mock 上游 + 真实客户端拉取）
│   └── mock-upstream.mjs       手工联调用的最小 OpenAI 兼容服务
└── data/                   SQLite 库（运行时生成，软链到 ~/.hxai-data/admin-console）
    └── packages/<插件id>/   上传的插件 zip
```

---

## 八、踩过的坑

记下来避免重复交学费。

### 1. 空串不是 NULL

专家编译出的插件包只有 agent/skill，没有 MCP 端点。早期落库时 `endpoint` 写成 `""`，
而市场筛选用的是 `endpoint IS NOT NULL` —— 空串能通过，于是 3 个数字员工混进了插件市场
（市场 9 条 vs 连接器 6 条）。

修法是双管齐下：写入侧写 `null`，读取侧统一用 `CONNECTOR_PLUGIN_WHERE`
（`endpoint IS NOT NULL AND TRIM(endpoint) <> ''`），并对历史数据做一次性归一。
回归脚本加了「插件市场里不含数字员工」的断言——不只是数量相等，而是集合相等。

**教训**：同一语义在 SQL 和 JS 里各写一遍必然分叉。`r.endpoint &&` 和
`endpoint IS NOT NULL` 看着等价，实际不等价。

### 2. `audit(user, …)` 与 `audit(ctx, …)`

`audit()` 的第一个参数是**请求上下文**，但它内部取的是 `ctx.user`。
有几处误传了 `requireRole()` 的返回值（用户对象），于是 `actor_id` 恒为 null、
`actor_name` 落到「系统」——审计里看不出是谁做的，而且不报错，很难发现。

修法：所有调用点统一传 `ctx`，并让 `audit()` 同时兼容两种形状。
历史记录无法诚实地补归属，所以回归断言只校验**本次运行新写**的记录（`/api/audit?since=<启动时刻>`）。

### 3. 加列必须走 `ensureColumn`

`CREATE TABLE IF NOT EXISTS` 对已存在的表**不会**补新列。审计哈希链的 `prev_hash`/`hash`
第一次上线时就是这么炸的：代码写好了，老库启动直接 `no such column: hash`。

凡是给已有表加字段，都要在 `ensureColumn(...)` 里登记一行，并保证回填逻辑幂等。
新建库走 `SCHEMA`，老库走 `ensureColumn`，两条路径都要能跑通。

**教训**：迁移逻辑不能只在「全新安装」下验证。测试时用老库跑一遍，比读十遍代码有用。

### 4. 临时环境变量会污染后续测试

调试下发地址时用 `OWCP_PUBLIC_BASE_URL=https://ai.hx.local` 起了一次后台，忘了改回来。
之后跑 `e2e-marketplace.mjs` 就在「下载插件包」这一步炸了——清单里的下载地址指向一个
解析不了的内网域名。表面看是脚本挂了，实际是**服务进程带着测试配置在跑**。

**教训**：改过环境变量重启服务后，要么记下来，要么立刻还原。测试脚本现在会在下载失败时
直接提示「请确认 `OWCP_PUBLIC_BASE_URL` 与 `BASE` 指向同一地址」，而不是抛一个 ECONNRESET 堆栈。

---

## 九、来源与许可

本服务最初为 OpenWork 控制面（`openwork-mit/control-plane`）编写，现改造为 ZCode 版：

- **保留**：用户 / 会话 / RBAC / 审计 / 插件 / 技能 / 专家 / 模型别名（全部自研）
- **移除**：OpenWork 专有的 20+ 个 `/v1/*` 兼容接口
- **新增**：`/v1/client-config`、`/v1/marketplace.json`、客户端令牌管理、ZCode 配置页

代码自有，无第三方许可约束。
