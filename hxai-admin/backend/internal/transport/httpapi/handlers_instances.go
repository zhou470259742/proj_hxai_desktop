package httpapi

import (
	"context"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/hx/control-plane/internal/service"
)

func (s *Server) ListInstances(ctx context.Context, c *app.RequestContext) {
	if _, err := s.requirePerm(c, "instances"); err != nil {
		s.fail(c, err)
		return
	}
	items, err := service.ListInstances(s.d)
	if err != nil {
		s.fail(c, err)
		return
	}
	// token 不出网
	for i := range items {
		items[i].AdminToken = ""
	}
	c.JSON(200, map[string]any{"items": items})
}

func (s *Server) CreateInstance(ctx context.Context, c *app.RequestContext) {
	if _, err := s.requirePerm(c, "instances"); err != nil {
		s.fail(c, err)
		return
	}
	var body service.InstanceInput
	if err := readJSON(c, &body); err != nil {
		s.fail(c, err)
		return
	}
	inst, err := service.CreateInstance(s.d, body)
	if err != nil {
		s.fail(c, err)
		return
	}
	inst.AdminToken = ""
	c.JSON(201, inst)
}

func (s *Server) DeleteInstance(ctx context.Context, c *app.RequestContext) {
	if _, err := s.requirePerm(c, "instances"); err != nil {
		s.fail(c, err)
		return
	}
	if err := service.DeleteInstance(s.d, c.Param("id")); err != nil {
		s.fail(c, err)
		return
	}
	c.JSON(200, map[string]any{"ok": true})
}

func (s *Server) InstanceUsers(ctx context.Context, c *app.RequestContext) {
	if _, err := s.requirePerm(c, "instances"); err != nil {
		s.fail(c, err)
		return
	}
	items, err := service.InstanceUsers(s.d, c.Param("id"))
	if err != nil {
		s.fail(c, err)
		return
	}
	c.JSON(200, map[string]any{"items": items})
}
