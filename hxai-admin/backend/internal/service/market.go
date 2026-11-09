package service

// Octop 私有市场协议（替代 tools/market_stub.py 的正式实现）。
// 目录契约：GET /api/market/experts → {success:true,data:{items:[...]}}，
// 详情字段（content/quick_prompts/…）内嵌列表项，Octop 不二次请求；
// download_url 源站必须与 OCTOP_MARKET_REMOTE_ORIGIN 一致 → 用 PublicBaseURL。
// 包格式（hxai-octop/docs/expert-package.md）：manifest.json 在根或唯一子目录，
// + SOUL.md + skills/<slug>/SKILL.md。

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/hx/control-plane/internal/model"
	"github.com/hx/control-plane/internal/platform/apperr"
)

func octopExpertDescription(e *model.Expert) string {
	for _, v := range []string{derefString(e.Summary), derefString(e.RoleTitle), e.Name, e.Key} {
		if s := strings.TrimSpace(v); s != "" {
			return s
		}
	}
	return e.Key
}

// octopManifest 目录项 + 包内 manifest.json 共用字段（admin 字段名 → octop 字段名）。
func octopManifest(e *model.Expert, skillSlugs []string) map[string]any {
	m := map[string]any{
		"id":           e.Key,
		"slug":         e.Key,
		"label":        e.Name,
		"name":         e.Name,
		"description":  octopExpertDescription(e),
		"version":      expertVersion(e.Version),
		"prompt_files": []string{"SOUL.md"},
	}
	// icon_name 优先取 market_meta.iconName（lucide 名，如 "zap"）；
	// 兜底才是 emoji 展示字符——两者语义不同，不能混用。
	if icon := strings.TrimSpace(derefString(e.Emoji)); icon != "" {
		m["icon_name"] = icon
	}
	if welcome := strings.TrimSpace(derefString(e.RoleTitle)); welcome != "" {
		m["welcome_message"] = welcome
	} else if s := strings.TrimSpace(derefString(e.Summary)); s != "" {
		m["welcome_message"] = s
	}
	if len(skillSlugs) > 0 {
		m["skill_slugs"] = skillSlugs
		m["skill_count"] = len(skillSlugs)
	}
	// 运营侧市场字段（market_meta_json）优先于兜底推导。
	meta := parseStringMap(e.MarketMetaJSON)
	switch v := meta["welcomeMessage"].(type) {
	case map[string]any: // 本地化对象原样透传（{zh:…,en:…}）
		if len(v) > 0 {
			m["welcome_message"] = v
		}
	case string:
		if s := strings.TrimSpace(v); s != "" {
			m["welcome_message"] = s
		}
	}
	if v, ok := meta["quickPrompts"].([]any); ok && len(v) > 0 {
		m["quick_prompts"] = v
	}
	if v, ok := meta["taskExamples"].(map[string]any); ok && len(v) > 0 {
		m["task_examples"] = v
	}
	if v := strings.TrimSpace(toString(meta["color"])); v != "" {
		m["color"] = v
	}
	if v := strings.TrimSpace(toString(meta["iconName"])); v != "" {
		m["icon_name"] = v
	}
	if v := strings.TrimSpace(toString(meta["iconUrl"])); v != "" {
		m["icon_url"] = v
	}
	return m
}

func expertLinkedSkills(d Deps, e *model.Expert) []model.Skill {
	skillIDs := parseStringArray(e.SkillIDsJSON)
	if len(skillIDs) == 0 {
		return nil
	}
	skills := []model.Skill{}
	d.DB.Where("id IN ?", skillIDs).Find(&skills)
	return skills
}

// MarketExperts 已发布专家 → octop 市场目录条目。
func MarketExperts(d Deps) ([]map[string]any, error) {
	experts := []model.Expert{}
	if err := d.DB.Where("status = ?", "published").Order("key").Find(&experts).Error; err != nil {
		return nil, apperr.New(500, "db_error", err.Error())
	}
	base := strings.TrimRight(d.Cfg.PublicBaseURL, "/")
	items := make([]map[string]any, 0, len(experts))
	for i := range experts {
		e := &experts[i]
		skills := expertLinkedSkills(d, e)
		slugs := make([]string, 0, len(skills))
		for _, sk := range skills {
			if k := strings.TrimSpace(sk.Key); k != "" {
				slugs = append(slugs, k)
			}
		}
		item := octopManifest(e, slugs)
		item["download_url"] = fmt.Sprintf("%s/api/market/packages/experts/%s.zip", base, e.ID)
		// 目录契约要求详情内嵌：content/quick_prompts/task_examples
		// （缺省发空集合而非 null，与 stub 一致）。
		item["content"] = item["welcome_message"]
		if _, ok := item["quick_prompts"]; !ok {
			item["quick_prompts"] = []any{}
		}
		if _, ok := item["task_examples"]; !ok {
			item["task_examples"] = map[string]any{}
		}
		items = append(items, item)
	}
	return items, nil
}

