package main

import (
	"context"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/cloudwego/hertz/pkg/app/server"
	"github.com/cloudwego/hertz/pkg/common/hlog"
	"github.com/hx/control-plane/internal/config"
	"github.com/hx/control-plane/internal/platform/i18n"
	jwt "github.com/hx/control-plane/internal/platform/jwtx"
	"github.com/hx/control-plane/internal/platform/metrics"
	"github.com/hx/control-plane/internal/service"
	"github.com/hx/control-plane/internal/store"
	"github.com/hx/control-plane/internal/transport/httpapi"
	"gorm.io/gorm"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("[control-plane] 配置错误: %v", err)
	}
	if cfg.LogLevel == "debug" {
		hlog.SetLevel(hlog.LevelDebug)
	} else {
		hlog.SetLevel(hlog.LevelInfo)
	}

	db, err := openDatabase(cfg)
	if err != nil {
		log.Fatalf("[control-plane] %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		log.Fatalf("[control-plane] 取数据库连接失败: %v", err)
	}
	defer sqlDB.Close()

	migrateOpts := store.MigrateOptions{}
	if cfg.DBDriver == "sqlite" {
		migrateOpts.SQLitePath = cfg.SQLitePath
	}
	report, err := store.Migrate(db, migrateOpts)
	if err != nil {
		log.Fatalf("[control-plane] %v", err)
	}
	if report.ExistingDB && report.FromVersion < report.ToVersion {
		log.Printf("[control-plane] 数据库结构升级 %d -> %d", report.FromVersion, report.ToVersion)
		if report.BackupPath != "" {
			log.Printf("[control-plane] 升级前快照已保存: %s", report.BackupPath)
		}
	}
	seeded := false
	if !cfg.SeedDisabled {
		seeded, err = store.SeedIfEmpty(db, cfg.OrgName)
		if err != nil {
			log.Fatalf("[control-plane] 种子数据写入失败: %v", err)
		}
	}
	if err := store.EnsureAuditHead(db); err != nil {
		log.Fatalf("[control-plane] 审计链头初始化失败: %v", err)
	}

	if cfg.PublicBaseURLAuto && cfg.Port != 0 {
		cfg.PublicBaseURL = loopbackBaseURL(cfg.Host, cfg.Port)
	}

	translator, err := i18n.New()
	if err != nil {
		log.Fatalf("[control-plane] i18n 初始化失败: %v", err)
	}
	deps := service.Deps{
		Cfg:        cfg,
		DB:         db,
		Settings:   store.NewSettings(db),
		JWT:        jwt.NewIssuer(cfg.Secret, cfg.TokenTTL),
		I18N:       translator,
		LoginGuard: service.NewLoginGuard(cfg),
		StartedAt:  time.Now().UTC(),
	}

	if err := service.SeedBuiltinRoles(deps); err != nil {
		log.Fatalf("[control-plane] 内置角色种子写入失败: %v", err)
	}

	go serveMetrics(cfg.MetricsAddr)
	go runMaintenance(deps)

	// 桌面内置模式用 PORT=0：端口由内核分配。netpoll 绑定失败会 panic 在监听
	// goroutine 里，主进程接不住，所以这里自己跑 Run 并兜错，端口冲突时换一个重试。
	autoPort := cfg.Port == 0
	attempts := 1
	if autoPort {
		attempts = 2
	}
	var lastErr error
	for attempt := 1; attempt <= attempts; attempt++ {
		if autoPort {
			port, err := allocateLoopbackPort(cfg.Host)
			if err != nil {
				log.Fatalf("[control-plane] 分配回环端口失败: %v", err)
			}
			cfg.Port = port
			if cfg.PublicBaseURLAuto {
				cfg.PublicBaseURL = loopbackBaseURL(cfg.Host, port)
			}
			deps.Cfg = cfg
		}
		base := loopbackBaseURL(cfg.Host, cfg.Port)
		log.Printf("[control-plane] 启动于 %s（数据库 %s，静态资源 %s）", base, cfg.DBDriver, cfg.PublicDir)
		if seeded && attempt == 1 {
			log.Printf("[control-plane] 新库已写入默认管理员 admin / Admin@12345 —— 首次登录后请立即改密码")
		}
		if err := serve(httpapi.NewHTTPHandler(deps), base+"/v1/system/health", autoPort); err != nil {
			lastErr = err
			log.Printf("[control-plane] 第 %d 次启动失败: %v", attempt, err)
			continue
		}
		return
	}
	log.Fatalf("[control-plane] 启动失败: %v", lastErr)
}

func openDatabase(cfg config.Config) (*gorm.DB, error) {
	if cfg.DBDriver == "sqlite" {
		return store.OpenSQLite(cfg.SQLitePath)
	}
	return store.OpenMySQL(cfg.MySQLDSN)
}

