package store

import (
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"gorm.io/gorm/migrator"
	"gorm.io/gorm/schema"
)

// OpenSQLite 打开桌面内置模式使用的纯 Go SQLite（modernc，无 CGO）。
// busy_timeout + WAL 让桌面端后台进程与人工排查工具可以同时读；
// MaxOpenConns(1) 让所有写串行，弥补 SQLite 没有行锁、FOR UPDATE 会被忽略的问题。
func OpenSQLite(path string) (*gorm.DB, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, fmt.Errorf("创建 SQLite 目录失败: %w", err)
	}
	dsn := path + "?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)"
	db, err := gorm.Open(sqliteDialector{sqlite.Dialector{DSN: dsn}}, &gorm.Config{
		Logger:  logger.Default.LogMode(logger.Warn),
		NowFunc: func() time.Time { return time.Now().UTC() },
	})
	if err != nil {
		return nil, fmt.Errorf("打开 SQLite 失败: %w", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		return nil, err
	}
	sqlDB.SetMaxOpenConns(1)
	sqlDB.SetMaxIdleConns(1)
	if err := sqlDB.Ping(); err != nil {
		return nil, fmt.Errorf("SQLite 不可用: %w", err)
	}
	// 库里有会话令牌与审计数据，只给当前用户读写；WAL/SHM 由同目录 0700 兜底。
	if err := os.Chmod(path, 0o600); err != nil {
		return nil, fmt.Errorf("收紧 SQLite 文件权限失败: %w", err)
	}
	return db, nil
}

// sqliteDialector 只替换建表类型推导，其余行为完全沿用 glebarez 驱动。
type sqliteDialector struct {
	sqlite.Dialector
}

// Migrator 必须保留 glebarez 自己的 Migrator：它用 sqlite_master 实现 HasTable/HasColumn/
// AlterColumn 等 SQLite 专属逻辑，换成裸 migrator 会让 AutoMigrate 在已有库上重复建表。
// 只把内层 Config.Dialector 换成 d，让 DataTypeOf 覆写对建表仍然生效。
func (d sqliteDialector) Migrator(db *gorm.DB) gorm.Migrator {
	return sqlite.Migrator{Migrator: migrator.Migrator{Config: migrator.Config{
		DB:                          db,
		Dialector:                   d,
		CreateIndexAfterCreateTable: true,
	}}}
}

// DataTypeOf 必须挂在 dialector 上：GORM 的建表逻辑在 migrator 内部转调
// Dialector.DataTypeOf，只包 Migrator 会被绕过。这里修两处模型标签与 SQLite 的不兼容：
//  1. 模型为 MySQL 显式写了 type:datetime(3)，而 glebarez 驱动只有在列声明类型恰好是
//     DATETIME 时才会把文本转成 time.Time，带括号会退化成 string，读取直接报 Scan 错；
//  2. type:bigint unsigned 覆盖了自增推导，建表只得到普通主键，审计日志插入后拿不到 id。
//     SQLite 的自增必须写成 INTEGER PRIMARY KEY AUTOINCREMENT。
func (d sqliteDialector) DataTypeOf(field *schema.Field) string {
	if field.GORMDataType == schema.Time || field.DataType == schema.Time {
		return "DATETIME"
	}
	if field.AutoIncrement &&
		(field.GORMDataType == schema.Int || field.GORMDataType == schema.Uint ||
			field.DataType == schema.Int || field.DataType == schema.Uint) {
		return "integer PRIMARY KEY AUTOINCREMENT"
	}
	// 其余 varchar/text/bigint 等声明类型 SQLite 都能接受，保持与 MySQL 版一致的可读性。
	return d.Dialector.DataTypeOf(field)
}
