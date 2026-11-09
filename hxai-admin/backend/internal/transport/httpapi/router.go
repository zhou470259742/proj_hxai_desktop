package httpapi

import (
	"bytes"
	"context"
	"fmt"
	"mime"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/app/server"
	"github.com/hx/control-plane/internal/service"
)

func NewHTTPHandler(d service.Deps) *server.Hertz {
	s := NewServer(d)
	h := server.Default(
		server.WithHostPorts(d.Cfg.Host+":"+itoa(d.Cfg.Port)),
		// 插件包 zip 上限 50MB，Hertz 默认 4MB 会在读取前直接拒绝。
		server.WithMaxRequestBodySize(51*1024*1024),
	)
	h.Use(CORSMiddleware, RequestIDMiddleware, s.Recover, MetricsMiddleware, s.AttachUser, s.EnforceCSRF)

	// 认证
	h.POST("/api/auth/login", s.Login)
	h.POST("/api/auth/logout", s.Logout)
	h.GET("/logout", s.LogoutRedirect)
	h.GET("/api/auth/me", s.AuthMe)
	h.POST("/api/auth/password", s.ChangePassword)

	// 用户与角色
	h.GET("/api/users", s.ListUsers)
	h.POST("/api/users", s.CreateUser)
	h.PATCH("/api/users/:id", s.UpdateUser)
	h.DELETE("/api/users/:id", s.DeleteUser)
	h.GET("/api/permissions", s.ListPermissions)
	h.GET("/api/roles", s.ListRoles)
	h.POST("/api/roles", s.CreateRole)
	h.PATCH("/api/roles/:id", s.UpdateRole)
	h.DELETE("/api/roles/:id", s.DeleteRole)

	// 概览 / 审计 / 设置
	h.GET("/api/overview", s.Overview)
	h.GET("/api/audit", s.ListAudit)
	h.GET("/api/audit/verify", s.VerifyAudit)
	h.GET("/api/settings", s.GetSettings)
	h.PATCH("/api/settings", s.PatchSettings)

	// 专家（工作模式）
	h.GET("/api/experts", s.ListExperts)
	h.POST("/api/experts", s.CreateExpert)
	h.POST("/api/experts/import", s.ImportExpert)
	h.GET("/api/experts/:id", s.GetExpert)
	h.PATCH("/api/experts/:id", s.UpdateExpert)
	h.DELETE("/api/experts/:id", s.DeleteExpert)
	h.POST("/api/experts/:id/duplicate", s.DuplicateExpert)
	h.GET("/api/experts/:id/export", s.ExportExpert)
	h.GET("/api/experts/:id/package/preview", s.ExpertPackagePreview)
	h.GET("/api/experts/:id/package", s.ExpertPackageDownload)
	h.POST("/api/experts/:id/publish", s.PublishExpert)

	// 插件
	h.GET("/api/plugins", s.ListPlugins)
	h.POST("/api/plugins", s.CreatePlugin)
	h.GET("/api/plugins/:id", s.GetPlugin)
	h.PATCH("/api/plugins/:id", s.UpdatePlugin)
	h.DELETE("/api/plugins/:id", s.DeletePlugin)
	h.POST("/api/plugins/:id/test", s.TestPlugin)
	h.POST("/api/plugins/:id/package", s.UploadPluginPackage)

	// 技能
	h.GET("/api/skills", s.ListSkills)
	h.POST("/api/skills", s.CreateSkill)
	h.POST("/api/skills/import", s.ImportSkill)
	h.GET("/api/skills/:id", s.GetSkill)
	h.PATCH("/api/skills/:id", s.UpdateSkill)
	h.DELETE("/api/skills/:id", s.DeleteSkill)
	h.GET("/api/skills/:id/export", s.ExportSkill)

	// OIDC 客户端登记（管理端）
	h.GET("/api/oauth/clients", s.ListOAuthClients)
	h.POST("/api/oauth/clients", s.CreateOAuthClient)

	// 实例注册：跨实例统一视图（拉取式聚合）
	h.GET("/api/instances", s.ListInstances)
	h.POST("/api/instances", s.CreateInstance)
	h.DELETE("/api/instances/:id", s.DeleteInstance)
	h.GET("/api/instances/:id/users", s.InstanceUsers)

	// 客户端配置下发（管理端）：handoff 配对 + 配置草稿 + 访问令牌
	h.POST("/api/desktop/handoff", s.CreateHandoff)
	h.GET("/api/client-config", s.GetClientConfigDraft)
	h.GET("/api/skillhub/catalog", s.SkillhubCatalog)
	h.GET("/api/connectors/catalog", s.ConnectorCatalog)
	h.PATCH("/api/client-config", s.PatchClientConfig)
	h.POST("/api/client-config/token", s.CreateClientToken)
	h.GET("/api/client-config/tokens", s.ListClientTokens)
	h.DELETE("/api/client-config/tokens/:id", s.RevokeClientToken)

	// OIDC Provider（公开端点，供 Octop sso_oidc 等 RP 对接）
	h.GET("/.well-known/openid-configuration", s.OIDCDiscovery)
	h.GET("/oauth/jwks", s.OIDCJWKS)
	h.GET("/oauth/authorize", s.OIDCAuthorize)
	h.POST("/oauth/token", s.OIDCToken)

	// 客户端（v1）：登录后拉取功能配置 + handoff 换 token + 插件包下载
	h.POST("/v1/auth/desktop-handoff/exchange", s.ExchangeHandoff)
	h.GET("/v1/client-config", s.ClientConfig)
	h.GET("/v1/users/status", s.UsersStatus)
	h.POST("/v1/users", s.UpsertUser)
	h.POST("/v1/connectors/catalog", s.PushConnectorCatalog)
	h.POST("/v1/users/password", s.SyncUserPassword)
	h.POST("/v1/auth/verify", s.VerifyUserCredentials)
	h.GET("/v1/packages/:id/:file", s.DownloadPluginPackage)
	h.GET("/v1/system/health", s.Health)
	// Octop 私有市场协议（公开，实例无鉴权拉取）
	h.GET("/api/market/experts", s.MarketExperts)
	h.GET("/api/market/plugins", s.MarketPlugins)
	h.POST("/api/plugins/:id/octop-package", s.UploadOctopPlugin)
	h.POST("/api/skills/:id/package", s.UploadSkillPackage)
	h.POST("/api/users/:id/reset-password", s.ResetUserPassword)
	h.GET("/api/harness-permissions", s.HarnessPermissions)
	h.POST("/api/harness-permissions/sync", s.SyncHarnessPermissions)
	h.GET("/api/market/packages/experts/:file", s.MarketExpertPackage)

	// 静态资源与单页回退（Node 版同款行为）
	h.NoRoute(s.ServeStatic)
	return h
}

