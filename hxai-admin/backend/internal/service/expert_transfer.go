package service

import (
	"encoding/json"
	"strings"
	"time"

	"github.com/hx/control-plane/internal/model"
	"github.com/hx/control-plane/internal/platform/apperr"
	"github.com/hx/control-plane/internal/platform/ids"
	"gorm.io/gorm"
)

// 专家导出包用 key 而不是库内 id 引用插件与技能，换一套部署/数据库也能落地；
// 导入一律落到 draft，避免未经审核的外部内容直接进入客户端。

const expertTransferKind = "hxai.expert"

type expertTransferPayload struct {
	Key            string            `json:"key"`
	Name           string            `json:"name"`
	RoleTitle      string            `json:"roleTitle"`
	Emoji          string            `json:"emoji"`
	Summary        string            `json:"summary"`
	RolePrompt     string            `json:"rolePrompt"`
	Version        string            `json:"version"`
	Model          map[string]string `json:"model"`
	PermissionMode string            `json:"permissionMode"`
	PluginKeys     []string          `json:"pluginKeys"`
	SkillKeys      []string          `json:"skillKeys"`
	Visibility     string            `json:"visibility"`
	Grants         []ExpertGrantView `json:"grants"`
}

type expertTransferBundle struct {
	Kind       string                `json:"kind"`
	Version    int                   `json:"version"`
	ExportedAt string                `json:"exportedAt"`
	Expert     expertTransferPayload `json:"expert"`
}

type ExpertImportResult struct {
	Expert         ExpertView `json:"expert"`
	OriginalKey    string     `json:"originalKey"`
	KeyRemapped    bool       `json:"keyRemapped"`
	MissingPlugins []string   `json:"missingPlugins"`
	MissingSkills  []string   `json:"missingSkills"`
}

func keysInOrder(d Deps, table string, ids []string) []string {
	if len(ids) == 0 {
		return []string{}
	}
	type keyRow struct {
		ID  string
		Key string
	}
	var rows []keyRow
	d.DB.Table(table).Select("id", "`key`").Where("id IN ?", ids).Find(&rows)
	byID := make(map[string]string, len(rows))
	for _, row := range rows {
		byID[row.ID] = row.Key
	}
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		if key, ok := byID[id]; ok && key != "" {
			out = append(out, key)
		}
	}
	return uniqueStrings(out)
}

func ExportExpert(d Deps, expertID string) (string, []byte, error) {
	var row model.Expert
	if err := d.DB.Where("id = ?", expertID).Take(&row).Error; err != nil {
		return "", nil, apperr.NotFound("专家不存在")
	}
	grants := []ExpertGrantView{}
	var grantRows []model.Grant
	d.DB.Where("expert_id = ?", row.ID).Order("created_at").Find(&grantRows)
	for _, grant := range grantRows {
		grants = append(grants, ExpertGrantView{SubjectType: grant.SubjectType, SubjectID: grant.SubjectID})
	}

	payload := expertTransferPayload{
		Key:            row.Key,
		Name:           row.Name,
		RoleTitle:      derefString(row.RoleTitle),
		Emoji:          derefString(row.Emoji),
		Summary:        derefString(row.Summary),
		RolePrompt:     row.RolePrompt,
		Version:        expertVersion(row.Version),
		Model:          map[string]string{"provider": derefString(row.ModelProvider), "name": derefString(row.ModelName)},
		PermissionMode: row.Permission,
		PluginKeys:     keysInOrder(d, "plugins", parseStringArray(row.PluginIDsJSON)),
		SkillKeys:      keysInOrder(d, "skills", parseStringArray(row.SkillIDsJSON)),
		Visibility:     row.Visibility,
		Grants:         grants,
	}
	bundle := expertTransferBundle{
		Kind:       expertTransferKind,
		Version:    1,
		ExportedAt: isoFormat(time.Now().UTC()),
		Expert:     payload,
	}
	data, err := json.MarshalIndent(bundle, "", "  ")
	if err != nil {
		return "", nil, err
	}
	return row.Key + ".expert.json", append(data, '\n'), nil
}

func parseExpertTransfer(raw []byte) (*expertTransferPayload, error) {
	var envelope struct {
		Kind    string                 `json:"kind"`
		Version json.Number            `json:"version"`
		Expert  *expertTransferPayload `json:"expert"`
	}
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.UseNumber()
	if err := decoder.Decode(&envelope); err != nil {
		return nil, apperr.Bad("导入文件不是合法 JSON")
	}
	if envelope.Kind != "" && envelope.Kind != expertTransferKind {
		return nil, apperr.Bad("导入文件不是专家包")
	}
	if v, err := envelope.Version.Int64(); err == nil && v > 1 {
		return nil, apperr.Bad("专家包版本过新，请升级后台后再导入")
	}
	if envelope.Expert != nil {
		return envelope.Expert, nil
	}
	// 兼容直接粘贴专家对象（没有 Envelope 的情况）。
	var flat expertTransferPayload
	decoder = json.NewDecoder(strings.NewReader(string(raw)))
	decoder.UseNumber()
	if err := decoder.Decode(&flat); err != nil {
		return nil, apperr.Bad("导入文件不是合法 JSON")
	}
	return &flat, nil
}

