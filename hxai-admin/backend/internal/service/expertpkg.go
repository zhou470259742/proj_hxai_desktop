package service

import (
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/hx/control-plane/internal/model"
	"github.com/hx/control-plane/internal/platform/apperr"
	"github.com/hx/control-plane/internal/platform/ids"
)

// 专家 → ZCode 插件包：角色提示词写成 agent，技能白名单写成 skills/，
// 插件白名单写成 agent 的 mcpServers。客户端零改造即可消费。

var permissionModeMap = map[string]string{
	"read_only":     "plan",
	"confirm_write": "default",
	"full":          "bypassPermissions",
}

var permissionLabel = map[string]string{
	"read_only":     "只读：只能查看与检索，不能改动任何内容",
	"confirm_write": "写操作需确认：每次修改前会征询你的同意",
	"full":          "完全授权：可直接执行写操作",
}

var skillNamePattern = PluginNamePattern

type compileExpertInput struct {
	Key            string
	Version        string
	Name           string
	RoleTitle      string
	Summary        string
	RolePrompt     string
	PermissionMode string
	ModelProvider  string
	ModelName      string
	Owner          string
}

type compileSkillInput struct {
	Key     string
	Name    string
	Summary string
	Trigger string
	Content string
}

type compilePluginInput struct {
	Key    string
	Status string
}

type compiledExpertPackage struct {
	Buffer   []byte
	FileName string
	SHA256   string
	Summary  map[string]any
}

func normalizeSkillMarkdown(skill compileSkillInput) string {
	content := strings.TrimSpace(skill.Content)
	if strings.HasPrefix(content, "---\n") || strings.HasPrefix(content, "---\r\n") {
		return content
	}
	description := strings.TrimSpace(skill.Trigger)
	if description == "" {
		description = strings.TrimSpace(skill.Summary)
	}
	if description == "" {
		description = skill.Name
	}
	oneLine := collapseWhitespace(description)
	if oneLine == "" {
		oneLine = skill.Name
	}
	quoted, _ := json.Marshal(oneLine)
	return strings.Join([]string{
		"---",
		"name: " + skill.Key,
		"description: " + string(quoted),
		"---",
		"",
		content,
		"",
	}, "\n")
}

func collapseWhitespace(value string) string {
	return strings.Join(strings.Fields(value), " ")
}

func yamlScalar(value string) string {
	encoded, _ := json.Marshal(value)
	return string(encoded)
}

func buildAgentMarkdown(expert compileExpertInput, mcpServerNames []string) string {
	permission := permissionModeMap[expert.PermissionMode]
	if permission == "" {
		permission = "default"
	}
	roleDesc := strings.TrimSpace(expert.Summary)
	if roleDesc == "" {
		roleDesc = strings.TrimSpace(expert.RoleTitle)
	}
	if roleDesc == "" {
		roleDesc = expert.Name
	}
	if roleDesc == "" {
		roleDesc = expert.Key
	}
	label := permissionLabel[expert.PermissionMode]
	if label == "" {
		label = "权限按默认"
	}
	desc := collapseWhitespace(roleDesc + "（" + label + "）")

	lines := []string{
		"---",
		"name: " + expert.Key,
		"description: " + yamlScalar(desc),
		"permissionMode: " + permission,
	}
	provider := strings.TrimSpace(expert.ModelProvider)
	model := strings.TrimSpace(expert.ModelName)
	if provider != "" && model != "" && provider != "internal" {
		lines = append(lines, "model: "+yamlScalar(provider+"/"+model))
	}
	if len(mcpServerNames) > 0 {
		quoted := make([]string, 0, len(mcpServerNames))
		for _, name := range mcpServerNames {
			quoted = append(quoted, yamlScalar(name))
		}
		lines = append(lines, "mcpServers: ["+strings.Join(quoted, ", ")+"]")
	}
	lines = append(lines, "---", "", strings.TrimSpace(expert.RolePrompt), "")
	return strings.Join(lines, "\n")
}

