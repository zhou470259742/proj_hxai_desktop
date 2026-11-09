package store

import (
	"fmt"
	"time"

	"github.com/hx/control-plane/internal/model"
	"gorm.io/driver/mysql"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func OpenMySQL(dsn string) (*gorm.DB, error) {
	db, err := gorm.Open(mysql.Open(dsn), &gorm.Config{
		Logger:  logger.Default.LogMode(logger.Warn),
		NowFunc: func() time.Time { return time.Now().UTC() },
	})
	if err != nil {
		return nil, fmt.Errorf("连接 MySQL 失败: %w", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		return nil, err
	}
	sqlDB.SetMaxOpenConns(40)
	sqlDB.SetMaxIdleConns(10)
	sqlDB.SetConnMaxLifetime(30 * time.Minute)
	if err := sqlDB.Ping(); err != nil {
		return nil, fmt.Errorf("MySQL 不可用: %w", err)
	}
	return db, nil
}

// EnsureAuditHead 保证链头存在；迁移已有库时用最后一条审计的 hash 续链。
func EnsureAuditHead(db *gorm.DB) error {
	var head model.AuditChainHead
	err := db.Where("id = ?", 1).Take(&head).Error
	if err == nil {
		return nil
	}
	if err != gorm.ErrRecordNotFound {
		return err
	}
	hash := ""
	var last model.AuditLog
	if err := db.Order("id DESC").Take(&last).Error; err == nil && last.Hash != nil {
		hash = *last.Hash
	} else if err != nil && err != gorm.ErrRecordNotFound {
		return err
	}
	return db.Create(&model.AuditChainHead{ID: 1, Hash: hash}).Error
}
