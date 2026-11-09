package httpapi

import (
	"context"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/hx/control-plane/internal/service"
)

// MarketExperts 公开目录（替代 market_stub）：Octop 实例无鉴权拉取。
func (s *Server) MarketExperts(ctx context.Context, c *app.RequestContext) {
	items, err := service.MarketExperts(s.d)
	if err != nil {
		s.fail(c, err)
		return
	}
	c.JSON(200, map[string]any{"success": true, "data": map[string]any{"items": items}})
}

// MarketExpertPackage octop 专家包下载（file = <id>.zip）。
func (s *Server) MarketExpertPackage(ctx context.Context, c *app.RequestContext) {
	name, buf, err := service.MarketExpertZip(s.d, c.Param("file"))
	if err != nil {
		s.fail(c, err)
		return
	}
	c.Header("Content-Disposition", "attachment; filename="+name)
	c.Data(200, "application/zip", buf)
}

// MarketPlugins octop 插件市场目录（公开）。
func (s *Server) MarketPlugins(ctx context.Context, c *app.RequestContext) {
	items, err := service.MarketPlugins(s.d)
	if err != nil {
		s.fail(c, err)
		return
	}
	c.JSON(200, map[string]any{"success": true, "data": map[string]any{"items": items}})
}

// UploadOctopPlugin 插件 octop 包上传（Content-Type: application/zip 二进制 body）。
func (s *Server) UploadOctopPlugin(ctx context.Context, c *app.RequestContext) {
	if _, err := s.requirePerm(c, "plugins"); err != nil {
		s.fail(c, err)
		return
	}
	data, err := c.Body()
	if err != nil {
		s.fail(c, err)
		return
	}
	result, err := service.UploadOctopPluginPackage(s.d, c.Param("id"), data)
	if err != nil {
		s.fail(c, err)
		return
	}
	c.JSON(201, result)
}

// UploadSkillPackage 技能目录包上传（zip 二进制 body）。
func (s *Server) UploadSkillPackage(ctx context.Context, c *app.RequestContext) {
	if _, err := s.requirePerm(c, "skills"); err != nil {
		s.fail(c, err)
		return
	}
	data, err := c.Body()
	if err != nil {
		s.fail(c, err)
		return
	}
	result, err := service.UploadSkillPackage(s.d, c.Param("id"), data)
	if err != nil {
		s.fail(c, err)
		return
	}
	c.JSON(201, result)
}
