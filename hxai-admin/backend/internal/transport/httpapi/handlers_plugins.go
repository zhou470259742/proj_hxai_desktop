package httpapi

import (
	"context"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/hx/control-plane/internal/service"
)

/* ------------------------------- 插件（后台） ------------------------------- */

func (s *Server) ListPlugins(ctx context.Context, c *app.RequestContext) {
	if _, err := s.requirePerm(c, "plugins"); err != nil {
		s.fail(c, err)
		return
	}
	items, err := service.ListPlugins(s.d)
	if err != nil {
		s.fail(c, err)
		return
	}
	c.JSON(200, map[string]any{"items": items})
}

func (s *Server) GetPlugin(ctx context.Context, c *app.RequestContext) {
	if _, err := s.requirePerm(c, "plugins"); err != nil {
		s.fail(c, err)
		return
	}
	plugin, err := service.GetPlugin(s.d, c.Param("id"))
	if err != nil {
		s.fail(c, err)
		return
	}
	c.JSON(200, plugin)
}

func (s *Server) CreatePlugin(ctx context.Context, c *app.RequestContext) {
	if _, err := s.requirePerm(c, "plugins"); err != nil {
		s.fail(c, err)
		return
	}
	var body service.PluginInput
	if err := readJSON(c, &body); err != nil {
		s.fail(c, err)
		return
	}
	plugin, err := service.CreatePlugin(s.d, s.actor(c), body)
	if err != nil {
		s.fail(c, err)
		return
	}
	c.JSON(201, plugin)
}

func (s *Server) UpdatePlugin(ctx context.Context, c *app.RequestContext) {
	if _, err := s.requirePerm(c, "plugins"); err != nil {
		s.fail(c, err)
		return
	}
	var body service.PluginInput
	if err := readJSON(c, &body); err != nil {
		s.fail(c, err)
		return
	}
	plugin, err := service.UpdatePlugin(s.d, s.actor(c), c.Param("id"), body)
	if err != nil {
		s.fail(c, err)
		return
	}
	c.JSON(200, plugin)
}

func (s *Server) DeletePlugin(ctx context.Context, c *app.RequestContext) {
	if _, err := s.requirePerm(c, "plugins_delete"); err != nil {
		s.fail(c, err)
		return
	}
	if err := service.DeletePlugin(s.d, s.actor(c), c.Param("id")); err != nil {
		s.fail(c, err)
		return
	}
	c.JSON(200, map[string]any{"ok": true})
}

func (s *Server) TestPlugin(ctx context.Context, c *app.RequestContext) {
	if _, err := s.requirePerm(c, "plugins"); err != nil {
		s.fail(c, err)
		return
	}
	result, err := service.TestPlugin(s.d, c.Param("id"))
	if err != nil {
		s.fail(c, err)
		return
	}
	c.JSON(200, result)
}

/* ----------------------------- 插件包托管 ----------------------------- */

func (s *Server) UploadPluginPackage(ctx context.Context, c *app.RequestContext) {
	if _, err := s.requirePerm(c, "plugins"); err != nil {
		s.fail(c, err)
		return
	}
	data, err := c.Body()
	if err != nil {
		s.fail(c, err)
		return
	}
	result, err := service.UploadPluginPackage(s.d, s.actor(c), c.Param("id"), data, c.Query("version"))
	if err != nil {
		s.fail(c, err)
		return
	}
	c.JSON(200, result)
}

/** 客户端下载插件包（匿名可读：清单本身已是公开信息，包内容不含密钥）。 */
func (s *Server) DownloadPluginPackage(ctx context.Context, c *app.RequestContext) {
	name, data, err := service.PluginPackageFile(s.d, c.Param("id"), c.Param("file"))
	if err != nil {
		s.fail(c, err)
		return
	}
	c.Header("Content-Disposition", `attachment; filename="`+name+`"`)
	c.Data(200, "application/zip", data)
}

/** 插件市场清单（ZCode 兼容格式，匿名可读）。 */
func (s *Server) MarketplaceJSON(ctx context.Context, c *app.RequestContext) {
	c.JSON(200, service.MarketplaceJSON(s.d))
}
