package store

import (

	"github.com/hx/control-plane/internal/model"
	"github.com/hx/control-plane/internal/platform/ids"
	"github.com/hx/control-plane/internal/platform/passwd"
	"gorm.io/gorm"
)

// SeedIfEmpty 只在全新库上写默认管理员；从 SQLite 迁移过来的库不动。
func SeedIfEmpty(db *gorm.DB, orgName string) (bool, error) {
	var count int64
	if err := db.Model(&model.User{}).Count(&count).Error; err != nil {
		return false, err
	}
	if count > 0 {
		return false, nil
	}
	hash, err := passwd.Hash("Admin@12345")
	if err != nil {
		return false, err
	}
	admin := model.User{
		ID:           ids.New("usr"),
		Username:     "admin",
		DisplayName:  "系统管理员",
		Email:        strPtr("admin@hx.local"),
		Department:   strPtr("平台管理"),
		Role:         "admin",
		Status:       "active",
		PasswordHash: hash,
		CreatedAt:    Now(),
	}
	err = db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&admin).Error; err != nil {
			return err
		}
		settings := NewSettings(tx)
		if err := settings.SeedDefaults(orgName); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return false, err
	}
	return true, nil
}

func strPtr(v string) *string { return &v }
