package service

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/hx/control-plane/internal/model"
	"github.com/hx/control-plane/internal/platform/apperr"
	"github.com/hx/control-plane/internal/platform/ids"
)

/* ------------------------------- 插件 ------------------------------- */

type PluginView struct {
	ID            string         `json:"id"`
	Key           string         `json:"key"`
	Name          string         `json:"name"`
	Summary       *string        `json:"summary"`
	Category      *string        `json:"category"`
	Transport     string         `json:"transport"`
	Endpoint      *string        `json:"endpoint"`
	Command       *string        `json:"command"`
	Args          []string       `json:"args"`
	AuthType      string         `json:"authType"`
	AuthConfig    map[string]any `json:"authConfig"`
	Visibility    string         `json:"visibility"`
	Version       *string        `json:"version"`
	Status        string         `json:"status"`
	Owner         *string        `json:"owner"`
	HasPackage    bool           `json:"hasPackage"`
	PackageFile   *string        `json:"packageFile,omitempty"`
	PackageSha256 *string        `json:"packageSha256,omitempty"`
	PackageSize   *int64         `json:"packageSize,omitempty"`
	CreatedAt     string         `json:"createdAt"`
	UpdatedAt     string         `json:"updatedAt"`
}

func toPlugin(row *model.Plugin) PluginView {
	view := PluginView{
		ID:         row.ID,
		Key:        row.Key,
		Name:       row.Name,
		Summary:    row.Summary,
		Category:   row.Category,
		Transport:  row.Transport,
		Endpoint:   row.Endpoint,
		Command:    row.Command,
		Args:       parseStringArray(row.ArgsJSON),
		AuthType:   row.AuthType,
		AuthConfig: parseObject(row.AuthConfigJSON),
		Visibility: row.Visibility,
		Version:    row.Version,
		Status:     row.Status,
		Owner:      row.Owner,
		HasPackage: row.PackageFile != nil && *row.PackageFile != "",
		CreatedAt:  isoFormat(row.CreatedAt),
		UpdatedAt:  isoFormat(row.UpdatedAt),
	}
	if view.HasPackage {
		view.PackageFile = row.PackageFile
	}
	if row.PackageSHA256 != nil && *row.PackageSHA256 != "" {
		view.PackageSha256 = row.PackageSHA256
	}
	if row.PackageSize != nil && *row.PackageSize != 0 {
		view.PackageSize = row.PackageSize
	}
	return view
}

func ListPlugins(d Deps) ([]PluginView, error) {
	var rows []model.Plugin
	if err := d.DB.Order("created_at DESC").Find(&rows).Error; err != nil {
		return nil, err
	}
	items := make([]PluginView, 0, len(rows))
	for i := range rows {
		items = append(items, toPlugin(&rows[i]))
	}
	return items, nil
}

func GetPlugin(d Deps, id string) (*PluginView, error) {
	var row model.Plugin
	if err := d.DB.Where("id = ?", id).Take(&row).Error; err != nil {
		return nil, apperr.NotFound("插件不存在")
	}
	view := toPlugin(&row)
	return &view, nil
}

type PluginInput struct {
	Name       *string         `json:"name"`
	Key        *string         `json:"key"`
	Summary    *string         `json:"summary"`
	Category   *string         `json:"category"`
	Transport  *string         `json:"transport"`
	Endpoint   *string         `json:"endpoint"`
	Command    *string         `json:"command"`
	Args       *[]string       `json:"args"`
	AuthType   *string         `json:"authType"`
	AuthConfig *map[string]any `json:"authConfig"`
	Visibility *string         `json:"visibility"`
	Version    *string         `json:"version"`
	Status     *string         `json:"status"`
}