func compileExpertPackage(expert compileExpertInput, skills []compileSkillInput, plugins []compilePluginInput) (*compiledExpertPackage, error) {
	pluginName := strings.TrimSpace(expert.Key)
	if !PluginNamePattern.MatchString(pluginName) {
		return nil, fmt.Errorf(
			"专家标识「%s」不能直接用作插件名，需匹配 %s（小写字母/数字开头，只含 a-z0-9._-）",
			pluginName, PluginNamePattern.String(),
		)
	}

	files := []zipInput{}
	skillNames := []string{}
	for _, skill := range skills {
		key := strings.TrimSpace(skill.Key)
		if !skillNamePattern.MatchString(key) {
			continue
		}
		files = append(files, zipInput{
			Name: pluginName + "/skills/" + key + "/SKILL.md",
			Data: []byte(normalizeSkillMarkdown(skill)),
		})
		skillNames = append(skillNames, key)
	}

	mcpServerNames := []string{}
	for _, plugin := range plugins {
		if plugin.Status != "enabled" {
			continue
		}
		key := strings.TrimSpace(plugin.Key)
		if !skillNamePattern.MatchString(key) {
			continue
		}
		mcpServerNames = append(mcpServerNames, "plugin:"+key+":"+key)
	}

	files = append(files, zipInput{
		Name: pluginName + "/agents/" + pluginName + ".md",
		Data: []byte(buildAgentMarkdown(expert, mcpServerNames)),
	})

	description := strings.TrimSpace(expert.Summary)
	if description == "" {
		description = strings.TrimSpace(expert.RoleTitle)
	}
	if description == "" {
		description = expert.Name
	}
	if description == "" {
		description = pluginName
	}
	owner := strings.TrimSpace(expert.Owner)
	if owner == "" {
		owner = "HX"
	}
	version := expertVersion(expert.Version)
	manifest := map[string]any{
		"name":        pluginName,
		"version":     version,
		"description": collapseWhitespace(description),
		"author":      map[string]string{"name": owner},
		"license":     "UNLICENSED",
		"keywords":    []string{"expert", "digital-worker"},
		"agents":      "agents",
	}
	if len(skillNames) > 0 {
		manifest["skills"] = "skills"
	}
	manifestBytes, _ := json.MarshalIndent(manifest, "", "  ")
	files = append(files, zipInput{
		Name: pluginName + "/.zcode-plugin/plugin.json",
		Data: append(manifestBytes, '\n'),
	})

	buffer, err := createZip(files)
	if err != nil {
		return nil, err
	}
	fileName := pluginName + "-" + safeFileName(version) + ".zip"
	permission := permissionModeMap[expert.PermissionMode]
	if permission == "" {
		permission = "default"
	}
	return &compiledExpertPackage{
		Buffer:   buffer,
		FileName: fileName,
		SHA256:   sha256Hex(buffer),
		Summary: map[string]any{
			"pluginName":     pluginName,
			"version":        version,
			"agent":          pluginName + "/" + pluginName + ".md",
			"skillCount":     len(skillNames),
			"skills":         skillNames,
			"mcpServerNames": mcpServerNames,
			"permissionMode": permission,
			"size":           len(buffer),
		},
	}, nil
}

func compileExpertFromDB(d Deps, expertID string) (*model.Expert, *compiledExpertPackage, error) {
	var expert model.Expert
	if err := d.DB.Where("id = ?", expertID).Take(&expert).Error; err != nil {
		return nil, nil, apperr.NotFound("专家不存在")
	}
	pluginIDs := parseStringArray(expert.PluginIDsJSON)
	skillIDs := parseStringArray(expert.SkillIDsJSON)

	plugins := []model.Plugin{}
	if len(pluginIDs) > 0 {
		d.DB.Where("id IN ?", pluginIDs).Find(&plugins)
	}
	skills := []model.Skill{}
	if len(skillIDs) > 0 {
		d.DB.Where("id IN ?", skillIDs).Find(&skills)
	}

	skillInputs := make([]compileSkillInput, 0, len(skills))
	for _, skill := range skills {
		skillInputs = append(skillInputs, compileSkillInput{
			Key:     skill.Key,
			Name:    skill.Name,
			Summary: derefString(skill.Summary),
			Trigger: derefString(skill.TriggerDesc),
			Content: skill.Content,
		})
	}
	pluginInputs := make([]compilePluginInput, 0, len(plugins))
	for _, plugin := range plugins {
		pluginInputs = append(pluginInputs, compilePluginInput{Key: plugin.Key, Status: plugin.Status})
	}

	compiled, err := compileExpertPackage(compileExpertInput{
		Key:            expert.Key,
		Version:        expert.Version,
		Name:           expert.Name,
		RoleTitle:      derefString(expert.RoleTitle),
		Summary:        derefString(expert.Summary),
		RolePrompt:     expert.RolePrompt,
		PermissionMode: expert.Permission,
		ModelProvider:  derefString(expert.ModelProvider),
		ModelName:      derefString(expert.ModelName),
		Owner:          derefString(expert.Owner),
	}, skillInputs, pluginInputs)
	if err != nil {
		return nil, nil, apperr.New(400, "package_compile_failed", err.Error())
	}
	return &expert, compiled, nil
}

