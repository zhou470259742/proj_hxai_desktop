package service

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"

	"github.com/hx/control-plane/internal/platform/apperr"
	"gorm.io/gorm"
)

var slugInvalid = regexp.MustCompile(`[^a-z0-9-]+`)

// slugify 与 admin-console 的 slugify 同构：小写、非字母数字换成连字符、去首尾、截 48。
func slugify(input string) string {
	value := slugInvalid.ReplaceAllString(strings.ToLower(strings.TrimSpace(input)), "-")
	value = strings.Trim(value, "-")
	if len(value) > 48 {
		value = value[:48]
	}
	return value
}

func ensureUnique(db *gorm.DB, table, value, excludeID string) error {
	var count int64
	query := db.Table(table).Where("`key` = ?", value)
	if excludeID != "" {
		query = query.Where("id <> ?", excludeID)
	}
	if err := query.Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return apperr.Conflict(fmt.Sprintf("标识 %s 已被占用", value))
	}
	return nil
}

// sp 返回空串指针：Node 版把可空文本列写成 ""，不是 NULL，保持同一种存储形态。
func sp(v string) *string { return &v }

func strValue(v *string) string {
	if v == nil {
		return ""
	}
	return *v
}

func mustJSON(value any) string {
	raw, err := json.Marshal(value)
	if err != nil {
		return "null"
	}
	return string(raw)
}

// uniqueStrings 去空去重且保留原顺序（Node 的 [...new Set(ids.filter(Boolean))]）。
func uniqueStrings(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	out := make([]string, 0, len(values))
	for _, value := range values {
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	return out
}

func existingIDs(d Deps, table string, values []string) []string {
	clean := uniqueStrings(values)
	if len(clean) == 0 {
		return []string{}
	}
	var found []string
	if err := d.DB.Table(table).Where("id IN ?", clean).Pluck("id", &found).Error; err != nil {
		return []string{}
	}
	return found
}

func randomSuffix(n int) string {
	const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return strings.Repeat("0", n)
	}
	for i := range b {
		b[i] = alphabet[int(b[i])%len(alphabet)]
	}
	return string(b)
}

// parseStringMap 读 JSON object 列（market_meta 等半结构化扩展字段）。
func parseStringMap(raw string) map[string]any {
	out := map[string]any{}
	if strings.TrimSpace(raw) == "" {
		return out
	}
	_ = json.Unmarshal([]byte(raw), &out)
	return out
}

func dumpStringMap(m map[string]any) string {
	if len(m) == 0 {
		return ""
	}
	b, _ := json.Marshal(m)
	return string(b)
}

func marshalStringArray(items []string) string {
	if len(items) == 0 {
		return ""
	}
	b, _ := json.Marshal(items)
	return string(b)
}

func parseStringArray(raw string) []string {
	out := []string{}
	if raw == "" {
		return out
	}
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return []string{}
	}
	return out
}

func parseObject(raw string) map[string]any {
	if raw == "" {
		return map[string]any{}
	}
	var out map[string]any
	if err := json.Unmarshal([]byte(raw), &out); err != nil || out == nil {
		return map[string]any{}
	}
	return out
}

func derefString(v *string) string {
	if v == nil {
		return ""
	}
	return *v
}

func sortedUnique(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	out := make([]string, 0, len(values))
	for _, value := range values {
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	sort.Strings(out)
	return out
}

var secretKeyPattern = regexp.MustCompile(`(?i)^(token|secret|password|apikey|api_key|clientsecret|client_secret)$`)
var secretValuePattern = regexp.MustCompile(`(?i)^(bearer|token)\s+[A-Za-z0-9._-]{16,}$`)

func sanitizeConfig(config map[string]any) map[string]any {
	out := make(map[string]any, len(config))
	for key, value := range config {
		if secretKeyPattern.MatchString(key) {
			continue
		}
		if str, ok := value.(string); ok && secretValuePattern.MatchString(str) {
			continue
		}
		out[key] = value
	}
	return out
}
