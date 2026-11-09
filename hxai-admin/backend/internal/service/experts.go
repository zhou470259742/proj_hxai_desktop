package service

import (
	"strconv"
	"strings"
	"time"

	"github.com/hx/control-plane/internal/model"
	"github.com/hx/control-plane/internal/platform/apperr"
	"github.com/hx/control-plane/internal/platform/ids"
	"gorm.io/gorm"
)

/* --------------------------- 专家（工作模式） --------------------------- */

type expertPluginRef struct {
	Key  string `json:"key"`
	Name string `json:"name"`
}

type expertSkillRef struct {
	Key     string `json:"key"`
	Name    string `json:"name"`
	Version string `json:"version"`
}

type ExpertGrantView struct {
	SubjectType string `json:"subjectType"`
	SubjectID   string `json:"subjectId"`
}

type ExpertView struct {
	ID             string             `json:"id"`
	Key            string             `json:"key"`
	Name           string             `json:"name"`
	RoleTitle      *string            `json:"roleTitle"`
	Emoji          *string            `json:"emoji"`
	Summary        *string            `json:"summary"`
	RolePrompt     string             `json:"rolePrompt"`
	Version        string             `json:"version"`
	Model          map[string]*string `json:"model"`
	PermissionMode string             `json:"permissionMode"`
	PluginIDs      []string           `json:"pluginIds"`
	SkillIDs       []string           `json:"skillIds"`
	Plugins        []expertPluginRef  `json:"plugins"`
	Skills         []expertSkillRef   `json:"skills"`
	Visibility     string             `json:"visibility"`
	MarketMeta     map[string]any     `json:"marketMeta"`
	Status         string             `json:"status"`
	Owner          *string            `json:"owner"`
	Grants         []ExpertGrantView  `json:"grants"`
	CreatedAt      string             `json:"createdAt"`
	UpdatedAt      string             `json:"updatedAt"`
}

func toExpert(d Deps, row *model.Expert) ExpertView {
	pluginIDs := parseStringArray(row.PluginIDsJSON)
	skillIDs := parseStringArray(row.SkillIDsJSON)

	plugins := []expertPluginRef{}
	if len(pluginIDs) > 0 {
		var rows []model.Plugin
		d.DB.Select("key", "name").Where("id IN ?", pluginIDs).Find(&rows)
		for _, plugin := range rows {
			plugins = append(plugins, expertPluginRef{Key: plugin.Key, Name: plugin.Name})
		}
	}
	skills := []expertSkillRef{}
	if len(skillIDs) > 0 {
		var rows []model.Skill
		d.DB.Select("key", "name", "version").Where("id IN ?", skillIDs).Find(&rows)
		for _, skill := range rows {
			skills = append(skills, expertSkillRef{Key: skill.Key, Name: skill.Name, Version: skill.Version})
		}
	}
	grants := []ExpertGrantView{}
	var grantRows []model.Grant
	d.DB.Where("expert_id = ?", row.ID).Find(&grantRows)
	for _, grant := range grantRows {
		grants = append(grants, ExpertGrantView{SubjectType: grant.SubjectType, SubjectID: grant.SubjectID})
	}

	return ExpertView{
		ID:             row.ID,
		Key:            row.Key,
		Name:           row.Name,
		RoleTitle:      row.RoleTitle,
		Emoji:          row.Emoji,
		Summary:        row.Summary,
		RolePrompt:     row.RolePrompt,
		Version:        expertVersion(row.Version),
		Model:          map[string]*string{"provider": row.ModelProvider, "name": row.ModelName},
		PermissionMode: row.Permission,
		PluginIDs:      pluginIDs,
		SkillIDs:       skillIDs,
		Plugins:        plugins,
		Skills:         skills,
		Visibility:     row.Visibility,
		MarketMeta:     parseStringMap(row.MarketMetaJSON),
		Status:         row.Status,
		Owner:          row.Owner,
		Grants:         grants,
		CreatedAt:      isoFormat(row.CreatedAt),
		UpdatedAt:      isoFormat(row.UpdatedAt),
	}
}

func ListExperts(d Deps) ([]ExpertView, error) {
	var rows []model.Expert
	if err := d.DB.Order("created_at DESC").Find(&rows).Error; err != nil {
		return nil, err
	}
	items := make([]ExpertView, 0, len(rows))
	for i := range rows {
		items = append(items, toExpert(d, &rows[i]))
	}
	return items, nil
}

func GetExpert(d Deps, id string) (*ExpertView, error) {
	var row model.Expert
	if err := d.DB.Where("id = ?", id).Take(&row).Error; err != nil {
		return nil, apperr.NotFound("专家不存在")
	}
	view := toExpert(d, &row)
	return &view, nil
}

