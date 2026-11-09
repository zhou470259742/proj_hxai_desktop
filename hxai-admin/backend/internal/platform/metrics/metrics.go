// Package metrics 暴露 Prometheus 指标。
package metrics

import (
	"net/http"
	"strconv"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

var (
	httpRequests = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "control_plane_http_requests_total",
		Help: "HTTP 请求总数（按方法、路由、状态码）",
	}, []string{"method", "route", "status"})

	httpDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "control_plane_http_request_duration_seconds",
		Help:    "HTTP 请求耗时",
		Buckets: []float64{0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5},
	}, []string{"method", "route"})

	loginAttempts = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "control_plane_login_attempts_total",
		Help: "登录尝试次数（outcome=success|failure|locked）",
	}, []string{"outcome"})

	handoffExchanges = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "control_plane_handoff_exchanges_total",
		Help: "桌面登录码兑换次数（result=ok|invalid|expired|consumed）",
	}, []string{"result"})

	asyncJobs = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "control_plane_async_jobs_total",
		Help: "异步任务执行次数（task,结果）",
	}, []string{"task", "result"})
)

func Observe(method, route string, status int, elapsed time.Duration) {
	if route == "" {
		route = "unmatched"
	}
	httpRequests.WithLabelValues(method, route, strconv.Itoa(status)).Inc()
	httpDuration.WithLabelValues(method, route).Observe(elapsed.Seconds())
}

func Login(outcome string)    { loginAttempts.WithLabelValues(outcome).Inc() }
func Handoff(result string)   { handoffExchanges.WithLabelValues(result).Inc() }
func Job(task, result string) { asyncJobs.WithLabelValues(task, result).Inc() }

func Handler() http.Handler { return promhttp.Handler() }
