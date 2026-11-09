package service

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/hx/control-plane/internal/model"
	"github.com/hx/control-plane/internal/platform/apperr"
)

// HarnessPermItem 智能体侧权限键（从注册实例 /api/users/permissions 同步）。
type HarnessPermItem struct {
	Key       string `json:"key"`
	Label     string `json:"label"`
	LabelZh   string `json:"labelZh"`
	Category  string `json:"category"`
	Page      string `json:"page"`
	PageLabel string `json:"pageLabel"`
}

const settingHarnessPermCatalog = "harness_perm_catalog"

// HarnessPermissions 返回已同步的智能体权限目录快照（未同步为空）。
func HarnessPermissions(d Deps) []HarnessPermItem {
	raw := d.Settings.Get(settingHarnessPermCatalog, "")
	if raw == "" {
		return nil
	}
	var items []HarnessPermItem
	_ = json.Unmarshal([]byte(raw), &items)
	return items
}

// SyncHarnessPermissions 从首个可达实例拉取权限目录存快照。
// 实例的 AdminToken 即是 octop 侧 admin 的 JWT。
func SyncHarnessPermissions(d Deps) (int, error) {
	var inst model.Instance
	if err := d.DB.Order("created_at asc").First(&inst).Error; err != nil {
		return 0, apperr.NotFound("尚未登记实例")
	}
	url := inst.BaseURL + "/api/users/permissions"
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return 0, err
	}
	req.Header.Set("Authorization", "Bearer "+inst.AdminToken)
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return 0, apperr.Bad("实例不可达：" + err.Error())
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 200))
		return 0, apperr.Bad(fmt.Sprintf("实例返回 %d：%s", resp.StatusCode, string(body)))
	}
	var raw []map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return 0, apperr.Bad("实例返回格式异常")
	}
	items := make([]HarnessPermItem, 0, len(raw))
	for _, m := range raw {
		items = append(items, HarnessPermItem{
			Key:       toString(m["key"]),
			Label:     toString(m["label"]),
			LabelZh:   toString(m["label"]),
			Category:  toString(m["category"]),
			Page:      toString(m["page"]),
			PageLabel: toString(m["page_label"]),
		})
	}
	buf, _ := json.Marshal(items)
	if err := d.Settings.Set(settingHarnessPermCatalog, string(buf)); err != nil {
		return 0, err
	}
	return len(items), nil
}

// ValidateHarnessPermissions 校验 harness 域权限键在已同步目录内；
// 目录未同步时放行（等同步后再校验）。
func ValidateHarnessPermissions(d Deps, perms []string) ([]string, error) {
	catalog := map[string]bool{}
	for _, it := range HarnessPermissions(d) {
		catalog[it.Key] = true
	}
	if len(catalog) == 0 {
		return perms, nil
	}
	seen := map[string]bool{}
	out := make([]string, 0, len(perms))
	for _, k := range perms {
		if !catalog[k] {
			return nil, apperr.Bad("未知智能体权限键：" + k)
		}
		if !seen[k] {
			seen[k] = true
			out = append(out, k)
		}
	}
	return out, nil
}
