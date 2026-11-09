package httpapi

import (
	"context"
	"github.com/cloudwego/hertz/pkg/app"
	"github.com/hx/control-plane/internal/service"
)

func (s *Server) ListUsers(ctx context.Context, c *app.RequestContext) {
	user, err := s.requirePerm(c, "users")
	if err != nil {
		s.fail(c, err)
		return
	}
	items, err := service.ListUsers(s.d, user)
	if err != nil {
		s.fail(c, err)
		return
	}
	c.JSON(200, map[string]any{"items": items})
}

func (s *Server) CreateUser(ctx context.Context, c *app.RequestContext) {
	user, err := s.requirePerm(c, "users")
	if err != nil {
		s.fail(c, err)
		return
	}
	var body service.CreateUserInput
	if err := readJSON(c, &body); err != nil {
		s.fail(c, err)
		return
	}
	created, err := service.CreateUser(s.d, s.actor(c), body)
	if err != nil {
		s.fail(c, err)
		return
	}
	_ = user
	c.JSON(201, created)
}

func (s *Server) UpdateUser(ctx context.Context, c *app.RequestContext) {
	if _, err := s.requirePerm(c, "users"); err != nil {
		s.fail(c, err)
		return
	}
	var body service.UpdateUserInput
	if err := readJSON(c, &body); err != nil {
		s.fail(c, err)
		return
	}
	updated, err := service.UpdateUser(s.d, s.actor(c), c.Param("id"), body)
	if err != nil {
		s.fail(c, err)
		return
	}
	c.JSON(200, updated)
}

func (s *Server) DeleteUser(ctx context.Context, c *app.RequestContext) {
	if _, err := s.requirePerm(c, "users"); err != nil {
		s.fail(c, err)
		return
	}
	if err := service.DeleteUser(s.d, s.actor(c), c.Param("id")); err != nil {
		s.fail(c, err)
		return
	}
	c.JSON(200, map[string]any{"ok": true})
}

// ResetUserPassword 管理员一键重置：返回一次性明文临时密码。
func (s *Server) ResetUserPassword(ctx context.Context, c *app.RequestContext) {
	if _, err := s.requirePerm(c, "users"); err != nil {
		s.fail(c, err)
		return
	}
	tmp, err := service.ResetUserPassword(s.d, s.actor(c), c.Param("id"))
	if err != nil {
		s.fail(c, err)
		return
	}
	c.JSON(200, map[string]any{"password": tmp})
}
