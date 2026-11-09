package service

import "testing"

func TestBuildDesktopDeepLinkMatchesAdminConsole(t *testing.T) {
	got := BuildDesktopDeepLink("hxai", "abcDEF123_-x", "http://127.0.0.1:8787")
	want := "hxai://desktop-auth?grant=abcDEF123_-x&denBaseUrl=http%3A%2F%2F127.0.0.1%3A8787"
	if got != want {
		t.Fatalf("深链契约不一致\n got=%s\nwant=%s", got, want)
	}
}
