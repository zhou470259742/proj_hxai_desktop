package service

import (
	"strconv"
	"strings"
	"time"

	"github.com/hx/control-plane/internal/model"
	"github.com/hx/control-plane/internal/platform/apperr"
	"github.com/hx/control-plane/internal/platform/ids"
)

/* ------------------------------- 技能 ------------------------------- */

type SkillView struct {
	ID         string  `json:"id"`
	Key        string  `json:"key"`
	Name       string  `json:"name"`
	Summary    *string `json:"summary"`
	Category   *string `json:"category"`
	Version    string  `json:"version"`
	Trigger    *string `json:"trigger"`
	Content    string  `json:"content"`
	Status     string  `json:"status"`
	Author     *string `json:"author"`
	Installs   int     `json:"installs"`
	HasPackage bool    `json:"hasPackage"`
	CreatedAt  string  `json:"createdAt"`
	UpdatedAt  string  `json:"updatedAt"`
}

func toSkill(row *model.Skill) SkillView {
	hasPkg := row.PackageFile != nil && *row.PackageFile != ""
	return SkillView{
		ID:         row.ID,
		Key:        row.Key,
		Name:       row.Name,
		Summary:    row.Summary,
		Category:   row.Category,
		Version:    row.Version,
		Trigger:    row.TriggerDesc,
		Content:    row.Content,
		Status:     row.Status,
		Author:     row.Author,
		Installs:   row.Installs,
		HasPackage: hasPkg,
		CreatedAt:  isoFormat(row.CreatedAt),
		UpdatedAt:  isoFormat(row.UpdatedAt),
	}
}

func ListSkills(d Deps) ([]SkillView, error) {
	var rows []model.Skill
	if err := d.DB.Order("installs DESC, created_at DESC").Find(&rows).Error; err != nil {
		return nil, err
	}
	items := make([]SkillView, 0, len(rows))
	for i := range rows {
		items = append(items, toSkill(&rows[i]))
	}
	return items, nil
}

func GetSkill(d Deps, id string) (*SkillView, error) {
	var row model.Skill
	if err := d.DB.Where("id = ?", id).Take(&row).Error; err != nil {
		return nil, apperr.NotFound("技能不存在")
	}
	view := toSkill(&row)
	return &view, nil
}

type SkillInput struct {
	Name     *string `json:"name"`
	Key      *string `json:"key"`
	Summary  *string `json:"summary"`
	Category *string `json:"category"`
	Version  *string `json:"version"`
	Trigger  *string `json:"trigger"`
	Content  *string `json:"content"`
	Status   *string `json:"status"`
}

func CreateSkill(d Deps, actor *Actor, in SkillInput) (*SkillView, error) {
	missing := []string{}
	if in.Name == nil || strings.TrimSpace(*in.Name) == "" {
		missing = append(missing, "name")
	}
	if in.Content == nil || strings.TrimSpace(*in.Content) == "" {
		missing = append(missing, "content")
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
		key = "skill-" + strconv.FormatInt(time.Now().UnixMilli(), 10)
	}
	if err := ensureUnique(d.DB, "skills", key, ""); err != nil {
		return nil, err
	}

	now := time.Now().UTC()
	row := model.Skill{
		ID:          ids.New("skl"),
		Key:         key,
		Name:        *in.Name,
		Summary:     sp(valueOr(in.Summary, "")),
		Category:    sp(valueOr(in.Category, "通用")),
		Version:     valueOr(in.Version, "1.0.0"),
		TriggerDesc: sp(valueOr(in.Trigger, "")),
		Content:     *in.Content,
		Status:      valueOr(in.Status, "draft"),
		Author:      sp(actor.Name()),
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if err := d.DB.Create(&row).Error; err != nil {
		return nil, err
	}
	_ = Audit(d, actor, "新增技能",
		map[string]string{"type": "skill", "id": row.ID, "name": row.Name},
		map[string]any{"version": row.Version})
	view := toSkill(&row)
	return &view, nil
}

func UpdateSkill(d Deps, actor *Actor, id string, in SkillInput) (*SkillView, error) {
	var row model.Skill
	if err := d.DB.Where("id = ?", id).Take(&row).Error; err != nil {
		return nil, apperr.NotFound("技能不存在")
	}
	fromStatus := row.Status
	if in.Name != nil {
		row.Name = *in.Name
	}
	if in.Summary != nil {
		row.Summary = in.Summary
	}
	if in.Category != nil {
		row.Category = in.Category
	}
	if in.Version != nil {
		row.Version = *in.Version
	}
	if in.Trigger != nil {
		row.TriggerDesc = in.Trigger
	}
	if in.Content != nil {
		row.Content = *in.Content
	}
	if in.Status != nil {
		row.Status = *in.Status
	}
	row.UpdatedAt = time.Now().UTC()
	if err := d.DB.Save(&row).Error; err != nil {
		return nil, err
	}

	action := "更新技能"
	if in.Status != nil && *in.Status != "" && *in.Status != fromStatus {
		if *in.Status == "published" {
			action = "发布技能"
		} else {
			action = "下线技能"
		}
	}
	_ = Audit(d, actor, action,
		map[string]string{"type": "skill", "id": row.ID, "name": row.Name},
		map[string]any{"version": row.Version})
	view := toSkill(&row)
	return &view, nil
}

func DeleteSkill(d Deps, actor *Actor, id string) error {
	var row model.Skill
	if err := d.DB.Where("id = ?", id).Take(&row).Error; err != nil {
		return apperr.NotFound("技能不存在")
	}
	if err := d.DB.Where("id = ?", row.ID).Delete(&model.Skill{}).Error; err != nil {
		return err
	}
	return Audit(d, actor, "删除技能",
		map[string]string{"type": "skill", "id": row.ID, "name": row.Name}, nil)
}
