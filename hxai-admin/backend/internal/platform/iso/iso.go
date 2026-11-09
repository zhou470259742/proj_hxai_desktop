// Package iso 输出与 Node 版完全一致的 ISO 时间串（毫秒三位、UTC、Z 结尾）。
package iso

import "time"

const layout = "2006-01-02T15:04:05.000Z"

func Format(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.UTC().Format(layout)
}

func Ptr(t *time.Time) *string {
	if t == nil || t.IsZero() {
		return nil
	}
	v := Format(*t)
	return &v
}
