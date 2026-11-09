package httpapi

import (
	"context"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/hx/control-plane/internal/platform/apperr"
	"github.com/hx/control-plane/internal/service"
)

/* ------------------------------- 专家（后台） ------------------------------- */

func (s *Server) ListExperts(ctx context.Context, c *app.RequestContext) {
	if _, err := s.requirePerm(c, "experts"); err != nil {
		s.fail(c, err)
		return
	}
	items, err := service.ListExperts(s.d)
	if err != nil {
		s.fail(c, err)
		return
	}
	c.JSON(200, map[string]any{"items": items})
}

func (s *Server) GetExpert(ctx context.Context, c *app.RequestContext) {
	if _, err := s.requirePerm(c, "experts"); err != nil {
		s.fail(c, err)
		return
	}
	expert, err := service.GetExpert(s.d, c.Param("id"))
	if err != nil {
		s.fail(c, err)
		return
	}
	c.JSON(200, expert)
}

func (s *Server) CreateExpert(ctx context.Context, c *app.RequestContext) {
	if _, err := s.requirePerm(c, "experts"); err != nil {
		s.fail(c, err)
		return
	}
	var body service.ExpertInput
	if err := readJSON(c, &body); err != nil {
		s.fail(c, err)
		return
	}
	expert, err := service.CreateExpert(s.d, s.actor(c), body)
	if err != nil {
		s.fail(c, err)
		return
	}
	c.JSON(201, expert)
}

func (s *Server) UpdateExpert(ctx context.Context, c *app.RequestContext) {
	if _, err := s.requirePerm(c, "experts"); err != nil {
		s.fail(c, err)
		return
	}
	var body service.ExpertInput
	if err := readJSON(c, &body); err != nil {
		s.fail(c, err)
		return
	}
	expert, err := service.UpdateExpert(s.d, s.actor(c), c.Param("id"), body)
	if err != nil {
		s.fail(c, err)
		return
	}
	c.JSON(200, expert)
}

func (s *Server) DeleteExpert(ctx context.Context, c *app.RequestContext) {
	if _, err := s.requirePerm(c, "experts_delete"); err != nil {
		s.fail(c, err)
		return
	}
	if err := service.DeleteExpert(s.d, s.actor(c), c.Param("id")); err != nil {
		s.fail(c, err)
		return
	}
	c.JSON(200, map[string]any{"ok": true})
}

/* ------------------------------- 专家导入导出 ------------------------------- */

func (s *Server) ExportExpert(ctx context.Context, c *app.RequestContext) {
	if _, err := s.requirePerm(c, "experts"); err != nil {
		s.fail(c, err)
		return
	}
	name, data, err := service.ExportExpert(s.d, c.Param("id"))
	if err != nil {
		s.fail(c, err)
		return
	}
	c.Header("Content-Disposition", `attachment; filename="`+name+`"`)
	c.Data(200, "application/json; charset=utf-8", data)
}

func (s *Server) ImportExpert(ctx context.Context, c *app.RequestContext) {
	if _, err := s.requirePerm(c, "experts"); err != nil {
		s.fail(c, err)
		return
	}
	raw, err := c.Body()
	if err != nil || len(raw) == 0 {
		s.fail(c, apperr.Bad("导入内容不能为空"))
		return
	}
	result, err := service.ImportExpert(s.d, s.actor(c), raw)
	if err != nil {
		s.fail(c, err)
		return
	}
	c.JSON(201, result)
}

func (s *Server) DuplicateExpert(ctx context.Context, c *app.RequestContext) {
	if _, err := s.requirePerm(c, "experts"); err != nil {
		s.fail(c, err)
		return
	}
	expert, err := service.DuplicateExpert(s.d, s.actor(c), c.Param("id"))
	if err != nil {
		s.fail(c, err)
		return
	}
	c.JSON(201, expert)
}

/* --------------------------- 专家 → 插件包（预览 / 下载 / 发布） --------------------------- */

func (s *Server) ExpertPackagePreview(ctx context.Context, c *app.RequestContext) {
	if _, err := s.requirePerm(c, "experts"); err != nil {
		s.fail(c, err)
		return
	}
	preview, err := service.ExpertPackagePreview(s.d, c.Param("id"))
	if err != nil {
		s.fail(c, err)
		return
	}
	c.JSON(200, preview)
}

func (s *Server) ExpertPackageDownload(ctx context.Context, c *app.RequestContext) {
	if _, err := s.requirePerm(c, "experts"); err != nil {
		s.fail(c, err)
		return
	}
	name, data, err := service.ExpertPackageFile(s.d, c.Param("id"))
	if err != nil {
		s.fail(c, err)
		return
	}
	c.Header("Content-Disposition", `attachment; filename="`+name+`"`)
	c.Data(200, "application/zip", data)
}

func (s *Server) PublishExpert(ctx context.Context, c *app.RequestContext) {
	if _, err := s.requirePerm(c, "experts"); err != nil {
		s.fail(c, err)
		return
	}
	result, err := service.PublishExpert(s.d, s.actor(c), c.Param("id"))
	if err != nil {
		s.fail(c, err)
		return
	}
	c.JSON(200, result)
}
