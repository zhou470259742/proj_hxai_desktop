package httpapi

import (
	"context"
	"net/url"
	"strings"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/hx/control-plane/internal/platform/apperr"
	"github.com/hx/control-plane/internal/platform/metrics"
)

// AttachUser 先认身份再校验写来源；CSRF 判据与 Node 版一致：
// 只有"靠 Cookie 认出来"的写操作才要求同源，Bearer 请求本身免疫 CSRF。
func (s *Server) AttachUser(ctx context.Context, c *app.RequestContext) {
	token, viaCookie := tokenFromRequest(c, s.d.Cfg.CookieName)
	if token == "" {
		return
	}
	user, jti, err := s.sessions.Validate(token)
	if err != nil || user == nil {
		return
	}
	c.Set(keyUser, user)
	c.Set(keyJTI, jti)
	c.Set(keyViaCookie, viaCookie)
}

func (s *Server) EnforceCSRF(ctx context.Context, c *app.RequestContext) {
	method := strings.ToUpper(string(c.Method()))
	if method == "GET" || method == "HEAD" || method == "OPTIONS" {
		return
	}
	viaCookie, _ := c.Get(keyViaCookie)
	if ok, _ := viaCookie.(bool); !ok {
		return
	}
	origin := string(c.GetHeader("Origin"))
	if origin == "" {
		origin = originFromReferer(string(c.GetHeader("Referer")))
	}
	if origin == "" {
		return
	}
	allowed := map[string]struct{}{}
	if host := string(c.Host()); host != "" {
		allowed[protoOf(c)+"://"+host] = struct{}{}
	}
	if parsed, err := url.Parse(s.d.Cfg.PublicBaseURL); err == nil && parsed.Scheme != "" && parsed.Host != "" {
		allowed[parsed.Scheme+"://"+parsed.Host] = struct{}{}
	}
	if _, ok := allowed[origin]; ok {
		return
	}
	panic(apperr.New(403, "csrf_origin_mismatch", "跨站写操作被拒绝（来源 "+origin+" 不在允许列表）"))
}

func originFromReferer(referer string) string {
	if referer == "" {
		return ""
	}
	parsed, err := url.Parse(referer)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return ""
	}
	return parsed.Scheme + "://" + parsed.Host
}

func protoOf(c *app.RequestContext) string {
	forwarded := strings.TrimSpace(strings.Split(string(c.GetHeader("X-Forwarded-Proto")), ",")[0])
	if forwarded == "https" || forwarded == "http" {
		return forwarded
	}
	return "http"
}

func tokenFromRequest(c *app.RequestContext, cookieName string) (string, bool) {
	header := string(c.GetHeader("Authorization"))
	if strings.HasPrefix(strings.ToLower(header), "bearer ") {
		return strings.TrimSpace(header[7:]), false
	}
	if raw := c.Cookie(cookieName); len(raw) > 0 {
		return string(raw), true
	}
	return "", false
}

// CORSMiddleware 与 Node 版一致：反射 Origin 并允许携带 Cookie。
func CORSMiddleware(ctx context.Context, c *app.RequestContext) {
	origin := string(c.GetHeader("Origin"))
	if origin == "" {
		origin = "*"
	}
	c.Header("Access-Control-Allow-Origin", origin)
	c.Header("Access-Control-Allow-Credentials", "true")
	c.Header("Access-Control-Allow-Headers", "content-type, authorization, x-ow-gateway-key, if-none-match, x-client-language")
	c.Header("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS")
	c.Header("X-Content-Type-Options", "nosniff")
	if strings.ToUpper(string(c.Method())) == "OPTIONS" {
		c.SetStatusCode(204)
		c.Abort()
	}
}

func RequestIDMiddleware(ctx context.Context, c *app.RequestContext) {
	id := string(c.GetHeader("X-Request-ID"))
	if id == "" {
		id = time.Now().UTC().Format("20060102T150405.000000Z")
	}
	c.Header("X-Request-ID", id)
}

func MetricsMiddleware(ctx context.Context, c *app.RequestContext) {
	started := time.Now()
	c.Next(ctx)
	metrics.Observe(string(c.Method()), c.FullPath(), c.Response.StatusCode(), time.Since(started))
}

// Recover 把 handler 里 panic 的业务错误转成统一 JSON 响应。
func (s *Server) Recover(ctx context.Context, c *app.RequestContext) {
	defer func() {
		if recovered := recover(); recovered != nil {
			if err, ok := recovered.(error); ok {
				s.fail(c, err)
				c.Abort()
				return
			}
			c.AbortWithStatus(500)
		}
	}()
	c.Next(ctx)
}