func (s *Server) ServeStatic(ctx context.Context, c *app.RequestContext) {
	if string(c.Method()) != "GET" {
		s.notFound(c)
		return
	}
	rawPath := string(c.Path())
	unescaped, err := url.PathUnescape(rawPath)
	if err != nil {
		unescaped = rawPath
	}
	if filePath, ok := safeStaticPath(s.d.Cfg.PublicDir, unescaped); ok {
		if data, err := os.ReadFile(filePath); err == nil {
			c.Header("Cache-Control", "no-cache")
			c.Data(200, contentTypeOf(filePath), s.injectAppVersion(filePath, data))
			return
		}
	}
	if strings.HasPrefix(unescaped, "/api/") || strings.HasPrefix(unescaped, "/v1/") {
		s.notFound(c)
		return
	}
	if filePath, ok := safeStaticPath(s.d.Cfg.PublicDir, "/index.html"); ok {
		if data, err := os.ReadFile(filePath); err == nil {
			c.Header("Cache-Control", "no-cache")
			c.Data(200, "text/html; charset=utf-8", s.injectAppVersion(filePath, data))
			return
		}
	}
	s.notFound(c)
}

// injectAppVersion 给 index.html 里的静态引用（app.js/styles.css）注入
// mtime 版本号——文件一改 URL 就变，根治「页面拿旧资源」类问题。
func (s *Server) injectAppVersion(filePath string, data []byte) []byte {
	if filepath.Base(filePath) != "index.html" {
		return data
	}
	for _, asset := range []struct{ ref, name string }{
		{`src="/app.js"`, "app.js"},
		{`href="/styles.css"`, "styles.css"},
	} {
		info, err := os.Stat(filepath.Join(s.d.Cfg.PublicDir, asset.name))
		if err != nil {
			continue
		}
		attr := "src"
		if asset.name != "app.js" {
			attr = "href"
		}
		data = bytes.Replace(data,
			[]byte(asset.ref),
			[]byte(fmt.Sprintf(`%s="/%s?v=%d"`, attr, asset.name, info.ModTime().Unix())),
			1,
		)
	}
	return data
}

func (s *Server) notFound(c *app.RequestContext) {
	c.JSON(404, map[string]any{
		"error":   "not_found",
		"message": "接口不存在: " + string(c.Method()) + " " + string(c.Path()),
	})
}

func safeStaticPath(publicDir, requestPath string) (string, bool) {
	cleaned := path.Clean("/" + strings.TrimPrefix(requestPath, "/"))
	if cleaned == "/" {
		cleaned = "/index.html"
	}
	root, err := filepath.Abs(publicDir)
	if err != nil {
		return "", false
	}
	target, err := filepath.Abs(filepath.Join(root, filepath.FromSlash(cleaned)))
	if err != nil {
		return "", false
	}
	rel, err := filepath.Rel(root, target)
	if err != nil || strings.HasPrefix(rel, "..") {
		return "", false
	}
	info, err := os.Stat(target)
	if err != nil || info.IsDir() {
		return "", false
	}
	return target, true
}

func contentTypeOf(filePath string) string {
	contentType := mime.TypeByExtension(filepath.Ext(filePath))
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	return contentType
}
