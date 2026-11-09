package store

import (
	"errors"
	"time"

	"github.com/hx/control-plane/internal/model"
	"gorm.io/gorm"
)

type Settings struct {
	db *gorm.DB
}

func NewSettings(db *gorm.DB) *Settings { return &Settings{db: db} }

func (s *Settings) Get(key, fallback string) string {
	var row model.Setting
	err := s.db.Where("`key` = ?", key).Take(&row).Error
	if err != nil || row.Value == nil {
		return fallback
	}
	return *row.Value
}

func (s *Settings) Set(key, value string) error {
	row := model.Setting{Key: key, Value: &value}
	return s.db.Where("`key` = ?", key).Assign(model.Setting{Value: &value}).FirstOrCreate(&row).Error
}

// GetOrCreate 对应 Node 的 gatewayToken()：首次访问时生成并落库。
func (s *Settings) GetOrCreate(key, fallback string, generate func() string) (string, error) {
	value := s.Get(key, "")
	if value != "" {
		return value, nil
	}
	value = fallback
	if value == "" {
		value = generate()
	}
	if err := s.Set(key, value); err != nil {
		return "", err
	}
	return value, nil
}

func (s *Settings) SeedDefaults(orgName string) error {
	defaults := map[string]string{
		"org_name":           orgName,
		"manifest_channel":   "stable",
		"require_update":     "false",
		"min_client_version": "0.1.0",
		"allow_self_install": "false",
		"brand_app_name":     "HX AI 工作台",
	}
	for key, value := range defaults {
		var existing model.Setting
		err := s.db.Where("`key` = ?", key).Take(&existing).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			if err := s.Set(key, value); err != nil {
				return err
			}
		} else if err != nil {
			return err
		}
	}
	return nil
}

func Now() time.Time { return time.Now().UTC() }