// MarketExpertZip 按 octop expert-package 规范生成 zip：根级 manifest.json +
// SOUL.md（role_prompt）+ skills/<key>/SKILL.md。
func MarketExpertZip(d Deps, expertID string) (string, []byte, error) {
	expertID = strings.TrimSuffix(expertID, ".zip")
	var e model.Expert
	if err := d.DB.Where("id = ?", expertID).Take(&e).Error; err != nil {
		return "", nil, apperr.NotFound("专家不存在")
	}
	skills := expertLinkedSkills(d, &e)

	slugs := make([]string, 0, len(skills))
	files := []zipInput{}
	for _, sk := range skills {
		key := strings.TrimSpace(sk.Key)
		if key == "" {
			continue
		}
		if sk.PackageFile != nil && *sk.PackageFile != "" {
			if pkgFiles, ok := skillPackageEntries(d, sk.ID, *sk.PackageFile); ok {
				for _, pf := range pkgFiles {
					files = append(files, zipInput{
						Name: "skills/" + key + "/" + pf.Name,
						Data: pf.Data,
					})
				}
				slugs = append(slugs, key)
				continue
			}
		}
		files = append(files, zipInput{
			Name: "skills/" + key + "/SKILL.md",
			Data: []byte(normalizeSkillMarkdown(compileSkillInput{
				Key:     sk.Key,
				Name:    sk.Name,
				Summary: derefString(sk.Summary),
				Trigger: derefString(sk.TriggerDesc),
				Content: sk.Content,
			})),
		})
		slugs = append(slugs, key)
	}

	manifest, _ := json.MarshalIndent(octopManifest(&e, slugs), "", "  ")
	files = append(files,
		zipInput{Name: "manifest.json", Data: append(manifest, '\n')},
		zipInput{Name: "SOUL.md", Data: []byte(e.RolePrompt)},
	)

	buf, err := createZip(files)
	if err != nil {
		return "", nil, apperr.New(500, "zip_error", err.Error())
	}
	return e.Key + "-" + safeFileName(expertVersion(e.Version)) + ".zip", buf, nil
}

// MarketPlugins 有安装包的启用插件 → octop 插件市场目录
// （契约对齐 infra/agents/plugins/manager._remote_plugin_row）。
func MarketPlugins(d Deps) ([]map[string]any, error) {
	plugins := []model.Plugin{}
	if err := d.DB.Where("status = ?", "enabled").
		Where("package_file IS NOT NULL AND package_file != ''").
		Order("key").Find(&plugins).Error; err != nil {
		return nil, apperr.New(500, "db_error", err.Error())
	}
	base := strings.TrimRight(d.Cfg.PublicBaseURL, "/")
	items := make([]map[string]any, 0, len(plugins))
	for i := range plugins {
		p := &plugins[i]
		items = append(items, map[string]any{
			"id":           p.Key,
			"name":         p.Name,
			"version":      derefString(p.Version),
			"kind":         "tool",
			"description":  derefString(p.Summary),
			"group":        derefString(p.Category),
			"requires":     []string{},
			"download_url": fmt.Sprintf("%s/v1/packages/%s/%s", base, p.ID, *p.PackageFile),
		})
	}
	return items, nil
}