type expertModelInput struct {
	Provider *string `json:"provider"`
	Name     *string `json:"name"`
}

type ExpertInput struct {
	Name           *string            `json:"name"`
	Key            *string            `json:"key"`
	RoleTitle      *string            `json:"roleTitle"`
	Emoji          *string            `json:"emoji"`
	Summary        *string            `json:"summary"`
	RolePrompt     *string            `json:"rolePrompt"`
	Version        *string            `json:"version"`
	Model          *expertModelInput  `json:"model"`
	PermissionMode *string            `json:"permissionMode"`
	PluginIDs      *[]string          `json:"pluginIds"`
	SkillIDs       *[]string          `json:"skillIds"`
	Visibility     *string            `json:"visibility"`
	Status         *string            `json:"status"`
	Grants         *[]ExpertGrantView `json:"grants"`
	MarketMeta     map[string]any     `json:"marketMeta"`
}

func valueOr(v *string, fallback string) string {
	if v == nil {
		return fallback
	}
	return *v
}

// expertVersion 统一版本号归一化：空值回落 1.0.0，并与插件/技能一样限制在 40 字符内。
func expertVersion(raw string) string {
	v := strings.TrimSpace(raw)
	if v == "" {
		return "1.0.0"
	}
	if len(v) > 40 {
		v = v[:40]
	}
	return v
}

func modelProviderOf(model *expertModelInput, fallback string) string {
	if model == nil || model.Provider == nil || *model.Provider == "" {
		return fallback
	}
	return *model.Provider
}

func modelNameOf(model *expertModelInput, fallback string) string {
	if model == nil || model.Name == nil || *model.Name == "" {
		return fallback
	}
	return *model.Name
}

func saveGrants(tx *gorm.DB, expertID string, grants []ExpertGrantView) error {
	if err := tx.Where("expert_id = ?", expertID).Delete(&model.Grant{}).Error; err != nil {
		return err
	}
	now := time.Now().UTC()
	for _, grant := range grants {
		if strings.TrimSpace(grant.SubjectID) == "" {
			continue
		}
		subjectType := grant.SubjectType
		if subjectType == "" {
			subjectType = "department"
		}
		row := model.Grant{
			ID:          ids.New("grt"),
			ExpertID:    expertID,
			SubjectType: subjectType,
			SubjectID:   grant.SubjectID,
			CreatedAt:   now,
		}
		if err := tx.Create(&row).Error; err != nil {
			return err
		}
	}
	return nil
}

func CreateExpert(d Deps, actor *Actor, in ExpertInput) (*ExpertView, error) {
	name := strings.TrimSpace(derefString(in.Name))
	rolePrompt := strings.TrimSpace(derefString(in.RolePrompt))
	missing := []string{}
	if in.Name == nil || name == "" {
		missing = append(missing, "name")
	}
	if in.RolePrompt == nil || rolePrompt == "" {
		missing = append(missing, "rolePrompt")
	}
	if len(missing) > 0 {
		return nil, apperr.Bad("缺少必填字段："+joinFields(missing), map[string]any{"missing": missing})
	}

	keySource := derefString(in.Key)
	if keySource == "" {
		keySource = *in.Name
	}
	key := slugify(keySource)
	if key == "" {
		key = "expert-" + strconv.FormatInt(time.Now().UnixMilli(), 10)
	}
	if err := ensureUnique(d.DB, "experts", key, ""); err != nil {
		return nil, err
	}

	pluginIDs := existingIDs(d, "plugins", derefStringSlice(in.PluginIDs))
	skillIDs := existingIDs(d, "skills", derefStringSlice(in.SkillIDs))
	status := valueOr(in.Status, "draft")
	now := time.Now().UTC()
	row := model.Expert{
		ID:             ids.New("exp"),
		Key:            key,
		Name:           *in.Name,
		RoleTitle:      sp(valueOr(in.RoleTitle, "")),
		Emoji:          sp(valueOr(in.Emoji, "🧭")),
		Summary:        sp(valueOr(in.Summary, "")),
		RolePrompt:     *in.RolePrompt,
		Version:        expertVersion(valueOr(in.Version, "")),
		ModelProvider:  sp(modelProviderOf(in.Model, "internal")),
		ModelName:      sp(modelNameOf(in.Model, "deepseek-v3")),
		Permission:     valueOr(in.PermissionMode, "confirm_write"),
		PluginIDsJSON:  mustJSON(pluginIDs),
		SkillIDsJSON:   mustJSON(skillIDs),
		Visibility:     valueOr(in.Visibility, "all"),
		MarketMetaJSON: dumpStringMap(in.MarketMeta),
		Status:         status,
		Owner:          sp(actor.Name()),
		CreatedAt:      now,
		UpdatedAt:      now,
	}
	err := d.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&row).Error; err != nil {
			return err
		}
		if in.Grants != nil {
			return saveGrants(tx, row.ID, *in.Grants)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	_ = Audit(d, actor, "新增专家",
		map[string]string{"type": "expert", "id": row.ID, "name": row.Name},
		map[string]any{"status": status})
	view := toExpert(d, &row)
	return &view, nil
}