// serve 自己接管 Run 与信号处理，而不是用 Spin：
// 桌面内置模式需要「绑定失败可重试」，而 Spin 把 panic 关在内部 goroutine 里。
func serve(h *server.Hertz, healthURL string, reportReady bool) error {
	errCh := make(chan error, 1)
	go func() {
		defer func() {
			if r := recover(); r != nil {
				errCh <- fmt.Errorf("监听失败: %v", r)
			}
		}()
		errCh <- h.Run()
	}()

	deadline := time.Now().Add(10 * time.Second)
	for {
		if probeHealth(healthURL) == nil {
			break
		}
		select {
		case err := <-errCh:
			return err
		default:
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("健康检查超时: %s", healthURL)
		}
		time.Sleep(100 * time.Millisecond)
	}
	if reportReady {
		// 桌面主进程按这一行取实际端口，格式不要随意改。
		fmt.Printf("HXAI_CONSOLE_READY %s\n", strings.TrimSuffix(healthURL, "/v1/system/health"))
	}

	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGINT, syscall.SIGTERM, syscall.SIGHUP)
	defer signal.Stop(signals)

	select {
	case sig := <-signals:
		log.Printf("[control-plane] 收到 %s，开始优雅退出", sig)
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := h.Shutdown(ctx); err != nil {
			return fmt.Errorf("关闭失败: %w", err)
		}
		return nil
	case err := <-errCh:
		return err
	}
}

var healthClient = &http.Client{Timeout: 2 * time.Second}

func probeHealth(url string) error {
	resp, err := healthClient.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("健康检查返回 %d", resp.StatusCode)
	}
	return nil
}

func allocateLoopbackPort(host string) (int, error) {
	ln, err := net.Listen("tcp", net.JoinHostPort(loopbackHost(host), "0"))
	if err != nil {
		return 0, err
	}
	defer ln.Close()
	return ln.Addr().(*net.TCPAddr).Port, nil
}

func loopbackHost(host string) string {
	switch strings.TrimSpace(host) {
	case "", "0.0.0.0", "::", "[::]":
		return "127.0.0.1"
	}
	return host
}

func loopbackBaseURL(host string, port int) string {
	return "http://" + net.JoinHostPort(loopbackHost(host), strconv.Itoa(port))
}

// runMaintenance 取代原来的 Asynq worker：当前只有两件低频维护任务，
// 单实例进程内跑即可，不额外引入队列和 Redis。
func runMaintenance(d service.Deps) {
	cleanup := func() {
		cutoff := time.Now().UTC().Add(-24 * time.Hour)
		result := d.DB.Exec(
			"DELETE FROM handoffs WHERE expires_at < ? AND (consumed_at IS NOT NULL OR created_at < ?)",
			cutoff, cutoff,
		)
		if result.Error != nil {
			log.Printf("[maintenance] 清理过期登录码失败: %v", result.Error)
			return
		}
		if result.RowsAffected > 0 {
			metrics.Job("handoff:cleanup-expired", "ok")
			log.Printf("[maintenance] 清理过期登录码 %d 条", result.RowsAffected)
		}
	}
	seal := func() {
		sealed, err := store.SealAuditChain(d.DB)
		if err != nil {
			metrics.Job("audit:seal-chain", "error")
			log.Printf("[maintenance] 审计封链失败: %v", err)
			return
		}
		metrics.Job("audit:seal-chain", "ok")
		if sealed > 0 {
			log.Printf("[maintenance] 审计封链完成，补链 %d 条", sealed)
		}
	}

	// 启动后先补一次，避免进程重启期间积压的过期数据滞留。
	cleanup()
	seal()

	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	lastSealDay := time.Now().UTC().Format("2006-01-02")
	for range ticker.C {
		cleanup()
		// 每天 03:30(UTC) 之后首次 tick 做一次封链自查。
		now := time.Now().UTC()
		day := now.Format("2006-01-02")
		if day != lastSealDay && (now.Hour() > 3 || (now.Hour() == 3 && now.Minute() >= 30)) {
			seal()
			lastSealDay = day
		}
	}
}

func serveMetrics(addr string) {
	mux := http.NewServeMux()
	mux.Handle("/metrics", metrics.Handler())
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})
	// 桌面内置模式用 127.0.0.1:0，必须绑定后才能知道实际端口。
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		log.Printf("[control-plane] 指标服务启动失败（%s）: %v", addr, err)
		return
	}
	log.Printf("[control-plane] 指标端点 http://%s/metrics", ln.Addr())
	if err := http.Serve(ln, mux); err != nil {
		log.Printf("[control-plane] 指标服务退出: %v", err)
	}
}
