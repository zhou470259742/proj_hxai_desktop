package httpapi

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/hx/control-plane/internal/model"
	"github.com/hx/control-plane/internal/platform/apperr"
	"github.com/hx/control-plane/internal/platform/metrics"
	"github.com/hx/control-plane/internal/service"
	"github.com/hx/control-plane/internal/store"
	"strings"
)

func (s *Server) CreateHandoff(ctx context.Context, c *app.RequestContext) {
	user, err := s.requirePerm(c, "client_config")
	if err != nil {
		s.fail(c, err)
		return
	}
	result, err := service.CreateHandoff(s.d, user, c.ClientIP())
	if err != nil {
		s.fail(c, err)
		return
	}
	c.JSON(200, result)
}

func (s *Server) ExchangeHandoff(ctx context.Context, c *app.RequestContext) {
	var body struct {
		Grant string `json:"grant"`
	}
	if err := readJSON(c, &body); err != nil {
		s.fail(c, err)
		return
	}
	result, err := service.ExchangeHandoff(s.d, body.Grant, c.ClientIP(), string(c.UserAgent()))
	if err != nil {
		switch apperr.As(err).Code {
		case "grant_consumed":
			metrics.Handoff("consumed")
		case "grant_expired":
			metrics.Handoff("expired")
		default:
			metrics.Handoff("invalid")
		}
		s.fail(c, err)
		return
	}
	metrics.Handoff("ok")
	c.JSON(200, result)
}

func (s *Server) Health(ctx context.Context, c *app.RequestContext) {
	c.JSON(200, service.Health(s.d))
}

func (s *Server) Overview(ctx context.Context, c *app.RequestContext) {
	user, err := s.requireAuth(c)
	if err != nil {
		s.fail(c, err)
		return
	}
	c.JSON(200, service.Overview(s.d, user))
}

/* ------------------------- 客户端配置与令牌 ------------------------- */

func (s *Server) ClientConfig(ctx context.Context, c *app.RequestContext) {
	if !s.d.Cfg.AllowAnonManifest {
		header := string(c.GetHeader("Authorization"))
		if len(header) < 7 || !equalFold(header[:7], "bearer ") {
			s.fail(c, apperr.Unauthorized("拉取客户端配置需要令牌"))
			return
		}
	}
	c.JSON(200, service.BuildClientConfig(s.d))
}

// SyncUserPassword 实例回推的密码同步（同 users/status 的 Bearer 门禁）。
func (s *Server) SyncUserPassword(ctx context.Context, c *app.RequestContext) {
	if !s.d.Cfg.AllowAnonManifest {
		header := string(c.GetHeader("Authorization"))
		if len(header) < 7 || !equalFold(header[:7], "bearer ") {
			s.fail(c, apperr.Unauthorized("实例回推需要令牌"))
			return
		}
	}
	var body struct {
		Subject  string `json:"subject"`
		Password string `json:"password"`
	}
	if err := readJSON(c, &body); err != nil {
		s.fail(c, err)
		return
	}
	if body.Subject == "" || len(body.Password) < 8 {
		s.fail(c, apperr.Bad("subject/password 必填且密码至少 8 位"))
		return
	}
	if err := service.SyncUserPassword(s.d, body.Subject, body.Password); err != nil {
		s.fail(c, err)
		return
	}
	c.JSON(200, map[string]any{"ok": true})
}

// VerifyUserCredentials 实例代理登录：本地表单把账号密码转发到中心端验证，
// 返回 JIT 所需 claims。必须用真实令牌校验——这是密码预言机接口。
func (s *Server) VerifyUserCredentials(ctx context.Context, c *app.RequestContext) {
	header := string(c.GetHeader("Authorization"))
	if len(header) < 8 || !equalFold(header[:7], "bearer ") ||
		!service.TokenIsValid(s.d, header[7:]) {
		s.fail(c, apperr.Unauthorized("实例令牌无效"))
		return
	}
	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := readJSON(c, &body); err != nil {
		s.fail(c, err)
		return
	}
	claims, err := service.VerifyUserCredentials(s.d, body.Username, body.Password)
	if err != nil {
		s.fail(c, err)
		return
	}
	c.JSON(200, map[string]any{"ok": true, "claims": claims})
}