// UploadOctopPluginPackage 存 octop 格式插件包（plugin.yaml zip）到
// packages/{id}/ 并回写 PackageFile/SHA256/Size——admin 只做分发层。
func UploadOctopPluginPackage(d Deps, id string, data []byte) (map[string]any, error) {
	var row model.Plugin
	if err := d.DB.Where("id = ?", id).Take(&row).Error; err != nil {
		return nil, apperr.NotFound("插件不存在")
	}
	if len(data) == 0 {
		return nil, apperr.Bad("空包")
	}
	entries, err := listZipEntries(data)
	if err != nil {
		return nil, apperr.Bad("请求体必须是 zip 二进制")
	}
	found := false
	for _, e := range entries {
		name := strings.TrimPrefix(e.Name, "/")
		if name == "plugin.yaml" || strings.HasSuffix(name, "/plugin.yaml") {
			found = true
			break
		}
	}
	if !found {
		return nil, apperr.Bad("包内找不到 plugin.yaml——不是 octop 插件包")
	}
	version := derefString(row.Version)
	if version == "" {
		version = "1.0.0"
	}
	fileName := row.Key + "-" + safeFileName(version) + ".zip"
	dir := filepath.Join(d.Cfg.DataDir, "packages", row.ID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	if err := os.WriteFile(filepath.Join(dir, fileName), data, 0o644); err != nil {
		return nil, err
	}
	sha := sha256Hex(data)
	size := int64(len(data))
	if err := d.DB.Model(&model.Plugin{}).Where("id = ?", row.ID).Updates(map[string]any{
		"package_file":   fileName,
		"package_sha256": sha,
		"package_size":   size,
	}).Error; err != nil {
		return nil, err
	}
	return map[string]any{
		"file":   fileName,
		"sha256": sha,
		"size":   size,
		"url":    strings.TrimRight(d.Cfg.PublicBaseURL, "/") + "/v1/packages/" + row.ID + "/" + fileName,
	}, nil
}

// UploadSkillPackage 存 octop 技能目录 zip（含 SKILL.md）到 packages/{id}/
// 并回写 PackageFile/SHA256/Size——真技能是文件夹不是单文件。
func UploadSkillPackage(d Deps, id string, data []byte) (map[string]any, error) {
	var row model.Skill
	if err := d.DB.Where("id = ?", id).Take(&row).Error; err != nil {
		return nil, apperr.NotFound("技能不存在")
	}
	if len(data) == 0 {
		return nil, apperr.Bad("空包")
	}
	entries, err := listZipEntries(data)
	if err != nil {
		return nil, apperr.Bad("请求体必须是 zip 二进制")
	}
	found := false
	for _, e := range entries {
		name := strings.TrimPrefix(e.Name, "/")
		if name == "SKILL.md" || strings.HasSuffix(name, "/SKILL.md") {
			found = true
			break
		}
	}
	if !found {
		return nil, apperr.Bad("包内找不到 SKILL.md——不是技能包")
	}
	fileName := row.Key + "-" + safeFileName(expertVersion(row.Version)) + ".zip"
	dir := filepath.Join(d.Cfg.DataDir, "packages", row.ID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	if err := os.WriteFile(filepath.Join(dir, fileName), data, 0o644); err != nil {
		return nil, err
	}
	sha := sha256Hex(data)
	size := int64(len(data))
	if err := d.DB.Model(&model.Skill{}).Where("id = ?", row.ID).Updates(map[string]any{
		"package_file":   fileName,
		"package_sha256": sha,
		"package_size":   size,
	}).Error; err != nil {
		return nil, err
	}
	return map[string]any{"file": fileName, "sha256": sha, "size": size}, nil
}

// skillPackageEntries 读技能已上传 zip 的成员（相对路径→内容）。
// SKILL.md 在根则成员原样用；在唯一子目录则剥掉该前缀。
func skillPackageEntries(d Deps, skillID, fileName string) ([]zipInput, bool) {
	data, err := os.ReadFile(filepath.Join(d.Cfg.DataDir, "packages", skillID, fileName))
	if err != nil {
		return nil, false
	}
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, false
	}
	prefix := ""
	for _, f := range zr.File {
		n := strings.TrimPrefix(f.Name, "/")
		if n == "SKILL.md" {
			break
		}
		if strings.HasSuffix(n, "/SKILL.md") && prefix == "" {
			prefix = n[:len(n)-len("SKILL.md")]
		}
	}
	files := []zipInput{}
	for _, f := range zr.File {
		if f.FileInfo().IsDir() {
			continue
		}
		n := strings.TrimPrefix(f.Name, "/")
		n = strings.TrimPrefix(n, prefix)
		if n == "" || strings.Contains(n, "..") || strings.HasPrefix(n, "/") {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			continue
		}
		b, _ := io.ReadAll(rc)
		rc.Close()
		files = append(files, zipInput{Name: n, Data: b})
	}
	return files, len(files) > 0
}
