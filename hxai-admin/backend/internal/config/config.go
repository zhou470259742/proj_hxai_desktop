package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// Config 沿用 Node 版 OWCP_* 环境变量名，切换控制面时部署脚本不用重写。
type Config struct {
	Host string
	// Port 为 0 时由进程自行分配回环端口（桌面内置模式），启动后用 READY 行告诉调用方实际端口。
	Port int

	PublicDir string
	// PublicBaseURL 在 OWCP_PUBLIC_BASE_URL=auto 时由启动阶段按实际监听地址回填。
	PublicBaseURL     string
	PublicBaseURLAuto bool
	OrgName           string
	Version           string
	// 插件包与上传文件的落盘目录（对应 Node 版 dataDir）。
	DataDir string
	// 桌面端登录回调协议（授权页生成登录码后直接唤起客户端）
	DesktopDeepLinkScheme string

	Secret            string
	TokenTTL          time.Duration
	CookieName        string
	AllowAnonManifest bool
	SeedDisabled      bool

	LoginMaxFailures int
	LoginLock        time.Duration
	LoginWindow      time.Duration

	MySQLDSN string
	// DBDriver 支持 mysql（默认，服务端部署）与 sqlite（桌面内置，单文件库）。
	DBDriver   string
	SQLitePath string

	MetricsAddr string
	LogLevel    string
}

func Load() (Config, error) {
	c := Config{
		Host:                  env("HOST", "127.0.0.1"),
		Port:                  envInt("PORT", 8787),
		PublicDir:             env("PUBLIC_DIR", "../frontend"),
		DataDir:               env("DATA_DIR", "./data"),
		PublicBaseURL:         strings.TrimRight(env("OWCP_PUBLIC_BASE_URL", "http://127.0.0.1:8787"), "/"),
		OrgName:               env("OWCP_ORG_NAME", "HX"),
		Version:               env("OWCP_VERSION", "0.1.0"),
		DesktopDeepLinkScheme: env("OWCP_DESKTOP_DEEPLINK_SCHEME", "hxai"),
		Secret:                env("OWCP_SECRET", "hx-control-plane-dev-secret-change-me"),
		TokenTTL:              time.Duration(envInt("OWCP_TOKEN_TTL", 12*60*60)) * time.Second,
		CookieName:            env("OWCP_COOKIE_NAME", "owcp_session"),
		AllowAnonManifest:     envBool("OWCP_ANON_MANIFEST", false),
		SeedDisabled:          envBool("OWCP_SEED_DISABLE", false),
		LoginMaxFailures:      envInt("OWCP_LOGIN_MAX_FAILURES", 5),
		LoginLock:             time.Duration(envInt("OWCP_LOGIN_LOCK_SECONDS", 15*60)) * time.Second,
		LoginWindow:           time.Duration(envInt("OWCP_LOGIN_WINDOW_SECONDS", 15*60)) * time.Second,
		MySQLDSN:              env("MYSQL_DSN", "control:control@tcp(127.0.0.1:3306)/hx_control?charset=utf8mb4&parseTime=true&loc=UTC"),
		DBDriver:              strings.ToLower(env("HXAI_DB", "mysql")),
		SQLitePath:            env("HXAI_DB_PATH", "./data/control.db"),
		MetricsAddr:           env("METRICS_ADDR", "127.0.0.1:9090"),
		LogLevel:              env("LOG_LEVEL", "info"),
	}
	if raw := strings.TrimSpace(os.Getenv("OWCP_PUBLIC_BASE_URL")); raw == "auto" {
		c.PublicBaseURL = ""
		c.PublicBaseURLAuto = true
	}
	if c.Port < 0 || c.Port > 65535 {
		return c, fmt.Errorf("PORT 非法: %d", c.Port)
	}
	if c.DBDriver != "mysql" && c.DBDriver != "sqlite" {
		return c, fmt.Errorf("HXAI_DB 只支持 mysql 或 sqlite，当前为 %q", c.DBDriver)
	}
	if len(c.Secret) < 16 {
		return c, fmt.Errorf("OWCP_SECRET 至少 16 个字符")
	}
	return c, nil
}

func env(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

func envInt(key string, fallback int) int {
	v, err := strconv.Atoi(env(key, ""))
	if err != nil {
		return fallback
	}
	return v
}

func envBool(key string, fallback bool) bool {
	v := strings.ToLower(env(key, ""))
	if v == "" {
		return fallback
	}
	return v == "1" || v == "true" || v == "yes" || v == "on"
}
