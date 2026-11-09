package main

import (
	"log"
	"net"
	"net/http"
	"net/url"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// ssoLoopbackPort is the fixed loopback port the dashboard's OIDC-complete page
// posts the login code to when it detects it is running in a system browser
// instead of the embedded webview (desktop SSO via system browser).
const ssoLoopbackPort = "18765"

// startSSOLoopback hands SSO login codes delivered by the external browser back
// to the embedded webview, which finishes the exchange with its own session.
func (a *App) startSSOLoopback() {
	listener, err := net.Listen("tcp", "127.0.0.1:"+ssoLoopbackPort)
	if err != nil {
		log.Printf("sso loopback disabled: %v", err)
		return
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/sso-code", a.handleSSOCode)
	go func() {
		_ = http.Serve(listener, mux)
	}()
}

func (a *App) handleSSOCode(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	code := r.URL.Query().Get("code")
	if code == "" || r.URL.Query().Has("code") == false {
		http.Error(w, "missing code", http.StatusBadRequest)
		return
	}
	application.InvokeAsync(func() {
		a.mu.Lock()
		base := a.dashboardBase
		a.mu.Unlock()
		if base == "" || a.window == nil {
			return
		}
		a.window.SetURL(base + "/login/oidc/complete#code=" + url.QueryEscape(code))
	})
	w.WriteHeader(http.StatusNoContent)
}
