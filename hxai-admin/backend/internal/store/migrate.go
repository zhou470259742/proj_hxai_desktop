package store

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/hx/control-plane/internal/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// SchemaVersion 是当前代码期望的库结构版本。
//
// 只加表、只加列这类变更不用动它：AutoMigrate 本身就是追加式且幂等。
// 一旦出现 AutoMigrate 覆盖不了的变更（改列语义、拆表、批量回填），
// 必须先在 dataMigrations 里补一条对应版本的可重入迁移，再把这里 +1。
const SchemaVersion = 2

// schemaMeta 记录库结构版本，单行表。
type schemaMeta struct {
	ID        uint      `gorm:"column:id;primaryKey"`
	Version   int       `gorm:"column:version;not null"`
	UpdatedAt time.Time `gorm:"column:updated_at;type:datetime(3);not null"`
}

func (schemaMeta) TableName() string { return "schema_meta" }

// dataMigration 是 AutoMigrate 之后的显式数据变更，按 version 升序执行；
// run 必须自己判断是否已执行过，保证中途失败重跑不会重复写数据。
type dataMigration struct {
	version int
	name    string
	run     func(tx *gorm.DB) error
}

var dataMigrations []dataMigration = []dataMigration{
	{version: 2, run: func(db *gorm.DB) error {
		// 用户类型语义改名：console→admin（控制台账号）、publisher→user
		// （普通用户=harness 侧身份）。
		if err := db.Exec("UPDATE users SET kind='admin' WHERE kind='console'").Error; err != nil {
			return err
		}
		return db.Exec("UPDATE users SET kind='user' WHERE kind='publisher'").Error
	}},
}

var allModels = []any{
	&model.User{},
	&model.Session{},
	&model.Plugin{},
	&model.Skill{},
	&model.Expert{},
	&model.Grant{},
	&model.AuditLog{},
	&model.AuditChainHead{},
	&model.Handoff{},
	&model.Setting{},
	&model.ClientToken{},
	&model.OAuthClient{},
	&model.Instance{},
	&model.Role{},
}

// MigrateOptions.SQLitePath 非空时，升级已有库前会先做一致性快照。
// MySQL 部署由运维负责备份（改动前文档已注明），这里不尝试 mysqldump。
type MigrateOptions struct {
	SQLitePath string
}

type MigrationReport struct {
	FromVersion int
	ToVersion   int
	// BackupPath 为空表示没有做快照（新库、已是最新版本或非 SQLite）。
	BackupPath string
	// ExistingDB 表示本次启动前库里已经有用户数据。
	ExistingDB bool
}

// Migrate 是桌面内置模式每次启动都会走的升级入口：
// 老库先用 VACUUM INTO 做快照，再追加式建表/加列，最后执行显式数据迁移并记录版本。
// 任何一步失败都返回错误、不推进版本号，下次启动会重新尝试（快照会再生成一份）。
func Migrate(db *gorm.DB, opts MigrateOptions) (MigrationReport, error) {
	report := MigrationReport{ToVersion: SchemaVersion}
	if err := db.AutoMigrate(&schemaMeta{}); err != nil {
		return report, fmt.Errorf("初始化 schema_meta 失败: %w", err)
	}
	current, err := readSchemaVersion(db)
	if err != nil {
		return report, err
	}
	report.FromVersion = current
	// 用户装回旧版本时库结构比程序新：继续跑会按旧语义写新库，直接拒绝启动更安全。
	if current > SchemaVersion {
		return report, fmt.Errorf(
			"数据库结构版本 %d 高于当前程序支持的 %d，请升级到新版程序后再启动",
			current, SchemaVersion,
		)
	}
	report.ExistingDB = db.Migrator().HasTable(&model.User{})

	if report.ExistingDB && current < SchemaVersion && opts.SQLitePath != "" {
		backupPath, err := backupSQLite(db, opts.SQLitePath)
		if err != nil {
			// 没有可用快照就不动结构：升级失败时数据原样保留，用户可退回上一版程序。
			return report, fmt.Errorf("升级前快照失败，已中止迁移: %w", err)
		}
		report.BackupPath = backupPath
	}

	if err := db.AutoMigrate(allModels...); err != nil {
		return report, fmt.Errorf("建表失败: %w", err)
	}

	reached, err := applyDataMigrations(db, current, dataMigrations)
	if err != nil {
		report.ToVersion = reached
		return report, err
	}
	if reached < SchemaVersion {
		if err := writeSchemaVersion(db, SchemaVersion); err != nil {
			return report, fmt.Errorf("写入库结构版本失败: %w", err)
		}
		reached = SchemaVersion
	}
	report.ToVersion = reached
	return report, nil
}

