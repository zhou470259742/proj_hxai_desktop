package httpapi

import (
	"context"
	"encoding/json"
	"github.com/cloudwego/hertz/pkg/app"
	"github.com/hx/control-plane/internal/platform/apperr"
	"github.com/hx/control-plane/internal/platform/metrics"
	"github.com/hx/control-plane/internal/service"
	"net/url"
)

func (s *Server) Login(ctx context.Context, c *app.RequestContext) {
	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
		Scope    string `json:"scope"`
	}
	if err := readJSON(c, &body); err != nil {
		s.fail(c, err)
		return
	}
	if body.Username == "" || body.Password == "" {
		s.fail(c, apperr.Bad("缺少必填字段：username、password"))
		return
	}
	result, err := service.Login(s.d, body.Username, body.Password, c.ClientIP(), string(c.UserAgent()), body.Scope)
	if err != nil {
		if e := apperr.As(err); e.Code == "too_many_attempts" {
			metrics.Login("locked")
			if detail, ok := e.Detail.(map[string]any); ok {
				if retry, ok := detail["retryAfterSeconds"].(int); ok {
					c.Header("Retry-After", itoa(retry))
				}
			}
		} else {
			metrics.Login("failure")
		}
		s.fail(c, err)
		return
	}
	metrics.Login("success")
	s.setSessionCookie(c, result.Token, int(s.d.Cfg.TokenTTL.Seconds()))
	c.JSON(200, result)
}

// LogoutRedirect RP-initiated logout：本地客户端登出后把浏览器带到
// 这里，清掉中央 SSO 会话 cookie 再 302 回客户端登录页——防止下次
// SSO 授权时命中残留会话静默登录同一账号（死循环切不了账号）。
func (s *Server) LogoutRedirect(ctx context.Context, c *app.RequestContext) {
	if value := string(c.Cookie(s.d.Cfg.CookieName)); len(value) > 0 {
		s.sessions.Revoke(value)
	}
	s.clearSessionCookie(c)
	target := string(c.QueryArgs().Peek("redirect"))
	if u, err := url.Parse(target); err != nil || u.Scheme == "" ||
		(u.Scheme != "http" && u.Scheme != "https") {
		target = "/"
	}
	// 清 cookie 不够——控制台 Bearer token 在 localStorage，残留会导致
	// boot 拿旧 token 过了 /me 又跳回 authorize 形成死循环。用返回页
	// 清完 localStorage 再跳。
	page, _ := json.Marshal(target)
	c.Data(200, "text/html; charset=utf-8", []byte(
		`<!DOCTYPE html><meta charset="utf-8"><title>已退出</title>`+
			`<script>localStorage.removeItem("owcp_token");location.replace(`+
			string(page)+`)</script>`))
}

func (s *Server) Logout(ctx context.Context, c *app.RequestContext) {
	if jti, ok := c.Get(keyJTI); ok {
		if value, ok := jti.(string); ok {
			s.sessions.Revoke(value)
		}
	}
	s.clearSessionCookie(c)
	c.JSON(200, map[string]any{"ok": true})
}

func (s *Server) AuthMe(ctx context.Context, c *app.RequestContext) {
	user, err := s.requireAuth(c)
	if err != nil {
		s.fail(c, err)
		return
	}
	c.JSON(200, map[string]any{
		"user":        service.ToPublicUser(user),
		"permissions": service.EffectivePermissions(s.d, user),
		"sessions":    s.sessions.ActiveCount(user.ID),
	})
}

func (s *Server) ChangePassword(ctx context.Context, c *app.RequestContext) {
	user, err := s.requireAuth(c)
	if err != nil {
		s.fail(c, err)
		return
	}
	var body struct {
		OldPassword string `json:"oldPassword"`
		NewPassword string `json:"newPassword"`
	}
	if err := readJSON(c, &body); err != nil {
		s.fail(c, err)
		return
	}
	if body.OldPassword == "" || body.NewPassword == "" {
		s.fail(c, apperr.Bad("缺少必填字段：oldPassword、newPassword"))
		return
	}
	if err := service.ChangePassword(s.d, user, c.ClientIP(), body.OldPassword, body.NewPassword); err != nil {
		s.fail(c, err)
		return
	}
	c.JSON(200, map[string]any{"ok": true})
}

func itoa(v int) string {
	if v == 0 {
		return "0"
	}
	digits := []byte{}
	for v > 0 {
		digits = append([]byte{byte('0' + v%10)}, digits...)
		v /= 10
	}
	return string(digits)
}