// UpsertUser 实例回推的用户建档/更新（TokenIsValid 门禁，同 verify）。
func (s *Server) UpsertUser(ctx context.Context, c *app.RequestContext) {
	header := string(c.GetHeader("Authorization"))
	if len(header) < 8 || !equalFold(header[:7], "bearer ") ||
		!service.TokenIsValid(s.d, header[7:]) {
		s.fail(c, apperr.Unauthorized("实例令牌无效"))
		return
	}
	var body struct {
		Username    string `json:"username"`
		DisplayName string `json:"display_name"`
		Password    string `json:"password"`
	}
	if err := readJSON(c, &body); err != nil {
		s.fail(c, err)
		return
	}
	if strings.TrimSpace(body.Username) == "" {
		s.fail(c, apperr.Bad("username 必填"))
		return
	}
	user, err := service.SyncUpsertUser(s.d, strings.TrimSpace(body.Username),
		strings.TrimSpace(body.DisplayName), body.Password)
	if err != nil {
		s.fail(c, err)
		return
	}
	c.JSON(200, map[string]any{"ok": true, "user": map[string]any{
		"id": user.ID, "username": user.Username, "kind": user.Kind, "role": user.Role,
	}})
}

// UsersStatus 实例同步用的用户状态清单（同 ClientConfig 的 Bearer 门禁）。
func (s *Server) UsersStatus(ctx context.Context, c *app.RequestContext) {
	if !s.d.Cfg.AllowAnonManifest {
		header := string(c.GetHeader("Authorization"))
		if len(header) < 7 || !equalFold(header[:7], "bearer ") {
			s.fail(c, apperr.Unauthorized("拉取用户状态需要令牌"))
			return
		}
	}
	c.JSON(200, map[string]any{"items": service.UserStatusForSync(s.d)})
}

func (s *Server) CreateClientToken(ctx context.Context, c *app.RequestContext) {
	user, err := s.requirePerm(c, "client_config")
	if err != nil {
		s.fail(c, err)
		return
	}
	var body struct {
		Label string `json:"label"`
	}
	_ = readJSON(c, &body)
	created, err := service.CreateClientToken(s.d, &service.Actor{User: user, IP: c.ClientIP()}, body.Label)
	if err != nil {
		s.fail(c, err)
		return
	}
	c.JSON(201, created)
}

func (s *Server) ListClientTokens(ctx context.Context, c *app.RequestContext) {
	if _, err := s.requirePerm(c, "client_config"); err != nil {
		s.fail(c, err)
		return
	}
	c.JSON(200, map[string]any{"items": service.ListClientTokens(s.d)})
}

func (s *Server) RevokeClientToken(ctx context.Context, c *app.RequestContext) {
	user, err := s.requirePerm(c, "client_config")
	if err != nil {
		s.fail(c, err)
		return
	}
	if err := service.RevokeClientToken(s.d, &service.Actor{User: user, IP: c.ClientIP()}, c.Param("id")); err != nil {
		s.fail(c, err)
		return
	}
	c.JSON(200, map[string]any{"ok": true})
}

func (s *Server) GetClientConfigDraft(ctx context.Context, c *app.RequestContext) {
	if _, err := s.requirePerm(c, "client_config"); err != nil {
		s.fail(c, err)
		return
	}
	c.JSON(200, service.LoadClientConfigDraft(s.d))
}

func (s *Server) PatchClientConfig(ctx context.Context, c *app.RequestContext) {
	user, err := s.requirePerm(c, "client_config")
	if err != nil {
		s.fail(c, err)
		return
	}
	var patch map[string]any
	if err := readJSON(c, &patch); err != nil {
		s.fail(c, err)
		return
	}
	next, err := service.SaveClientConfig(s.d, &service.Actor{User: user, IP: c.ClientIP()}, patch)
	if err != nil {
		s.fail(c, err)
		return
	}
	c.JSON(200, next)
}

