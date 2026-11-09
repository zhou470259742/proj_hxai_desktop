package httpapi

import (
	"context"
	"net/url"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/hx/control-plane/internal/platform/apperr"
	"github.com/hx/control-plane/internal/service"
)

// OIDCDiscovery 公开元数据，供 Octop 等 RP 拉取。
func (s *Server) OIDCDiscovery(ctx context.Context, c *app.RequestContext) {
	c.JSON(200, service.Discovery(s.d))
}

func (s *Server) OIDCJWKS(ctx context.Context, c *app.RequestContext) {
	jwks, err := service.JWKS(s.d)
	if err != nil {
		s.fail(c, err)
		return
	}
	c.JSON(200, jwks)
}

// OIDCAuthorize 授权端点：要求已登录（Cookie 会话），未登录跳回后台登录页并带 next。
func (s *Server) OIDCAuthorize(ctx context.Context, c *app.RequestContext) {
	user := s.currentUser(c)
	// prompt=login（OIDC 标准）：切换账号场景强制重输凭证，忽略现有会话。
	forceLogin := string(c.QueryArgs().Peek("prompt")) == "login"
	if user == nil || forceLogin {
		next := url.QueryEscape(string(c.Request.URI().RequestURI()))
		c.Redirect(302, []byte("/?oidc_next="+next))
		return
	}
	q := url.Values{}
	c.Request.URI().QueryArgs().VisitAll(func(k, v []byte) {
		q.Set(string(k), string(v))
	})
	location, err := service.AuthorizeIssue(s.d, user, q)
	if err != nil {
		s.fail(c, err)
		return
	}
	c.Redirect(302, []byte(location))
}

// OIDCToken 令牌端点：application/x-www-form-urlencoded。
func (s *Server) OIDCToken(ctx context.Context, c *app.RequestContext) {
	form := url.Values{}
	c.Request.PostArgs().VisitAll(func(k, v []byte) {
		form.Set(string(k), string(v))
	})
	if auth := string(c.GetHeader("Authorization")); len(auth) > 6 && auth[:6] == "Basic " {
		form.Set("__basic_auth", auth[6:])
	}
	resp, err := service.TokenExchange(s.d, form)
	if err != nil {
		s.fail(c, err)
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(200, resp)
}

// OAuthClients 管理端登记客户端。
func (s *Server) ListOAuthClients(ctx context.Context, c *app.RequestContext) {
	if _, err := s.requirePerm(c, "oidc_clients"); err != nil {
		s.fail(c, err)
		return
	}
	c.JSON(200, map[string]any{"items": service.ListOAuthClients(s.d)})
}

func (s *Server) CreateOAuthClient(ctx context.Context, c *app.RequestContext) {
	user, err := s.requirePerm(c, "oidc_clients")
	if err != nil {
		s.fail(c, err)
		return
	}
	var body struct {
		ClientID     string   `json:"clientId"`
		Name         string   `json:"name"`
		RedirectURIs []string `json:"redirectUris"`
		Secret       string   `json:"secret"`
	}
	if err := readJSON(c, &body); err != nil {
		s.fail(c, apperr.Bad("请求体不是合法 JSON"))
		return
	}
	view, secret, err := service.CreateOAuthClient(s.d, &service.Actor{User: user, IP: c.ClientIP()}, body)
	if err != nil {
		s.fail(c, err)
		return
	}
	out := map[string]any{"client": view}
	if secret != "" {
		out["secret"] = secret
	}
	c.JSON(201, out)
}