func readSchemaVersion(db *gorm.DB) (int, error) {
	var version int
	if err := db.Raw("SELECT version FROM schema_meta WHERE id = 1").Scan(&version).Error; err != nil {
		return 0, fmt.Errorf("读取库结构版本失败: %w", err)
	}
	return version, nil
}

func writeSchemaVersion(db *gorm.DB, version int) error {
	row := schemaMeta{ID: 1, Version: version, UpdatedAt: Now()}
	return db.Clauses(clause.OnConflict{UpdateAll: true}).Create(&row).Error
}

// applyDataMigrations 逐条提交：每条迁移与版本号在同一事务里，避免「数据改了但版本没记」。
func applyDataMigrations(db *gorm.DB, from int, migrations []dataMigration) (int, error) {
	reached := from
	pending := make([]dataMigration, 0, len(migrations))
	for _, m := range migrations {
		if m.version > from {
			pending = append(pending, m)
		}
	}
	sort.SliceStable(pending, func(i, j int) bool { return pending[i].version < pending[j].version })

	for _, m := range pending {
		err := db.Transaction(func(tx *gorm.DB) error {
			if err := m.run(tx); err != nil {
				return err
			}
			return writeSchemaVersion(tx, m.version)
		})
		if err != nil {
			return reached, fmt.Errorf("数据库升级步骤 %d(%s) 失败: %w", m.version, m.name, err)
		}
		reached = m.version
	}
	return reached, nil
}

// backupSQLite 用 VACUUM INTO 生成一致性快照：固定同一时间点的完整库，
// 不会像直接拷贝文件那样在 WAL 有未落盘内容时拿到半截数据。
func backupSQLite(db *gorm.DB, dbPath string) (string, error) {
	if _, err := os.Stat(dbPath); err != nil {
		if os.IsNotExist(err) {
			return "", nil
		}
		return "", err
	}
	dir := filepath.Dir(dbPath)
	base := filepath.Base(dbPath)
	stamp := time.Now().UTC().Format("20060102T150405Z")
	target := filepath.Join(dir, fmt.Sprintf("%s.pre-upgrade-%s-%d.bak", base, stamp, os.Getpid()))
	// VACUUM INTO 的路径是 SQL 文本，不能参数化，只能自己转义单引号。
	escaped := strings.ReplaceAll(target, "'", "''")
	if err := db.Exec("VACUUM INTO '" + escaped + "'").Error; err != nil {
		return "", fmt.Errorf("VACUUM INTO 失败: %w", err)
	}
	info, err := os.Stat(target)
	if err != nil {
		return "", err
	}
	if info.Size() == 0 {
		return "", fmt.Errorf("快照文件为空: %s", target)
	}
	if err := os.Chmod(target, 0o600); err != nil {
		return "", err
	}
	pruneSQLiteBackups(dir, base, 3)
	return target, nil
}

// pruneSQLiteBackups 只保留最近几份快照，避免每次启动失败重试把数据目录撑爆。
func pruneSQLiteBackups(dir, base string, keep int) {
	matches, err := filepath.Glob(filepath.Join(dir, base+".pre-upgrade-*.bak"))
	if err != nil || len(matches) <= keep {
		return
	}
	sort.Sort(sort.Reverse(sort.StringSlice(matches)))
	for _, old := range matches[keep:] {
		_ = os.Remove(old)
	}
}