func resolveKeys(d Deps, table string, keys []string) ([]string, []string) {
	clean := uniqueStrings(keys)
	if len(clean) == 0 {
		return []string{}, []string{}
	}
	type idRow struct {
		ID  string
		Key string
	}
	var rows []idRow
	d.DB.Table(table).Select("id", "`key`").Where("`key` IN ?", clean).Find(&rows)
	byKey := make(map[string]string, len(rows))
	for _, row := range rows {
		byKey[row.Key] = row.ID
	}
	ids := []string{}
	missing := []string{}
	for _, key := range clean {
		if id, ok := byKey[key]; ok {
			ids = append(ids, id)
		} else {
			missing = append(missing, key)
		}
	}
	return ids, missing
}

func ImportExpert(d Deps, actor *Actor, raw []byte) (*ExpertImportResult, error) {
	payload, err := parseExpertTransfer(raw)
	if err != nil {
		return nil, err
	}
	name := strings.TrimSpace(payload.Name)
	rolePrompt := strings.TrimSpace(payload.RolePrompt)
	missing := []string{}
	if name == "" {
		missing = append(missing, "name")
	}
	if rolePrompt == "" {
		missing = append(missing, "rolePrompt")
	}
	if len(missing) > 0 {
		return nil, apperr.Bad("专家包缺少必填字段："+joinFields(missing), map[string]any{"missing": missing})
	}

	originalKey := strings.TrimSpace(payload.Key)
	base := slugify(originalKey)
	if base == "" {
		base = slugify(name)
	}
	if base == "" {
		base = "expert"
	}
	key := base
	remapped := false
	for attempt := 0; attempt < 20; attempt++ {
		var count int64
		d.DB.Table("experts").Where("`key` = ?", key).Count(&count)
		if count == 0 {
			break
		}
		if !remapped {
			remapped = true
		}
		key = base + "-import-" + randomSuffix(4)
	}

	pluginIDs, missingPlugins := resolveKeys(d, "plugins", payload.PluginKeys)
	skillIDs, missingSkills := resolveKeys(d, "skills", payload.SkillKeys)

	visibility := payload.Visibility
	if visibility != "all" && visibility != "restricted" && visibility != "private" {
		visibility = "all"
	}
	permission := payload.PermissionMode
	if permission != "read_only" && permission != "confirm_write" && permission != "full" {
		permission = "confirm_write"
	}
	provider := strings.TrimSpace(payload.Model["provider"])
	if provider == "" {
		provider = "internal"
	}
	modelName := strings.TrimSpace(payload.Model["name"])
	if modelName == "" {
		modelName = "deepseek-v3"
	}

	now := time.Now().UTC()
	row := model.Expert{
		ID:            ids.New("exp"),
		Key:           key,
		Name:          name,
		RoleTitle:     sp(strings.TrimSpace(payload.RoleTitle)),
		Emoji:         sp(valueOrDefault(strings.TrimSpace(payload.Emoji), "🧭")),
		Summary:       sp(strings.TrimSpace(payload.Summary)),
		RolePrompt:    rolePrompt,
		Version:       expertVersion(payload.Version),
		ModelProvider: sp(provider),
		ModelName:     sp(modelName),
		Permission:    permission,
		PluginIDsJSON: mustJSON(pluginIDs),
		SkillIDsJSON:  mustJSON(skillIDs),
		Visibility:    visibility,
		Status:        "draft",
		Owner:         sp(actor.Name()),
		CreatedAt:     now,
		UpdatedAt:     now,
	}
	grants := make([]ExpertGrantView, 0, len(payload.Grants))
	for _, grant := range payload.Grants {
		if strings.TrimSpace(grant.SubjectID) != "" {
			grants = append(grants, grant)
		}
	}
	if err := d.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&row).Error; err != nil {
			return err
		}
		return saveGrants(tx, row.ID, grants)
	}); err != nil {
		return nil, err
	}

	_ = Audit(d, actor, "导入专家",
		map[string]string{"type": "expert", "id": row.ID, "name": row.Name},
		map[string]any{"from": originalKey, "key": key, "missingPlugins": missingPlugins, "missingSkills": missingSkills})
	view := toExpert(d, &row)
	return &ExpertImportResult{
		Expert:         view,
		OriginalKey:    originalKey,
		KeyRemapped:    remapped,
		MissingPlugins: missingPlugins,
		MissingSkills:  missingSkills,
	}, nil
}

func valueOrDefault(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}
