package service

import (
	"encoding/json"
	"strings"
	"time"

	"github.com/hx/control-plane/internal/model"
	"github.com/hx/control-plane/internal/platform/apperr"
	"github.com/hx/control-plane/internal/platform/ids"
)

// 技能导出成客户端原生的 SKILL.md（frontmatter 带 name/description），
// 额外用 version/category/trigger 记住运营侧元数据；导入同时接受 JSON 包与裸 markdown。

const skillTransferKind = "hxai.skill"

var skillKeyPattern = PluginNamePattern

type skillTransferPayload struct {
	Key      string `json:"key"`
	Name     string `json:"name"`
	Summary  string `json:"summary"`
	Category string `json:"category"`
	Version  string `json:"version"`
	Trigger  string `json:"trigger"`
	Content  string `json:"content"`
}

type skillTransferBundle struct {
	Kind       string               `json:"kind"`
	Version    int                  `json:"version"`
	ExportedAt string               `json:"exportedAt"`
	Skill      skillTransferPayload `json:"skill"`
}

type SkillImportResult struct {
	Skill       SkillView `json:"skill"`
	OriginalKey string    `json:"originalKey"`
	KeyRemapped bool      `json:"keyRemapped"`
}

func stripFrontmatter(text string) (map[string]string, string) {
	normalized := strings.ReplaceAll(text, "\r\n", "\n")
	if !strings.HasPrefix(normalized, "---\n") {
		return map[string]string{}, normalized
	}
	rest := normalized[4:]
	idx := strings.Index(rest, "\n---")
	if idx < 0 {
		return map[string]string{}, normalized
	}
	header := rest[:idx]
	body := strings.TrimPrefix(rest[idx+4:], "\n")
	meta := map[string]string{}
	for _, line := range strings.Split(header, "\n") {
		parts := strings.SplitN(line, ":", 2)
		if len(parts) != 2 {
			continue
		}
		key := strings.TrimSpace(parts[0])
		value := strings.TrimSpace(parts[1])
		if strings.HasPrefix(value, "\"") {
			var decoded string
			if json.Unmarshal([]byte(value), &decoded) == nil {
				value = decoded
			}
		}
		if key != "" {
			meta[key] = value
		}
	}
	return meta, body
}

func buildSkillMarkdown(payload skillTransferPayload) string {
	description := strings.TrimSpace(payload.Trigger)
	if description == "" {
		description = strings.TrimSpace(payload.Summary)
	}
	if description == "" {
		description = payload.Name
	}
	lines := []string{
		"---",
		"name: " + payload.Key,
		"description: " + yamlScalar(collapseWhitespace(description)),
		"version: " + yamlScalar(expertVersion(payload.Version)),
		"category: " + yamlScalar(valueOrDefault(strings.TrimSpace(payload.Category), "通用")),
	}
	if trigger := strings.TrimSpace(payload.Trigger); trigger != "" {
		lines = append(lines, "trigger: "+yamlScalar(collapseWhitespace(trigger)))
	}
	lines = append(lines, "---", "", strings.TrimSpace(payload.Content), "")
	return strings.Join(lines, "\n")
}

func ExportSkill(d Deps, skillID string) (string, []byte, error) {
	var row model.Skill
	if err := d.DB.Where("id = ?", skillID).Take(&row).Error; err != nil {
		return "", nil, apperr.NotFound("技能不存在")
	}
	payload := skillTransferPayload{
		Key:      row.Key,
		Name:     row.Name,
		Summary:  derefString(row.Summary),
		Category: derefString(row.Category),
		Version:  row.Version,
		Trigger:  derefString(row.TriggerDesc),
		Content:  row.Content,
	}
	return row.Key + ".md", []byte(buildSkillMarkdown(payload)), nil
}