func ExpertPackagePreview(d Deps, expertID string) (map[string]any, error) {
	_, compiled, err := compileExpertFromDB(d, expertID)
	if err != nil {
		return nil, err
	}
	entries, err := listZipEntries(compiled.Buffer)
	if err != nil {
		return nil, apperr.Bad(err.Error())
	}
	files := make([]map[string]any, 0, len(entries))
	for _, entry := range entries {
		files = append(files, map[string]any{"name": entry.Name, "size": entry.UncompressedSize})
	}
	out := map[string]any{}
	for key, value := range compiled.Summary {
		out[key] = value
	}
	out["fileName"] = compiled.FileName
	out["sha256"] = compiled.SHA256
	out["files"] = files
	return out, nil
}

func ExpertPackageFile(d Deps, expertID string) (string, []byte, error) {
	_, compiled, err := compileExpertFromDB(d, expertID)
	if err != nil {
		return "", nil, err
	}
	return compiled.FileName, compiled.Buffer, nil
}

// PublishExpert 把专家登记成市场插件：编译、落盘、写插件记录与依赖。
func PublishExpert(d Deps, actor *Actor, expertID string) (map[string]any, error) {
	expert, compiled, err := compileExpertFromDB(d, expertID)
	if err != nil {
		return nil, err
	}
	pluginName, _ := compiled.Summary["pluginName"].(string)
	now := time.Now().UTC()

	var plugin model.Plugin
	found := d.DB.Where("key = ?", pluginName).Take(&plugin).Error == nil
	if !found {
		plugin = model.Plugin{
			ID:             ids.New("plg"),
			Key:            pluginName,
			Name:           expert.Name,
			Summary:        optString(derefString(expert.Summary)),
			Category:       optString("数字员工"),
			Transport:      "http",
			Endpoint:       nil,
			Command:        optString(""),
			ArgsJSON:       "[]",
			AuthType:       "none",
			AuthConfigJSON: "{}",
			Visibility:     "all",
			Status:         "enabled",
			Owner:          optString(actor.Name()),
			CreatedAt:      now,
			UpdatedAt:      now,
		}
		if err := d.DB.Create(&plugin).Error; err != nil {
			return nil, err
		}
		_ = Audit(d, actor, "plugin.create",
			map[string]string{"type": "plugin", "id": plugin.ID, "name": expert.Name},
			map[string]any{"from": "expert", "expertId": expert.ID})
	}

	dir := filepath.Join(d.Cfg.DataDir, "packages", plugin.ID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	if err := os.WriteFile(filepath.Join(dir, compiled.FileName), compiled.Buffer, 0o644); err != nil {
		return nil, err
	}

	dependencyKeys := []string{}
	seen := map[string]struct{}{}
	serverNames, _ := compiled.Summary["mcpServerNames"].([]string)
	for _, name := range serverNames {
		key := strings.TrimPrefix(name, "plugin:")
		if idx := strings.Index(key, ":"); idx >= 0 {
			key = key[:idx]
		}
		var dep model.Plugin
		if err := d.DB.Where("key = ?", key).Take(&dep).Error; err != nil {
			continue
		}
		if dep.PackageFile == nil || *dep.PackageFile == "" || dep.Key == plugin.Key {
			continue
		}
		if _, ok := seen[dep.Key]; ok {
			continue
		}
		seen[dep.Key] = struct{}{}
		dependencyKeys = append(dependencyKeys, dep.Key)
	}
	depsJSON, _ := json.Marshal(dependencyKeys)
	size := int64(len(compiled.Buffer))
	if err := d.DB.Model(&model.Plugin{}).Where("id = ?", plugin.ID).Updates(map[string]any{
		"package_file":      compiled.FileName,
		"package_sha256":    compiled.SHA256,
		"package_size":      size,
		"dependencies_json": string(depsJSON),
		"updated_at":        now,
	}).Error; err != nil {
		return nil, err
	}
	_ = Audit(d, actor, "plugin.package.upload",
		map[string]string{"type": "plugin", "id": plugin.ID, "name": expert.Name},
		map[string]any{
			"from":         "expert",
			"expertId":     expert.ID,
			"fileName":     compiled.FileName,
			"sha256":       compiled.SHA256,
			"dependencies": dependencyKeys,
		})

	out := map[string]any{"pluginId": plugin.ID}
	for key, value := range compiled.Summary {
		out[key] = value
	}
	out["fileName"] = compiled.FileName
	out["sha256"] = compiled.SHA256
	out["dependencies"] = dependencyKeys
	out["url"] = d.Cfg.PublicBaseURL + "/v1/packages/" + plugin.ID + "/" + url.PathEscape(compiled.FileName)
	return out, nil
}
