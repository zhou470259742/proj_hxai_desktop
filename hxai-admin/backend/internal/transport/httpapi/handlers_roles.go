package httpapi

import (
	"context"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/hx/control-plane/internal/service"
)

// ListPermissions 返回可分配权限目录（角色编辑器用）。
// 读目录不设权限键：用户管理页给账号配角色时也要拿到角色清单。
func (s *Server) ListPermissions(ctx context.Context, c *app.RequestContext) {
	if _, err := s.requireAuth(c); err != nil {
		s.fail(c, err)
		return
	}
	c.JSON(200, map[string]any{"items": service.PermissionCatalog()})
}

func (s *Server) ListRoles(ctx context.Context, c *app.RequestContext) {
	if _, err := s.requireAuth(c); err != nil {
		s.fail(c, err)
		return
	}
	items, err := service.ListRoles(s.d)
	if err != nil {
		s.fail(c, err)
		return
	}
	c.JSON(200, map[string]any{"items": items})
}

func (s *Server) CreateRole(ctx context.Context, c *app.RequestContext) {
	if _, err := s.requirePerm(c, "roles"); err != nil {
		s.fail(c, err)
		return
	}
	var body service.RoleInput
	if err := readJSON(c, &body); err != nil {
		s.fail(c, err)
		return
	}
	role, err := service.CreateRole(s.d, s.actor(c), body)
	if err != nil {
		s.fail(c, err)
		return
	}
	c.JSON(201, role)
}

func (s *Server) UpdateRole(ctx context.Context, c *app.RequestContext) {
	if _, err := s.requirePerm(c, "roles"); err != nil {
		s.fail(c, err)
		return
	}
	var body service.RoleInput
	if err := readJSON(c, &body); err != nil {
		s.fail(c, err)
		return
	}
	role, err := service.UpdateRole(s.d, s.actor(c), c.Param("id"), body)
	if err != nil {
		s.fail(c, err)
		return
	}
	c.JSON(200, role)
}

func (s *Server) DeleteRole(ctx context.Context, c *app.RequestContext) {
	if _, err := s.requirePerm(c, "roles"); err != nil {
		s.fail(c, err)
		return
	}
	if err := service.DeleteRole(s.d, s.actor(c), c.Param("id")); err != nil {
		s.fail(c, err)
		return
	}
	c.Status(204)
}

// HarnessPermissions 智能体权限目录快照（角色编辑器 harness 域树）。
func (s *Server) HarnessPermissions(ctx context.Context, c *app.RequestContext) {
	if _, err := s.requirePerm(c, "roles"); err != nil {
		s.fail(c, err)
		return
	}
	c.JSON(200, map[string]any{"items": service.HarnessPermissions(s.d)})
}

// SyncHarnessPermissions 从首个注册实例拉取智能体权限目录。
func (s *Server) SyncHarnessPermissions(ctx context.Context, c *app.RequestContext) {
	if _, err := s.requirePerm(c, "roles"); err != nil {
		s.fail(c, err)
		return
	}
	n, err := service.SyncHarnessPermissions(s.d)
	if err != nil {
		s.fail(c, err)
		return
	}
	c.JSON(200, map[string]any{"ok": true, "count": n})
}