func equalFold(a, b string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := 0; i < len(a); i++ {
		ca, cb := a[i], b[i]
		if 'A' <= ca && ca <= 'Z' {
			ca += 32
		}
		if 'A' <= cb && cb <= 'Z' {
			cb += 32
		}
		if ca != cb {
			return false
		}
	}
	return true
}

/* ------------------------------ 设置与审计 ------------------------------ */

func (s *Server) GetSettings(ctx context.Context, c *app.RequestContext) {
	if _, err := s.requireAuth(c); err != nil {
		s.fail(c, err)
		return
	}
	c.JSON(200, map[string]any{"settings": service.GetSettings(s.d), "baseUrl": s.d.Cfg.PublicBaseURL})
}

func (s *Server) PatchSettings(ctx context.Context, c *app.RequestContext) {
	user, err := s.requirePerm(c, "settings")
	if err != nil {
		s.fail(c, err)
		return
	}
	var patch map[string]any
	if err := readJSON(c, &patch); err != nil {
		s.fail(c, err)
		return
	}
	if err := service.PatchSettings(s.d, &service.Actor{User: user, IP: c.ClientIP()}, patch); err != nil {
		s.fail(c, err)
		return
	}
	c.JSON(200, map[string]any{"ok": true})
}

func (s *Server) ListAudit(ctx context.Context, c *app.RequestContext) {
	if _, err := s.requirePerm(c, "audit"); err != nil {
		s.fail(c, err)
		return
	}
	limit := clampInt(c.Query("limit"), 50, 1, 200)
	page := clampInt(c.Query("page"), 1, 1, 1_000_000)

	query := s.d.DB.Model(&model.AuditLog{})
	if action := c.Query("action"); action != "" {
		query = query.Where("action LIKE ?", "%"+action+"%")
	}
	if actor := c.Query("actor"); actor != "" {
		query = query.Where("actor_name LIKE ?", "%"+actor+"%")
	}
	if since := c.Query("since"); since != "" {
		if parsed, err := time.Parse(time.RFC3339, since); err == nil {
			query = query.Where("created_at >= ?", parsed.UTC())
		} else if parsed, err := time.Parse("2006-01-02", since); err == nil {
			query = query.Where("created_at >= ?", parsed.UTC())
		}
	}
	var total int64
	query.Count(&total)
	var rows []model.AuditLog
	query.Order("created_at DESC, id DESC").Limit(limit).Offset((page - 1) * limit).Find(&rows)
	items := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		items = append(items, map[string]any{
			"id":         row.ID,
			"actor":      row.ActorName,
			"action":     row.Action,
			"targetType": row.TargetType,
			"targetId":   row.TargetID,
			"target":     row.TargetName,
			"detail":     parseDetail(row.DetailJSON),
			"ip":         row.IP,
			"createdAt":  row.CreatedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
		})
	}
	c.JSON(200, map[string]any{"items": items, "total": total, "page": page, "limit": limit})
}

func (s *Server) VerifyAudit(ctx context.Context, c *app.RequestContext) {
	if _, err := s.requirePerm(c, "audit"); err != nil {
		s.fail(c, err)
		return
	}
	limit := clampInt(c.Query("limit"), 0, 0, 10_000_000)
	result, err := store.VerifyChain(s.d.DB, limit)
	if err != nil {
		s.fail(c, err)
		return
	}
	message := "审计链完整（校验 " + strconv.Itoa(result.Checked) + " 条）"
	body := map[string]any{
		"ok":       result.OK,
		"checked":  result.Checked,
		"brokenAt": nil,
		"reason":   nil,
		"message":  message,
	}
	if !result.OK && result.BrokenAt != nil && result.Reason != nil {
		message = "审计链在记录 " + strconv.FormatUint(*result.BrokenAt, 10) + " 处断裂：" + *result.Reason
		body["brokenAt"] = *result.BrokenAt
		body["reason"] = *result.Reason
		body["message"] = message
	}
	c.JSON(200, body)
}

func parseDetail(raw string) map[string]any {
	out := map[string]any{}
	if raw == "" {
		return out
	}
	_ = json.Unmarshal([]byte(raw), &out)
	return out
}

