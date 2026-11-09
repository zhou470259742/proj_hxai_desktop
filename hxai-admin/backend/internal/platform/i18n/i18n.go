// Package i18n 用 go-i18n 渲染接口错误文案，语言按 Accept-Language / X-Client-Language 协商。
package i18n

import (
	"embed"
	"encoding/json"
	"strings"

	goi18n "github.com/nicksnyder/go-i18n/v2/i18n"
	"golang.org/x/text/language"
)

//go:embed locales/*.json
var locales embed.FS

type Translator struct {
	bundle     *goi18n.Bundle
	localizers map[string]*goi18n.Localizer
}

func New() (*Translator, error) {
	bundle := goi18n.NewBundle(language.SimplifiedChinese)
	bundle.RegisterUnmarshalFunc("json", json.Unmarshal)
	for _, name := range []string{"locales/active.zh-CN.json", "locales/active.en-US.json"} {
		if _, err := bundle.LoadMessageFileFS(locales, name); err != nil {
			return nil, err
		}
	}
	return &Translator{bundle: bundle, localizers: map[string]*goi18n.Localizer{}}, nil
}

// Translate 先按消息 ID 查词条，缺失时回落到调用方给的中文原文。
func (t *Translator) Translate(id, fallback string, data any, accepts ...string) string {
	langs := normalize(accepts)
	key := strings.Join(langs, ",")
	localizer, ok := t.localizers[key]
	if !ok {
		localizer = goi18n.NewLocalizer(t.bundle, langs...)
		t.localizers[key] = localizer
	}
	msg, err := localizer.Localize(&goi18n.LocalizeConfig{MessageID: id, TemplateData: data})
	if err != nil || msg == "" {
		return fallback
	}
	return msg
}

func normalize(accepts []string) []string {
	out := make([]string, 0, len(accepts)+1)
	for _, raw := range accepts {
		for _, part := range strings.Split(raw, ",") {
			tag := strings.TrimSpace(strings.Split(part, ";")[0])
			if tag == "" {
				continue
			}
			out = append(out, tag)
		}
	}
	if len(out) == 0 {
		out = append(out, "zh-CN")
	}
	return out
}
