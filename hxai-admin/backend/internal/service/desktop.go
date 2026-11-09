package service

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/url"
	"strings"
	"time"

	"github.com/hx/control-plane/internal/model"
	"github.com/hx/control-plane/internal/platform/apperr"
	"github.com/hx/control-plane/internal/platform/ids"
	"github.com/hx/control-plane/internal/platform/iso"
)

/* ------------------------- 桌面登录：一次性凭据 ------------------------- */

type HandoffResult struct {
	Grant     string `json:"grant"`
	ExpiresAt string `json:"expiresAt"`
	BaseURL   string `json:"baseUrl"`
	DeepLink  string `json:"deepLink"`
}

func CreateHandoff(d Deps, user *model.User, ip string) (HandoffResult, error) {
	grant := ids.Token(24)
	expires := time.Now().UTC().Add(5 * time.Minute)
	handoff := model.Handoff{
		Grant:     grant,
		UserID:    user.ID,
		CreatedAt: time.Now().UTC(),
		ExpiresAt: expires,
		IP:        optString(ip),
	}
	if err := d.DB.Create(&handoff).Error; err != nil {
		return HandoffResult{}, err
	}
	_ = Audit(d, &Actor{User: user, IP: ip}, "生成桌面登录码",
		map[string]string{"type": "user", "id": user.ID, "name": user.DisplayName}, nil)
	base := d.Cfg.PublicBaseURL
	return HandoffResult{
		Grant:     grant,
		ExpiresAt: iso.Format(expires),
		BaseURL:   base,
		DeepLink:  BuildDesktopDeepLink(d.Cfg.DesktopDeepLinkScheme, grant, base),
	}, nil
}

type ExchangeResult struct {
	Token        string            `json:"token"`
	AccessToken  string            `json:"accessToken"`
	ExpiresAt    string            `json:"expiresAt"`
	User         ExchangeUser      `json:"user"`
	Organization map[string]string `json:"organization"`
}

type ExchangeUser struct {
	ID          string  `json:"id"`
	Email       string  `json:"email"`
	Name        string  `json:"name"`
	DisplayName string  `json:"displayName"`
	Department  *string `json:"department"`
}

func ExchangeHandoff(d Deps, grant, ip, ua string) (*ExchangeResult, error) {
	grant = strings.TrimSpace(grant)
	if grant == "" {
		return nil, apperr.Bad("缺少 grant")
	}
	var row model.Handoff
	if err := d.DB.Where("`grant` = ?", grant).Take(&row).Error; err != nil {
		return nil, apperr.New(401, "invalid_grant", "登录码无效，请重新生成")
	}
	if row.ConsumedAt != nil {
		return nil, apperr.New(401, "grant_consumed", "登录码已被使用，请重新生成")
	}
	if row.ExpiresAt.Before(time.Now().UTC()) {
		return nil, apperr.New(401, "grant_expired", "登录码已过期，请重新生成")
	}
	var user model.User
	if err := d.DB.Where("id = ?", row.UserID).Take(&user).Error; err != nil || user.Status != "active" {
		return nil, apperr.New(403, "user_disabled", "该账号已停用")
	}
	now := time.Now().UTC()
	res := d.DB.Model(&model.Handoff{}).
		Where("`grant` = ? AND consumed_at IS NULL", grant).
		Update("consumed_at", now)
	if res.Error != nil {
		return nil, res.Error
	}
	if res.RowsAffected == 0 {
		return nil, apperr.New(401, "grant_consumed", "登录码已被使用，请重新生成")
	}

	token, exp, err := NewSessionManager(d).Create(&user, ip, ua)
	if err != nil {
		return nil, err
	}
	d.DB.Model(&model.User{}).Where("id = ?", user.ID).Update("last_login_at", now)
	user.LastLoginAt = &now
	_ = Audit(d, &Actor{User: &user, IP: ip}, "桌面端登录",
		map[string]string{"type": "session", "id": user.ID, "name": "桌面客户端"},
		map[string]any{"grant": grant[:min(6, len(grant))] + "…"})

	email := derefString(user.Email)
	if email == "" {
		email = user.Username + "@hx.local"
	}
	orgName := d.Settings.Get("org_name", d.Cfg.OrgName)
	return &ExchangeResult{
		Token:       token,
		AccessToken: token,
		ExpiresAt:   iso.Format(exp),
		User: ExchangeUser{
			ID:          user.ID,
			Email:       email,
			Name:        user.DisplayName,
			DisplayName: user.DisplayName,
			Department:  user.Department,
		},
		Organization: map[string]string{"id": "hx", "name": orgName, "slug": "hx"},
	}, nil
}