func parseSkillTransfer(raw []byte) (*skillTransferPayload, error) {
	trimmed := strings.TrimSpace(string(raw))
	if strings.HasPrefix(trimmed, "{") {
		var envelope struct {
			Kind    string                `json:"kind"`
			Version json.Number           `json:"version"`
			Skill   *skillTransferPayload `json:"skill"`
		}
		decoder := json.NewDecoder(strings.NewReader(trimmed))
		decoder.UseNumber()
		if err := decoder.Decode(&envelope); err != nil {
			return nil, apperr.Bad("导入文件不是合法 JSON")
		}
		if envelope.Kind != "" && envelope.Kind != skillTransferKind {
			return nil, apperr.Bad("导入文件不是技能包")
		}
		if v, err := envelope.Version.Int64(); err == nil && v > 1 {
			return nil, apperr.Bad("技能包版本过新，请升级后台后再导入")
		}
		if envelope.Skill != nil {
			return envelope.Skill, nil
		}
		var flat skillTransferPayload
		decoder = json.NewDecoder(strings.NewReader(trimmed))
		decoder.UseNumber()
		if err := decoder.Decode(&flat); err != nil {
			return nil, apperr.Bad("导入文件不是合法 JSON")
		}
		return &flat, nil
	}

	meta, body := stripFrontmatter(trimmed)
	payload := skillTransferPayload{
		Key:      meta["name"],
		Summary:  meta["description"],
		Category: meta["category"],
		Version:  meta["version"],
		Trigger:  meta["trigger"],
		Content:  strings.TrimSpace(body),
	}
	if h1 := firstHeading(payload.Content); h1 != "" {
		payload.Name = h1
	}
	if payload.Name == "" {
		payload.Name = payload.Key
	}
	return &payload, nil
}

func firstHeading(markdown string) string {
	for _, line := range strings.Split(markdown, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "# ") {
			return strings.TrimSpace(strings.TrimPrefix(line, "# "))
		}
	}
	return ""
}

func ImportSkill(d Deps, actor *Actor, raw []byte) (*SkillImportResult, error) {
	if len(strings.TrimSpace(string(raw))) == 0 {
		return nil, apperr.Bad("导入内容不能为空")
	}
	payload, err := parseSkillTransfer(raw)
	if err != nil {
		return nil, err
	}
	content := strings.TrimSpace(payload.Content)
	name := strings.TrimSpace(payload.Name)
	if name == "" {
		name = strings.TrimSpace(payload.Key)
	}
	missing := []string{}
	if name == "" {
		missing = append(missing, "name")
	}
	if content == "" {
		missing = append(missing, "content")
	}
	if len(missing) > 0 {
		return nil, apperr.Bad("技能包缺少必填字段："+joinFields(missing), map[string]any{"missing": missing})
	}

	originalKey := strings.TrimSpace(payload.Key)
	base := originalKey
	if !skillKeyPattern.MatchString(base) {
		base = slugify(originalKey)
	}
	if base == "" {
		base = slugify(name)
	}
	if base == "" {
		base = "skill"
	}
	key := base
	remapped := false
	for attempt := 0; attempt < 20; attempt++ {
		var count int64
		d.DB.Table("skills").Where("`key` = ?", key).Count(&count)
		if count == 0 {
			break
		}
		remapped = true
		key = base + "-import-" + randomSuffix(4)
	}

	now := time.Now().UTC()
	row := model.Skill{
		ID:          ids.New("skl"),
		Key:         key,
		Name:        name,
		Summary:     sp(collapseWhitespace(payload.Summary)),
		Category:    sp(valueOrDefault(strings.TrimSpace(payload.Category), "通用")),
		Version:     expertVersion(payload.Version),
		TriggerDesc: sp(strings.TrimSpace(payload.Trigger)),
		Content:     content,
		Status:      "draft",
		Author:      sp(actor.Name()),
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if err := d.DB.Create(&row).Error; err != nil {
		return nil, err
	}
	_ = Audit(d, actor, "导入技能",
		map[string]string{"type": "skill", "id": row.ID, "name": row.Name},
		map[string]any{"from": originalKey, "key": key})
	view := toSkill(&row)
	return &SkillImportResult{Skill: view, OriginalKey: originalKey, KeyRemapped: remapped}, nil
}
