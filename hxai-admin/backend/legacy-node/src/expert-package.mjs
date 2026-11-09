/**
 * 专家 → ZCode 插件包 编译
 *
 * 后台的「数字员工（专家）」= 角色提示词 + 插件白名单 + 技能白名单 + 权限档位。
 * 这个组合在 ZCode 客户端里正好对应一个插件：
 *
 *   专家 role_prompt        →  agents/<key>.md 的正文（子代理系统提示词）
 *   专家 permission_mode    →  agents/<key>.md 的 permissionMode
 *   专家的技能白名单        →  包内 skills/<skill>/SKILL.md（只打包被授权的）
 *   专家的插件白名单        →  agents/<key>.md 的 mcpServers（只挂被授权的 MCP）
 *
 * 好处：客户端零改造。市场清单本来就能装插件，专家作为插件下发即可，
 * 且白名单天然变成「包内有什么就只能用什么」——比运行时再校验更硬。
 *
 * 边界：插件不能限制 agent 的 tools（bash/edit 等内置工具由 permissionMode 收窄），
 * 所以 permissionMode 的映射是安全语义的核心，必须显式声明。
 */
import { createHash } from "node:crypto";
import { createZip, PLUGIN_NAME_PATTERN } from "./zip.mjs";

/** 后台三档权限 → ZCode agent permissionMode（插件 agent 只能收紧父会话，不会再放宽）。 */
const PERMISSION_MODE_MAP = {
  read_only: "plan",
  confirm_write: "default",
  full: "bypassPermissions",
};

/** 后台权限档位 → 中文说明，写进 agent 描述末尾，便于用户在客户端理解边界。 */
const PERMISSION_LABEL = {
  read_only: "只读：只能查看与检索，不能改动任何内容",
  confirm_write: "写操作需确认：每次修改前会征询你的同意",
  full: "完全授权：可直接执行写操作",
};

const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/u;

/**
 * 把一条 skill 记录的 content（SKILL.md 全文）规范化。
 * 后台允许只填正文，此时补 frontmatter——否则客户端解析不出 name/description，技能不会被触发。
 */
function normalizeSkillMarkdown(skill) {
  const content = String(skill.content || "").trim();
  const hasFrontmatter = /^---\r?\n/u.test(content);
  if (hasFrontmatter) return content;
  const description = String(skill.trigger_desc || skill.summary || skill.name || "").trim();
  // description 必须单行，YAML 里换行会破坏 frontmatter。
  const oneLine = description.replace(/\s*\r?\n\s*/gu, " ").trim();
  return [
    "---",
    `name: ${skill.key}`,
    `description: ${JSON.stringify(oneLine || skill.name || skill.key)}`,
    "---",
    "",
    content,
    "",
  ].join("\n");
}

function yamlScalar(value) {
  return JSON.stringify(String(value ?? ""));
}

/**
 * 生成 agent markdown。
 * 字段依据 ZCode 的 subagent frontmatter 解析器（packages/shared/src/subagent-profile-parser.ts）：
 * name / description 必填；model 用 `provider/model` 形式；permissionMode 取六个合法值之一。
 */
function buildAgentMarkdown(expert, { mcpServerNames }) {
  const permission = PERMISSION_MODE_MAP[expert.permissionMode] || "default";
  const roleDesc = String(expert.summary || expert.roleTitle || expert.name || expert.key).trim();
  const desc = `${roleDesc}（${PERMISSION_LABEL[expert.permissionMode] || "权限按默认"}）`
    .replace(/\s*\r?\n\s*/gu, " ")
    .trim();

  const lines = [
    "---",
    `name: ${expert.key}`,
    `description: ${yamlScalar(desc)}`,
    `permissionMode: ${permission}`,
  ];

  // model 只在后台配了具体模型时写；留空表示继承父会话选择的模型。
  const provider = String(expert.modelProvider || "").trim();
  const model = String(expert.modelName || "").trim();
  if (provider && model && provider !== "internal") {
    lines.push(`model: ${yamlScalar(`${provider}/${model}`)}`);
  }

  if (mcpServerNames.length > 0) {
    // 子代理只能引用「父会话里已注册」的 MCP server 名，这里写的是全名（plugin:xxx:yyy）。
    lines.push(`mcpServers: [${mcpServerNames.map((n) => JSON.stringify(n)).join(", ")}]`);
  }

  lines.push("---", "", String(expert.rolePrompt || "").trim(), "");
  return lines.join("\n");
}