// BuildDesktopDeepLink 与 Node 版 / admin-console 授权页保持同一契约：
// hxai://desktop-auth?grant=…&denBaseUrl=…，桌面端收到后自动完成兑换。
func BuildDesktopDeepLink(scheme, grant, baseURL string) string {
	return scheme + "://desktop-auth?grant=" + url.QueryEscape(grant) + "&denBaseUrl=" + url.QueryEscape(baseURL)
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

/* ---------------------------- 客户端令牌 ---------------------------- */

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func TokenIsValid(d Deps, token string) bool {
	if token == "" {
		return false
	}
	var count int64
	d.DB.Model(&model.ClientToken{}).
		Where("token_hash = ? AND revoked = 0", hashToken(token)).
		Count(&count)
	return count > 0
}

type CreatedClientToken struct {
	ID    string `json:"id"`
	Token string `json:"token"`
}

func CreateClientToken(d Deps, actor *Actor, label string) (CreatedClientToken, error) {
	if strings.TrimSpace(label) == "" {
		label = "客户端令牌"
	}
	if len([]rune(label)) > 80 {
		label = string([]rune(label)[:80])
	}
	id := ids.New("cfg")
	token := ids.Token(24)
	createdBy := actor.User.ID
	row := model.ClientToken{
		ID:        id,
		Label:     label,
		TokenHash: hashToken(token),
		CreatedAt: time.Now().UTC(),
		CreatedBy: &createdBy,
	}
	if err := d.DB.Create(&row).Error; err != nil {
		return CreatedClientToken{}, err
	}
	_ = Audit(d, actor, "client_config.token.create",
		map[string]string{"type": "client_token", "id": id},
		map[string]any{"label": label})
	return CreatedClientToken{ID: id, Token: token}, nil
}

type ClientTokenItem struct {
	ID        string  `json:"id"`
	Label     string  `json:"label"`
	CreatedAt string  `json:"created_at"`
	Revoked   int     `json:"revoked"`
	CreatedBy *string `json:"created_by"`
}

func ListClientTokens(d Deps) []ClientTokenItem {
	var rows []model.ClientToken
	d.DB.Order("created_at DESC").Find(&rows)
	out := make([]ClientTokenItem, 0, len(rows))
	for _, row := range rows {
		var username *string
		if row.CreatedBy != nil {
			var user model.User
			if err := d.DB.Select("username").Where("id = ?", *row.CreatedBy).Take(&user).Error; err == nil {
				username = &user.Username
			}
		}
		out = append(out, ClientTokenItem{
			ID:        row.ID,
			Label:     row.Label,
			CreatedAt: iso.Format(row.CreatedAt),
			Revoked:   row.Revoked,
			CreatedBy: username,
		})
	}
	return out
}

func RevokeClientToken(d Deps, actor *Actor, id string) error {
	if err := d.DB.Model(&model.ClientToken{}).Where("id = ?", id).Update("revoked", 1).Error; err != nil {
		return err
	}
	return Audit(d, actor, "client_config.token.revoke",
		map[string]string{"type": "client_token", "id": id}, nil)
}

/* --------------------------- 客户端配置草稿 --------------------------- */

func normalizeClientConfig(raw map[string]any) map[string]any {
	out := map[string]any{}
	if raw == nil {
		return out
	}
	if version, ok := raw["version"].(string); ok && strings.TrimSpace(version) != "" {
		out["version"] = strings.TrimSpace(version)
	}
	if brand, ok := raw["brandProductName"].(string); ok && strings.TrimSpace(brand) != "" {
		out["brandProductName"] = strings.TrimSpace(brand)
	}
	if org, ok := raw["organization"].(map[string]any); ok {
		if id, ok := org["id"]; ok && id != nil && strings.TrimSpace(toString(id)) != "" {
			clean := map[string]any{"id": toString(id)}
			if name := toString(org["name"]); name != "" {
				clean["name"] = name
			}
			out["organization"] = clean
		}
	}
	// 能力开关：客户端按 key 读布尔值，未列出的能力由客户端默认值兜底。
	if features, ok := raw["features"].(map[string]any); ok {
		clean := map[string]bool{}
		for key, value := range features {
			name := strings.TrimSpace(key)
			if name == "" {
				continue
			}
			if b, ok := value.(bool); ok {
				clean[name] = b
			}
		}
		out["features"] = clean
	}
	// 文案覆盖：菜单/按钮等可见文案的 key → 显示名。
	if labels, ok := raw["labels"].(map[string]any); ok {
		clean := map[string]string{}
		for key, value := range labels {
			name := strings.TrimSpace(key)
			text := strings.TrimSpace(toString(value))
			if name == "" || text == "" {
				continue
			}
			clean[name] = text
		}
		out["labels"] = clean
	}
	// 编排智能体外链：只需名称 + 地址 + 图标，客户端按顺序挂到侧栏。
	if list, ok := raw["agentLinks"].([]any); ok {
		seen := map[string]struct{}{}
		clean := []any{}
		for _, item := range list {
			obj, ok := item.(map[string]any)
			if !ok {
				continue
			}
			id := strings.TrimSpace(toString(obj["id"]))
			name := strings.TrimSpace(toString(obj["name"]))
			link := strings.TrimSpace(toString(obj["url"]))
			if id == "" || name == "" || link == "" {
				continue
			}
			if _, dup := seen[id]; dup {
				continue
			}
			parsed, err := url.Parse(link)
			if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
				continue
			}
			seen[id] = struct{}{}
			entry := map[string]any{"id": id, "name": name, "url": link}
			if icon := strings.TrimSpace(toString(obj["icon"])); icon != "" {
				entry["icon"] = icon
			}
			if color := strings.TrimSpace(toString(obj["color"])); color != "" {
				entry["color"] = color
			}
			if desc := strings.TrimSpace(toString(obj["desc"])); desc != "" {
				entry["desc"] = desc
			}
			// enabled 缺省 true；openMode 仅放行 iframe/external。
			if en, ok := obj["enabled"].(bool); ok && !en {
				entry["enabled"] = false
			}
			if om := strings.TrimSpace(toString(obj["openMode"])); om == "external" {
				entry["openMode"] = "external"
			}
			clean = append(clean, entry)
			if len(clean) >= 50 {
				break
			}
		}
		out["agentLinks"] = clean
	}
	// 专家/技能市场治理：开关官方市场 + 停用指定条目。
	if mkt, ok := raw["market"].(map[string]any); ok {
		clean := map[string]any{}
		for _, sec := range []string{"experts", "skills"} {
			if s, ok := mkt[sec].(map[string]any); ok {
				c := map[string]any{"enabled": true, "disabled": cleanStringList(s["disabled"])}
				if en, ok := s["enabled"].(bool); ok {
					c["enabled"] = en
				}
				if al := cleanStringList(s["allowed"]); len(al) > 0 {
					c["allowed"] = al
				}
				clean[sec] = c
			}
		}
		for _, k := range []string{"skillsetOrigin", "skillMarketOrigin"} {
			if v := strings.TrimSpace(toString(mkt[k])); v != "" {
				clean[k] = v
			}
		}
		if len(clean) > 0 {
			out["market"] = clean
		}
	}
	// 内置连接器：停用清单（默认全部可用）。
	if con, ok := raw["connectors"].(map[string]any); ok {
		cc := map[string]any{"disabled": cleanStringList(con["disabled"])}
		if al := cleanStringList(con["allowed"]); len(al) > 0 {
			cc["allowed"] = al
		}
		if cat, ok := con["catalog"].([]any); ok && len(cat) > 0 {
			cc["catalog"] = cat
		}
		out["connectors"] = cc
	}
	if extra, ok := raw["extra"].(map[string]any); ok {
		out["extra"] = extra
	}
	if updatedAt := toString(raw["updatedAt"]); updatedAt != "" {
		out["updatedAt"] = updatedAt
	}
	if updatedBy := toString(raw["updatedBy"]); updatedBy != "" {
		out["updatedBy"] = updatedBy
	}
	return out
}

