package service

import (
	"fmt"
	"net/url"
	"time"

	"github.com/hx/control-plane/internal/model"
)

type Warning struct {
	Level   string `json:"level"`
	Message string `json:"message"`
}

func PublicBaseURLWarnings(d Deps) []Warning {
	raw := d.Cfg.PublicBaseURL
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return []Warning{{Level: "error", Message: "OWCP_PUBLIC_BASE_URL 不是合法地址：" + raw}}
	}
	out := []Warning{}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		out = append(out, Warning{Level: "error", Message: "下发地址协议必须是 http/https：" + raw})
	}
	host := parsed.Hostname()
	local := host == "127.0.0.1" || host == "localhost" || host == "::1" || host == "0.0.0.0"
	if local {
		out = append(out, Warning{
			Level:   "warn",
			Message: fmt.Sprintf("下发地址是 %s：只有本机能用。客户端装在其他机器上会连不上，请设置 OWCP_PUBLIC_BASE_URL 为客户端可达的地址（如 https://ai.hx.local）。", host),
		})
	}
	if parsed.Scheme == "http" && !(host == "127.0.0.1" || host == "localhost" || host == "::1") {
		out = append(out, Warning{Level: "warn", Message: "下发地址是明文 http：对外部署应挂 HTTPS 反代。"})
	}
	return out
}

func Health(d Deps) map[string]any {
	return map[string]any{
		"status":  "ok",
		"name":    d.Settings.Get("org_name", d.Cfg.OrgName),
		"time":    isoFormat(time.Now()),
		"version": "0.1.0",
	}
}

/* ----------------------------- 概览 ----------------------------- */

func Overview(d Deps, user *model.User) map[string]any {
	_ = user
	count := func(model any, where string, args ...any) int64 {
		var n int64
		query := d.DB.Model(model)
		if where != "" {
			query = query.Where(where, args...)
		}
		query.Count(&n)
		return n
	}
	var recent []model.AuditLog
	d.DB.Order("created_at DESC, id DESC").Limit(8).Find(&recent)
	recentItems := make([]map[string]any, 0, len(recent))
	for _, row := range recent {
		recentItems = append(recentItems, map[string]any{
			"id":         row.ID,
			"actor":      row.ActorName,
			"action":     row.Action,
			"target":     row.TargetName,
			"targetType": row.TargetType,
			"createdAt":  isoFormat(row.CreatedAt),
		})
	}
	type categoryCount struct {
		Category *string
		Count    int
	}
	var categories []categoryCount
	d.DB.Table("plugins").Select("category, COUNT(*) AS count").Group("category").Order("count DESC").Scan(&categories)
	byCategory := make([]map[string]any, 0, len(categories))
	for _, row := range categories {
		byCategory = append(byCategory, map[string]any{"category": row.Category, "count": row.Count})
	}
	type authCount struct {
		AuthType string
		Count    int
	}
	var auths []authCount
	d.DB.Table("plugins").Select("auth_type, COUNT(*) AS count").Group("auth_type").Scan(&auths)
	authMix := make([]map[string]any, 0, len(auths))
	for _, row := range auths {
		authMix = append(authMix, map[string]any{"type": row.AuthType, "count": row.Count})
	}
	return map[string]any{
		"counts": map[string]any{
			"experts":          count(&model.Expert{}, ""),
			"expertsPublished": count(&model.Expert{}, "status = ?", "published"),
			"plugins":          count(&model.Plugin{}, ""),
			"pluginsEnabled":   count(&model.Plugin{}, "status = ?", "enabled"),
			"skills":           count(&model.Skill{}, ""),
			"skillsPublished":  count(&model.Skill{}, "status = ?", "published"),
			"users":            count(&model.User{}, "status = ?", "active"),
			"auditToday":       count(&model.AuditLog{}, "created_at >= ?", time.Now().UTC().Add(-24*time.Hour)),
		},
		"byCategory": byCategory,
		"authMix":    authMix,
		"recent":     recentItems,
	}
}

func isoFormat(t time.Time) string {
	return t.UTC().Format("2006-01-02T15:04:05.000Z")
}