func CreatePlugin(d Deps, actor *Actor, in PluginInput) (*PluginView, error) {
	if in.Name == nil || strings.TrimSpace(*in.Name) == "" {
		return nil, apperr.Bad("缺少必填字段：name", map[string]any{"missing": []string{"name"}})
	}
	transport := valueOr(in.Transport, "streamable_http")
	if transport == "stdio" {
		if in.Command == nil || strings.TrimSpace(*in.Command) == "" {
			return nil, apperr.Bad("缺少必填字段：command", map[string]any{"missing": []string{"command"}})
		}
	} else if in.Endpoint == nil || strings.TrimSpace(*in.Endpoint) == "" {
		return nil, apperr.Bad("缺少必填字段：endpoint", map[string]any{"missing": []string{"endpoint"}})
	}

	keySource := derefString(in.Key)
	if keySource == "" {
		keySource = *in.Name
	}
	key := slugify(keySource)
	if key == "" {
		key = "plugin-" + strconv.FormatInt(time.Now().UnixMilli(), 10)
	}
	if err := ensureUnique(d.DB, "plugins", key, ""); err != nil {
		return nil, err
	}

	args := []string{}
	if in.Args != nil {
		args = *in.Args
	}
	authConfig := map[string]any{}
	if in.AuthConfig != nil {
		authConfig = sanitizeConfig(*in.AuthConfig)
	}
	now := time.Now().UTC()
	row := model.Plugin{
		ID:               ids.New("plg"),
		Key:              key,
		Name:             *in.Name,
		Summary:          sp(derefString(in.Summary)),
		Category:         sp(valueOr(in.Category, "业务系统")),
		Transport:        transport,
		Endpoint:         optString(derefString(in.Endpoint)),
		Command:          optString(derefString(in.Command)),
		ArgsJSON:         mustJSON(args),
		AuthType:         valueOr(in.AuthType, "oauth"),
		AuthConfigJSON:   mustJSON(authConfig),
		Visibility:       valueOr(in.Visibility, "all"),
		Version:          sp(valueOr(in.Version, "1.0.0")),
		Status:           valueOr(in.Status, "draft"),
		Owner:            sp(actor.Name()),
		DependenciesJSON: "[]",
		CreatedAt:        now,
		UpdatedAt:        now,
	}
	if err := d.DB.Create(&row).Error; err != nil {
		return nil, err
	}
	_ = Audit(d, actor, "新增插件",
		map[string]string{"type": "plugin", "id": row.ID, "name": row.Name},
		map[string]any{"transport": transport})
	view := toPlugin(&row)
	return &view, nil
}

func UpdatePlugin(d Deps, actor *Actor, id string, in PluginInput) (*PluginView, error) {
	var row model.Plugin
	if err := d.DB.Where("id = ?", id).Take(&row).Error; err != nil {
		return nil, apperr.NotFound("插件不存在")
	}
	fromStatus := row.Status
	if in.Name != nil {
		row.Name = *in.Name
	}
	if in.Summary != nil {
		row.Summary = in.Summary
	}
	if in.Category != nil {
		row.Category = in.Category
	}
	if in.Transport != nil {
		row.Transport = *in.Transport
	}
	if in.Endpoint != nil {
		row.Endpoint = in.Endpoint
	}
	if in.Command != nil {
		row.Command = in.Command
	}
	if in.Args != nil {
		row.ArgsJSON = mustJSON(*in.Args)
	}
	if in.AuthType != nil {
		row.AuthType = *in.AuthType
	}
	if in.AuthConfig != nil {
		row.AuthConfigJSON = mustJSON(sanitizeConfig(*in.AuthConfig))
	}
	if in.Visibility != nil {
		row.Visibility = *in.Visibility
	}
	if in.Version != nil {
		row.Version = in.Version
	}
	if in.Status != nil {
		row.Status = *in.Status
	}
	row.UpdatedAt = time.Now().UTC()
	if err := d.DB.Save(&row).Error; err != nil {
		return nil, err
	}

	action := "更新插件"
	if row.Status != fromStatus {
		if row.Status == "enabled" {
			action = "启用插件"
		} else {
			action = "停用插件"
		}
	}
	_ = Audit(d, actor, action,
		map[string]string{"type": "plugin", "id": row.ID, "name": row.Name},
		map[string]any{"version": row.Version})
	view := toPlugin(&row)
	return &view, nil
}