// cleanStringList 清洗字符串列表：去空白、去重、保序。
func cleanStringList(v any) []string {
	list, ok := v.([]any)
	if !ok {
		return []string{}
	}
	seen := map[string]struct{}{}
	out := []string{}
	for _, item := range list {
		s := strings.TrimSpace(toString(item))
		if s == "" {
			continue
		}
		if _, dup := seen[s]; dup {
			continue
		}
		seen[s] = struct{}{}
		out = append(out, s)
	}
	return out
}

func toString(v any) string {
	switch value := v.(type) {
	case string:
		return value
	case nil:
		return ""
	default:
		body, _ := json.Marshal(value)
		return strings.Trim(string(body), `"`)
	}
}

func LoadClientConfigDraft(d Deps) map[string]any {
	raw := d.Settings.Get("zcode.clientConfig", "")
	if raw == "" {
		return normalizeClientConfig(map[string]any{
			"version":      "1.0.0",
			"organization": map[string]any{"id": "hx", "name": d.Cfg.OrgName},
			"features":     map[string]any{},
			"labels":       map[string]any{},
			"agentLinks":   []any{},
		})
	}
	var parsed map[string]any
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		return normalizeClientConfig(map[string]any{})
	}
	return normalizeClientConfig(parsed)
}

func SaveClientConfig(d Deps, actor *Actor, patch map[string]any) (map[string]any, error) {
	current := LoadClientConfigDraft(d)
	next := map[string]any{}
	for key, value := range current {
		next[key] = value
	}
	for key, value := range patch {
		next[key] = value
	}
	next["updatedAt"] = iso.Format(time.Now().UTC())
	next["updatedBy"] = actor.User.Username
	normalized := normalizeClientConfig(next)
	body, err := json.Marshal(normalized)
	if err != nil {
		return nil, err
	}
	if err := d.Settings.Set("zcode.clientConfig", string(body)); err != nil {
		return nil, err
	}
	features := 0
	if m, ok := normalized["features"].(map[string]bool); ok {
		features = len(m)
	}
	labels := 0
	if m, ok := normalized["labels"].(map[string]string); ok {
		labels = len(m)
	}
	agentLinks := 0
	if list, ok := normalized["agentLinks"].([]any); ok {
		agentLinks = len(list)
	}
	_ = Audit(d, actor, "client_config.update",
		map[string]string{"type": "settings", "id": "zcode.clientConfig"},
		map[string]any{"version": normalized["version"], "features": features, "labels": labels, "agentLinks": agentLinks})
	return normalized, nil
}

// BuildClientConfig 组装客户端实际拿到的配置（追加服务端信息）。
func BuildClientConfig(d Deps) map[string]any {
	config := LoadClientConfigDraft(d)
	config["server"] = map[string]any{"baseUrl": d.Cfg.PublicBaseURL, "version": d.Cfg.Version}
	return config
}

/* ---------------------------- 设置白名单 ---------------------------- */

var SettingKeys = []string{
	"org_name",
	// default_register_role：注册/JIT 建档用户的默认绑定角色（harness 域 role id）
	"default_register_role",
}

func GetSettings(d Deps) map[string]string {
	out := make(map[string]string, len(SettingKeys))
	for _, key := range SettingKeys {
		out[key] = d.Settings.Get(key, "")
	}
	return out
}

func PatchSettings(d Deps, actor *Actor, patch map[string]any) error {
	for _, key := range SettingKeys {
		if value, ok := patch[key]; ok {
			if err := d.Settings.Set(key, toString(value)); err != nil {
				return err
			}
		}
	}
	return Audit(d, actor, "更新下发配置",
		map[string]string{"type": "settings", "id": "settings", "name": "下发策略"}, patch)
}