/**
 * 编译一个专家为插件包。
 *
 * @param {object} input
 * @param {object} input.expert      专家记录（含 rolePrompt / permissionMode / modelProvider / modelName）
 * @param {Array}  input.skills      该专家被授权的技能记录
 * @param {Array}  input.plugins     该专家被授权的插件记录（用来生成 mcpServers 白名单）
 * @param {boolean} input.includeAgents 是否携带 agents/<key>.md（默认 true）
 * @returns {{ buffer: Buffer, fileName: string, sha256: string, summary: object }}
 */
export function compileExpertPackage(input) {
  const expert = input.expert;
  const skills = Array.isArray(input.skills) ? input.skills : [];
  const plugins = Array.isArray(input.plugins) ? input.plugins : [];

  // 插件包名 = 专家 key，客户端里会显示为 <砖家名>@<市场名>
  const pluginName = String(expert.key || "").trim();
  if (!PLUGIN_NAME_PATTERN.test(pluginName)) {
    throw new Error(
      `专家标识「${pluginName}」不能直接用作插件名，需匹配 ${PLUGIN_NAME_PATTERN}（小写字母/数字开头，只含 a-z0-9._-）`
    );
  }

  const files = [];
  const skillNames = [];

  for (const skill of skills) {
    const key = String(skill.key || "").trim();
    if (!SKILL_NAME_PATTERN.test(key)) continue;
    const markdown = normalizeSkillMarkdown(skill);
    files.push({ name: `${pluginName}/skills/${key}/SKILL.md`, data: markdown });
    skillNames.push(key);
  }

  // MCP 白名单：只登记启用的插件，且必须有可用的服务名。
  const mcpServerNames = [];
  const mcpDeclarations = {};
  for (const plugin of plugins) {
    if (!plugin || plugin.status !== "enabled") continue;
    const key = String(plugin.key || "").trim();
    if (!SKILL_NAME_PATTERN.test(key)) continue;
    // 插件 MCP 的命名空间是 plugin:<插件名>:<server 名>；后台一个插件对应一个 server。
    const serverName = key;
    mcpServerNames.push(`plugin:${key}:${serverName}`);
    mcpDeclarations[key] = { type: "plugin", plugin: key };
  }

  const agentMarkdown = buildAgentMarkdown(expert, { mcpServerNames });
  files.push({ name: `${pluginName}/agents/${pluginName}.md`, data: agentMarkdown });

  const manifest = {
    name: pluginName,
    version: String(expert.version || "1.0.0"),
    description: String(expert.summary || expert.roleTitle || expert.name || pluginName)
      .replace(/\s*\r?\n\s*/gu, " ")
      .trim(),
    author: { name: String(expert.owner || "和信智慧应急") },
    license: "UNLICENSED",
    keywords: ["expert", "digital-worker"],
    agents: "agents",
    ...(skillNames.length > 0 ? { skills: "skills" } : {}),
  };

  files.push({
    name: `${pluginName}/.zcode-plugin/plugin.json`,
    data: JSON.stringify(manifest, null, 2) + "\n",
  });

  const buffer = createZip(files);
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const safeVersion = String(manifest.version).replace(/[^0-9A-Za-z._-]/g, "_").slice(0, 40);

  return {
    buffer,
    fileName: `${pluginName}-${safeVersion}.zip`,
    sha256,
    summary: {
      pluginName,
      version: String(manifest.version),
      agent: `${pluginName}/${pluginName}.md`,
      skillCount: skillNames.length,
      skills: skillNames,
      mcpServerNames,
      permissionMode: PERMISSION_MODE_MAP[expert.permissionMode] || "default",
      size: buffer.length,
    },
  };
}

export { PERMISSION_MODE_MAP };
