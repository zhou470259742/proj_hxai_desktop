package httpapi

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/protocol"
	"github.com/hx/control-plane/internal/model"
	"github.com/hx/control-plane/internal/platform/apperr"
	"github.com/hx/control-plane/internal/service"
)

const (
	keyUser      = "auth.user"
	keyJTI       = "auth.jti"
	keyViaCookie = "auth.via_cookie"
)

type Server struct {
	d        service.Deps
	sessions *service.SessionManager
}

func NewServer(d service.Deps) *Server {
	return &Server{d: d, sessions: service.NewSessionManager(d)}
}

func (s *Server) Deps() service.Deps { return s.d }

func (s *Server) currentUser(c *app.RequestContext) *model.User {
	value, ok := c.Get(keyUser)
	if !ok {
		return nil
	}
	user, _ := value.(*model.User)
	return user
}

func (s *Server) actor(c *app.RequestContext) *service.Actor {
	return &service.Actor{User: s.currentUser(c), IP: c.ClientIP()}
}

func (s *Server) requireAuth(c *app.RequestContext) (*model.User, error) {
	user := s.currentUser(c)
	if user == nil {
		return nil, apperr.Unauthorized()
	}
	return user, nil
}

func (s *Server) requireRole(c *app.RequestContext, roles ...string) (*model.User, error) {
	user, err := s.requireAuth(c)
	if err != nil {
		return nil, err
	}
	for _, role := range roles {
		if user.Role == role {
			return user, nil
		}
	}
	return nil, apperr.Forbidden()
}

// requirePerm 按权限键判权（service/rbac.go 目录）；admin 恒通过。
// 新代码统一用它，requireRole 仅保留给尚未迁移的调用点。
func (s *Server) requirePerm(c *app.RequestContext, key string) (*model.User, error) {
	user, err := s.requireAuth(c)
	if err != nil {
		return nil, err
	}
	if !service.HasModulePerm(s.d, user, key, string(c.Method())) {
		return nil, apperr.Forbidden()
	}
	return user, nil
}

func (s *Server) fail(c *app.RequestContext, err error) {
	e := apperr.As(err)
	if e.Status >= http.StatusInternalServerError {
		log.Printf("[error] %s %s: %v", c.Method(), c.Path(), err)
	}
	message := e.Message
	if message == "" {
		message = "服务器内部错误"
	}
	data := map[string]any{}
	if detail, ok := e.Detail.(map[string]any); ok {
		if retry, ok := detail["retryAfterSeconds"]; ok {
			data["RetryAfter"] = retry
		}
	}
	langs := []string{string(c.GetHeader("Accept-Language")), string(c.GetHeader("X-Client-Language"))}
	if translated := s.d.I18N.Translate("error."+e.Code, "", data, langs...); translated != "" {
		message = translated
	}
	body := map[string]any{"error": e.Code, "message": message}
	if e.Detail != nil {
		body["detail"] = e.Detail
	}
	c.JSON(e.Status, body)
}

func readJSON(c *app.RequestContext, dst any) error {
	raw, err := c.Body()
	if err != nil {
		return apperr.Bad("读取请求体失败")
	}
	if len(raw) == 0 {
		return apperr.Bad("请求体不能为空")
	}
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.UseNumber()
	if err := decoder.Decode(dst); err != nil {
		return apperr.Bad("请求体不是合法 JSON")
	}
	return nil
}

func (s *Server) setSessionCookie(c *app.RequestContext, token string, maxAge int) {
	c.SetCookie(s.d.Cfg.CookieName, token, maxAge, "/", "", protocol.CookieSameSiteLaxMode, false, true)
}

func (s *Server) clearSessionCookie(c *app.RequestContext) {
	s.setSessionCookie(c, "", 0)
}