func clampInt(raw string, fallback, min, max int) int {
	value, err := strconv.Atoi(raw)
	if err != nil {
		return fallback
	}
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}

// SkillhubCatalog 代理官方/自建技能市场目录：GET /api/skillhub/catalog?origin=&page=&size=&q=&scene=
// 默认上游 api.skillhub.cn，?origin= 可指定自建源——admin 勾选界面拿真目录用。
func (s *Server) SkillhubCatalog(ctx context.Context, c *app.RequestContext) {
	if _, err := s.requirePerm(c, "client_config"); err != nil {
		s.fail(c, err)
		return
	}
	origin := strings.TrimSpace(string(c.Query("origin")))
	if origin == "" {
		origin = "https://api.skillhub.cn"
	}
	u, err := url.Parse(origin)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		s.fail(c, apperr.Bad("invalid origin"))
		return
	}
	upstream := origin + "/api/v1/skillsets"
	// type=hot|featured|newest|recommended|trending|paid → showcase 榜单端点
	if rt := strings.TrimSpace(string(c.Query("type"))); rt != "" {
		switch rt {
		case "hot", "featured", "newest", "recommended", "trending", "paid":
			upstream = origin + "/api/v1/showcase/" + rt
		}
	}
	q := url.Values{}
	for _, k := range []string{"page", "size", "q", "scene"} {
		if v := strings.TrimSpace(string(c.Query(k))); v != "" {
			q.Set(k, v)
		}
	}
	if len(q) > 0 {
		upstream += "?" + q.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, upstream, nil)
	if err != nil {
		s.fail(c, apperr.Internal(err))
		return
	}
	resp, err := (&http.Client{Timeout: 15 * time.Second}).Do(req)
	if err != nil {
		s.fail(c, apperr.New(http.StatusBadGateway, "bad_gateway", "skillhub upstream unreachable"))
		return
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		s.fail(c, apperr.Internal(err))
		return
	}
	c.Data(resp.StatusCode, "application/json; charset=utf-8", body)
}

// PushConnectorCatalog 实例上报的内置连接器目录（TokenIsValid 门禁）。
// 合并进 client-config 的 connectors.catalog，admin 勾选界面靠它渲染。
func (s *Server) PushConnectorCatalog(ctx context.Context, c *app.RequestContext) {
	header := string(c.GetHeader("Authorization"))
	if !strings.HasPrefix(header, "Bearer ") ||
		!service.TokenIsValid(s.d, header[7:]) {
		s.fail(c, apperr.Unauthorized())
		return
	}
	var body struct {
		Items []map[string]any `json:"items"`
	}
	if err := json.Unmarshal(c.Request.Body(), &body); err != nil {
		s.fail(c, apperr.Bad("invalid body"))
		return
	}
	draft := service.LoadClientConfigDraft(s.d)
	con, _ := draft["connectors"].(map[string]any)
	if con == nil {
		con = map[string]any{}
	}
	items := make([]any, 0, len(body.Items))
	for _, it := range body.Items {
		id := strings.TrimSpace(toStringAny(it["id"]))
		name := strings.TrimSpace(toStringAny(it["name"]))
		if id == "" {
			continue
		}
		items = append(items, map[string]any{"id": id, "name": name})
	}
	con["catalog"] = items
	if _, err := service.SaveClientConfig(s.d, &service.Actor{User: &model.User{Username: "instance-push"}, IP: c.ClientIP()}, map[string]any{"connectors": con}); err != nil {
		s.fail(c, err)
		return
	}
	c.JSON(200, map[string]any{"stored": len(items)})
}

// ConnectorCatalog 返回实例上报的连接器目录（插件管理页选择器用）。
func (s *Server) ConnectorCatalog(ctx context.Context, c *app.RequestContext) {
	if _, err := s.requirePerm(c, "client_config"); err != nil {
		s.fail(c, err)
		return
	}
	draft := service.LoadClientConfigDraft(s.d)
	con, _ := draft["connectors"].(map[string]any)
	c.JSON(200, map[string]any{"items": con["catalog"]})
}

func toStringAny(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}
