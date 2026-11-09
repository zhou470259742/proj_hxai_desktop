package httpapi

import (
	"context"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/hx/control-plane/internal/platform/apperr"
	"github.com/hx/control-plane/internal/service"
)

/* ------------------------------- 技能 ------------------------------- */

func (s *Server) ListSkills(ctx context.Context, c *app.RequestContext) {
	if _, err := s.requirePerm(c, "skills"); err != nil {
		s.fail(c, err)
		return
	}
	items, err := service.ListSkills(s.d)
	if err != nil {
		s.fail(c, err)
		return
	}
	c.JSON(200, map[string]any{"items": items})
}

func (s *Server) GetSkill(ctx context.Context, c *app.RequestContext) {
	if _, err := s.requirePerm(c, "skills"); err != nil {
		s.fail(c, err)
		return
	}
	skill, err := service.GetSkill(s.d, c.Param("id"))
	if err != nil {
		s.fail(c, err)
		return
	}
	c.JSON(200, skill)
}

func (s *Server) CreateSkill(ctx context.Context, c *app.RequestContext) {
	if _, err := s.requirePerm(c, "skills"); err != nil {
		s.fail(c, err)
		return
	}
	var body service.SkillInput
	if err := readJSON(c, &body); err != nil {
		s.fail(c, err)
		return
	}
	skill, err := service.CreateSkill(s.d, s.actor(c), body)
	if err != nil {
		s.fail(c, err)
		return
	}
	c.JSON(201, skill)
}

func (s *Server) UpdateSkill(ctx context.Context, c *app.RequestContext) {
	if _, err := s.requirePerm(c, "skills"); err != nil {
		s.fail(c, err)
		return
	}
	var body service.SkillInput
	if err := readJSON(c, &body); err != nil {
		s.fail(c, err)
		return
	}
	skill, err := service.UpdateSkill(s.d, s.actor(c), c.Param("id"), body)
	if err != nil {
		s.fail(c, err)
		return
	}
	c.JSON(200, skill)
}

func (s *Server) DeleteSkill(ctx context.Context, c *app.RequestContext) {
	if _, err := s.requirePerm(c, "skills_delete"); err != nil {
		s.fail(c, err)
		return
	}
	if err := service.DeleteSkill(s.d, s.actor(c), c.Param("id")); err != nil {
		s.fail(c, err)
		return
	}
	c.JSON(200, map[string]any{"ok": true})
}

/* ------------------------------- 技能导入导出 ------------------------------- */

func (s *Server) ExportSkill(ctx context.Context, c *app.RequestContext) {
	if _, err := s.requirePerm(c, "skills"); err != nil {
		s.fail(c, err)
		return
	}
	name, data, err := service.ExportSkill(s.d, c.Param("id"))
	if err != nil {
		s.fail(c, err)
		return
	}
	c.Header("Content-Disposition", `attachment; filename="`+name+`"`)
	c.Data(200, "text/markdown; charset=utf-8", data)
}

func (s *Server) ImportSkill(ctx context.Context, c *app.RequestContext) {
	if _, err := s.requirePerm(c, "skills"); err != nil {
		s.fail(c, err)
		return
	}
	raw, err := c.Body()
	if err != nil || len(raw) == 0 {
		s.fail(c, apperr.Bad("导入内容不能为空"))
		return
	}
	result, err := service.ImportSkill(s.d, s.actor(c), raw)
	if err != nil {
		s.fail(c, err)
		return
	}
	c.JSON(201, result)
}