func UpdateExpert(d Deps, actor *Actor, id string, in ExpertInput) (*ExpertView, error) {
	var row model.Expert
	if err := d.DB.Where("id = ?", id).Take(&row).Error; err != nil {
		return nil, apperr.NotFound("专家不存在")
	}
	fromStatus := row.Status
	if in.Name != nil {
		row.Name = *in.Name
	}
	if in.RoleTitle != nil {
		row.RoleTitle = in.RoleTitle
	}
	if in.Emoji != nil {
		row.Emoji = in.Emoji
	}
	if in.Summary != nil {
		row.Summary = in.Summary
	}
	if in.RolePrompt != nil {
		row.RolePrompt = *in.RolePrompt
	}
	if in.Version != nil {
		row.Version = expertVersion(*in.Version)
	}
	if in.Model != nil {
		if in.Model.Provider != nil {
			row.ModelProvider = in.Model.Provider
		}
		if in.Model.Name != nil {
			row.ModelName = in.Model.Name
		}
	}
	if in.PermissionMode != nil {
		row.Permission = *in.PermissionMode
	}
	if in.PluginIDs != nil {
		row.PluginIDsJSON = mustJSON(existingIDs(d, "plugins", *in.PluginIDs))
	}
	if in.SkillIDs != nil {
		row.SkillIDsJSON = mustJSON(existingIDs(d, "skills", *in.SkillIDs))
	}
	if in.Visibility != nil {
		row.Visibility = *in.Visibility
	}
	if in.MarketMeta != nil {
		row.MarketMetaJSON = dumpStringMap(in.MarketMeta)
	}
	if in.Status != nil {
		row.Status = *in.Status
	}
	row.UpdatedAt = time.Now().UTC()

	err := d.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Save(&row).Error; err != nil {
			return err
		}
		if in.Grants != nil {
			return saveGrants(tx, row.ID, *in.Grants)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}

	action := "更新专家"
	if row.Status != fromStatus {
		if row.Status == "published" {
			action = "发布专家"
		} else {
			action = "下线专家"
		}
	}
	_ = Audit(d, actor, action,
		map[string]string{"type": "expert", "id": row.ID, "name": row.Name},
		map[string]any{"from": fromStatus, "to": row.Status})
	view := toExpert(d, &row)
	return &view, nil
}

func DeleteExpert(d Deps, actor *Actor, id string) error {
	var row model.Expert
	if err := d.DB.Where("id = ?", id).Take(&row).Error; err != nil {
		return apperr.NotFound("专家不存在")
	}
	err := d.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("expert_id = ?", row.ID).Delete(&model.Grant{}).Error; err != nil {
			return err
		}
		return tx.Where("id = ?", row.ID).Delete(&model.Expert{}).Error
	})
	if err != nil {
		return err
	}
	return Audit(d, actor, "删除专家",
		map[string]string{"type": "expert", "id": row.ID, "name": row.Name}, nil)
}

func DuplicateExpert(d Deps, actor *Actor, id string) (*ExpertView, error) {
	var row model.Expert
	if err := d.DB.Where("id = ?", id).Take(&row).Error; err != nil {
		return nil, apperr.NotFound("专家不存在")
	}
	now := time.Now().UTC()
	copyRow := model.Expert{
		ID:            ids.New("exp"),
		Key:           row.Key + "-copy-" + randomSuffix(4),
		Name:          row.Name + "（副本）",
		RoleTitle:     row.RoleTitle,
		Emoji:         row.Emoji,
		Summary:       row.Summary,
		RolePrompt:    row.RolePrompt,
		Version:       expertVersion(row.Version),
		ModelProvider: row.ModelProvider,
		ModelName:     row.ModelName,
		Permission:    row.Permission,
		PluginIDsJSON: row.PluginIDsJSON,
		SkillIDsJSON:  row.SkillIDsJSON,
		Visibility:    row.Visibility,
		Status:        "draft",
		Owner:         sp(actor.Name()),
		CreatedAt:     now,
		UpdatedAt:     now,
	}
	if err := d.DB.Create(&copyRow).Error; err != nil {
		return nil, err
	}
	_ = Audit(d, actor, "复制专家",
		map[string]string{"type": "expert", "id": copyRow.ID, "name": copyRow.Name},
		map[string]any{"from": row.ID})
	view := toExpert(d, &copyRow)
	return &view, nil
}

func derefStringSlice(v *[]string) []string {
	if v == nil {
		return nil
	}
	return *v
}