func DeletePlugin(d Deps, actor *Actor, id string) error {
	var row model.Plugin
	if err := d.DB.Where("id = ?", id).Take(&row).Error; err != nil {
		return apperr.NotFound("插件不存在")
	}
	if err := d.DB.Where("id = ?", row.ID).Delete(&model.Plugin{}).Error; err != nil {
		return err
	}
	return Audit(d, actor, "删除插件",
		map[string]string{"type": "plugin", "id": row.ID, "name": row.Name}, nil)
}

func TestPlugin(d Deps, id string) (map[string]any, error) {
	var row model.Plugin
	if err := d.DB.Where("id = ?", id).Take(&row).Error; err != nil {
		return nil, apperr.NotFound("插件不存在")
	}
	if row.Transport == "stdio" {
		command := derefString(row.Command)
		if command == "" {
			return map[string]any{"reachable": false, "detail": "缺少启动命令", "latencyMs": 0}, nil
		}
		return map[string]any{"reachable": true, "detail": "将以 " + command + " 拉起本地进程", "latencyMs": 0}, nil
	}

	endpoint := derefString(row.Endpoint)
	started := time.Now()
	result := map[string]any{}
	parsed, err := url.Parse(endpoint)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		message := "无效的端点地址"
		if err != nil {
			message = err.Error()
		}
		return map[string]any{
			"reachable": false,
			"latencyMs": time.Since(started).Milliseconds(),
			"detail":    "无法连接：" + message,
		}, nil
	}
	client := &http.Client{Timeout: 4 * time.Second}
	resp, err := client.Get(endpoint)
	latency := time.Since(started).Milliseconds()
	if err != nil {
		result["reachable"] = false
		result["status"] = 0
		result["latencyMs"] = latency
		result["detail"] = "无法连接：" + err.Error()
		return result, nil
	}
	defer resp.Body.Close()
	reachable := (resp.StatusCode >= 200 && resp.StatusCode < 300) ||
		resp.StatusCode == 401 || resp.StatusCode == 403 || resp.StatusCode == 405
	detail := "端点可达"
	if reachable && (resp.StatusCode == 401 || resp.StatusCode == 403) {
		detail = "端点可达，返回 401/403（符合 MCP 授权规范，客户端将发起 OAuth 登录）"
	} else if !reachable {
		detail = fmt.Sprintf("无法连接：HTTP %d", resp.StatusCode)
	}
	result["reachable"] = reachable
	result["status"] = resp.StatusCode
	result["latencyMs"] = latency
	result["detail"] = detail
	return result, nil
}

/* ----------------------------- 插件包托管 ----------------------------- */

func PluginPackageFile(d Deps, id, file string) (string, []byte, error) {
	var row model.Plugin
	if err := d.DB.Select("package_file").Where("id = ?", id).Take(&row).Error; err != nil {
		return "", nil, apperr.NotFound("插件包不存在")
	}
	if row.PackageFile == nil || *row.PackageFile == "" || *row.PackageFile != file {
		return "", nil, apperr.NotFound("插件包不存在")
	}
	filePath := filepath.Join(d.Cfg.DataDir, "packages", id, *row.PackageFile)
	data, err := os.ReadFile(filePath)
	if err != nil {
		return "", nil, apperr.NotFound("插件包文件缺失")
	}
	return *row.PackageFile, data, nil
}

