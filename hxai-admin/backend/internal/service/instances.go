package service

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/hx/control-plane/internal/model"
	"github.com/hx/control-plane/internal/platform/ids"
	"gorm.io/gorm"
)

type InstanceInput struct {
	Name       string `json:"name"`
	BaseURL    string `json:"baseUrl"`
	AdminToken string `json:"adminToken"`
}

func ListInstances(d Deps) ([]model.Instance, error) {
	var rows []model.Instance
	err := d.DB.Order("created_at asc").Find(&rows).Error
	return rows, err
}

func CreateInstance(d Deps, in InstanceInput) (*model.Instance, error) {
	name := strings.TrimSpace(in.Name)
	base := strings.TrimRight(strings.TrimSpace(in.BaseURL), "/")
	if name == "" || base == "" || in.AdminToken == "" {
		return nil, fmt.Errorf("name/baseUrl/adminToken 均必填")
	}
	// 同一地址重复登记 → 更新既有行（名称/令牌刷新），不产生重复实例。
	var existing model.Instance
	if err := d.DB.Where("base_url = ?", base).Take(&existing).Error; err == nil {
		if err := d.DB.Model(&model.Instance{}).Where("id = ?", existing.ID).Updates(map[string]any{
			"name":        name,
			"admin_token": in.AdminToken,
			"last_error":  nil,
		}).Error; err != nil {
			return nil, err
		}
		existing.Name = name
		existing.AdminToken = in.AdminToken
		existing.LastError = nil
		return &existing, nil
	}
	inst := &model.Instance{
		ID:         ids.New("ins"),
		Name:       name,
		BaseURL:    base,
		AdminToken: in.AdminToken,
		CreatedAt:  time.Now().UTC(),
	}
	if err := d.DB.Create(inst).Error; err != nil {
		return nil, err
	}
	return inst, nil
}

func DeleteInstance(d Deps, id string) error {
	res := d.DB.Where("id = ?", id).Delete(&model.Instance{})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

type InstanceUser struct {
	Username    string `json:"username"`
	DisplayName string `json:"displayName"`
	Email       string `json:"email"`
	Role        string `json:"role"`
	RoleName    string `json:"roleName"`
	AuthType    string `json:"authType"`
	Disabled    bool   `json:"disabled"`
	CreatedAt   int64  `json:"createdAt"`
}

// InstanceUsers 拉取式聚合：实时向实例请求 /api/users，不落库、无同步漂移。
func InstanceUsers(d Deps, id string) ([]InstanceUser, error) {
	var inst model.Instance
	if err := d.DB.Where("id = ?", id).First(&inst).Error; err != nil {
		return nil, err
	}
	req, err := http.NewRequest("GET", inst.BaseURL+"/api/users", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+inst.AdminToken)
	client := &http.Client{Timeout: 8 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		markInstanceError(d, inst.ID, err.Error())
		return nil, fmt.Errorf("实例不可达: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		markInstanceError(d, inst.ID, fmt.Sprintf("http %d", resp.StatusCode))
		return nil, fmt.Errorf("实例返回 %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	var rows []struct {
		Username    string  `json:"username"`
		DisplayName string  `json:"display_name"`
		Email       *string `json:"email"`
		Role        string  `json:"role"`
		RoleName    *string `json:"role_name"`
		HasPassword bool    `json:"has_password"`
		SSOLinked   bool    `json:"sso_linked"`
		Disabled    bool    `json:"disabled"`
		CreatedAt   int64   `json:"created_at"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		return nil, fmt.Errorf("实例响应解析失败: %v", err)
	}
	markInstanceOK(d, inst.ID)
	out := make([]InstanceUser, 0, len(rows))
	for _, r := range rows {
		auth := "密码"
		if r.SSOLinked {
			auth = "单点登录"
		}
		email := ""
		if r.Email != nil {
			email = *r.Email
		}
		roleName := ""
		if r.RoleName != nil {
			roleName = *r.RoleName
		}
		out = append(out, InstanceUser{
			Username:    r.Username,
			DisplayName: r.DisplayName,
			Email:       email,
			Role:        r.Role,
			RoleName:    roleName,
			AuthType:    auth,
			Disabled:    r.Disabled,
			CreatedAt:   r.CreatedAt,
		})
	}
	return out, nil
}

func markInstanceOK(d Deps, id string) {
	now := time.Now().UTC()
	d.DB.Model(&model.Instance{}).Where("id = ?", id).
		Updates(map[string]any{"last_seen_at": &now, "last_error": nil})
}

func markInstanceError(d Deps, id, msg string) {
	if len(msg) > 480 {
		msg = msg[:480]
	}
	d.DB.Model(&model.Instance{}).Where("id = ?", id).
		Update("last_error", msg)
}