func UploadPluginPackage(d Deps, actor *Actor, id string, data []byte, versionQuery string) (map[string]any, error) {
	if len(data) == 0 {
		return nil, apperr.Bad("请求体必须是插件 zip 二进制（Content-Type: application/zip）")
	}
	if len(data) > 50*1024*1024 {
		return nil, apperr.Bad("插件包不能超过 50MB")
	}
	var row model.Plugin
	if err := d.DB.Where("id = ?", id).Take(&row).Error; err != nil {
		return nil, apperr.NotFound("插件不存在")
	}

	manifestBytes, manifestPath, err := findPluginManifest(data)
	if err != nil {
		return nil, apperr.Bad(err.Error())
	}
	var manifest map[string]any
	if err := json.Unmarshal(manifestBytes, &manifest); err != nil {
		message := err.Error()
		return nil, apperr.Bad("插件清单不是合法 JSON：" + message)
	}
	manifestName, _ := manifest["name"].(string)
	manifestName = strings.TrimSpace(manifestName)
	if !PluginNamePattern.MatchString(manifestName) {
		label := manifestName
		if label == "" {
			label = "缺失"
		}
		return nil, apperr.Bad("插件清单 name 不合法（需匹配 " + PluginNamePattern.String() + "）：" + label)
	}
	if manifestName != row.Key {
		return nil, apperr.Bad("插件清单 name（" + manifestName + "）与后台插件标识（" + row.Key + "）不一致")
	}

	version := ""
	if raw, ok := manifest["version"]; ok && raw != nil {
		version = fmt.Sprint(raw)
	}
	if version == "" {
		version = versionQuery
	}
	if version == "" {
		version = derefString(row.Version)
	}
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

	now := time.Now().UTC()
	size := int64(len(data))
	if err := d.DB.Model(&model.Plugin{}).Where("id = ?", row.ID).Updates(map[string]any{
		"package_file":   fileName,
		"package_sha256": sha,
		"package_size":   size,
		"updated_at":     now,
	}).Error; err != nil {
		return nil, err
	}

	var manifestVersion any
	if raw, ok := manifest["version"]; ok {
		manifestVersion = raw
	}
	_, hasMcp := manifest["mcpServers"]
	_ = Audit(d, actor, "plugin.package.upload",
		map[string]string{"type": "plugin", "id": row.ID, "name": row.Key},
		map[string]any{
			"fileName":        fileName,
			"size":            size,
			"sha256":          sha,
			"manifestPath":    manifestPath,
			"manifestVersion": manifestVersion,
		})

	return map[string]any{
		"fileName":        fileName,
		"sha256":          sha,
		"size":            size,
		"manifestPath":    manifestPath,
		"manifestName":    manifestName,
		"manifestVersion": manifestVersion,
		"hasMcpServers":   hasMcp,
		"skillCount":      countSkillEntries(data),
		"url":             d.Cfg.PublicBaseURL + "/v1/packages/" + row.ID + "/" + url.PathEscape(fileName),
	}, nil
}

/* --------------------------- 插件市场清单 --------------------------- */

func MarketplaceJSON(d Deps) map[string]any {
	var rows []model.Plugin
	d.DB.Where("status = ? AND visibility <> ?", "enabled", "admin").Order("name ASC").Find(&rows)
	plugins := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		deps := []string{}
		for _, dep := range parseStringArray(row.DependenciesJSON) {
			if strings.TrimSpace(dep) != "" {
				deps = append(deps, dep)
			}
		}
		base := map[string]any{"name": row.Key}
		if row.Summary != nil && *row.Summary != "" {
			base["description"] = *row.Summary
		}
		if row.Version != nil && *row.Version != "" {
			base["version"] = *row.Version
		}
		if row.Category != nil && *row.Category != "" {
			base["category"] = *row.Category
		}
		if len(deps) > 0 {
			base["dependencies"] = deps
		}
		if row.PackageFile != nil && *row.PackageFile != "" && row.PackageSHA256 != nil && *row.PackageSHA256 != "" {
			source := map[string]any{
				"source": "url",
				"type":   "zip",
				"url":    d.Cfg.PublicBaseURL + "/v1/packages/" + row.ID + "/" + url.PathEscape(*row.PackageFile),
				"sha256": *row.PackageSHA256,
			}
			if row.PackageSize != nil && *row.PackageSize != 0 {
				source["size"] = *row.PackageSize
			}
			base["source"] = source
		} else {
			base["source"] = "./plugins/" + row.Key
		}
		plugins = append(plugins, base)
	}
	return map[string]any{
		"name":        d.Settings.Get("zcode.marketplace.name", "hx-plugins"),
		"description": d.Settings.Get("zcode.marketplace.description", "HX 插件市场"),
		"owner":       map[string]string{"name": d.Cfg.OrgName, "url": d.Cfg.PublicBaseURL},
		"plugins":     plugins,
	}
}
