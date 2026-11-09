package store

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/hx/control-plane/internal/model"
	"gorm.io/gorm"
)

// 桌面端升级时换的是程序文件，数据库还是原来那个。这里模拟「旧版本建的库 + 用户数据」，
// 验证三件事：用户数据不丢、缺的表和列自动补齐、批量迁移可重入且失败不推进版本。
func TestSQLiteUpgradeKeepsDataAndBacksUp(t *testing.T) {
	path := filepath.Join(t.TempDir(), "control.db")
	db, err := OpenSQLite(path)
	if err != nil {
		t.Fatal(err)
	}
	// 旧版本：只有 users 与 audit_logs，且没有 schema_meta、没有后被追加的列。
	// DDL 必须写成 GORM 真实产出的形态（反引号、无制表符）：glebarez 的解析器把 \t 当引号，
	// 用缩进排版反而测不出真实升级路径。
	legacyDDL := []string{
		"CREATE TABLE `users` (`id` varchar(40),`username` varchar(80) NOT NULL,`display_name` varchar(120) NOT NULL,`email` varchar(190),`department` varchar(120),`role` varchar(20) NOT NULL DEFAULT \"member\",`status` varchar(20) NOT NULL DEFAULT \"active\",`password_hash` varchar(255) NOT NULL,`created_at` DATETIME NOT NULL,`last_login_at` DATETIME,PRIMARY KEY (`id`))",
		"CREATE TABLE `audit_logs` (`id` integer PRIMARY KEY AUTOINCREMENT,`action` varchar(80) NOT NULL,`actor` varchar(80),`target` varchar(120),`detail` text,`ip` varchar(64),`created_at` DATETIME NOT NULL,`prev_hash` varchar(64),`hash` varchar(64))",
	}
	for _, stmt := range legacyDDL {
		if err := db.Exec(stmt).Error; err != nil {
			t.Fatalf("建旧表失败: %v", err)
		}
	}
	createdAt := time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)
	if err := db.Exec(
		`INSERT INTO users (id, username, display_name, role, status, password_hash, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		"usr_legacy", "admin", "老管理员", "admin", "active", "hash", createdAt,
	).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(
		`INSERT INTO audit_logs (action, created_at) VALUES (?, ?)`, "legacy.action", createdAt,
	).Error; err != nil {
		t.Fatal(err)
	}

	report, err := Migrate(db, MigrateOptions{SQLitePath: path})
	if err != nil {
		t.Fatalf("升级旧库失败: %v", err)
	}
	if !report.ExistingDB {
		t.Fatal("应识别为已有数据的库")
	}
	if report.BackupPath == "" {
		t.Fatal("升级已有库前必须生成快照")
	}
	backupInfo, err := os.Stat(report.BackupPath)
	if err != nil || backupInfo.Size() == 0 {
		t.Fatalf("快照文件不可用: %v", err)
	}
	if mode := backupInfo.Mode().Perm(); mode != 0o600 {
		t.Fatalf("快照权限应为 0600，实际 %o", mode)
	}

	var user model.User
	if err := db.Where("id = ?", "usr_legacy").Take(&user).Error; err != nil {
		t.Fatalf("升级后用户数据丢失: %v", err)
	}
	if user.Username != "admin" || !user.CreatedAt.Equal(createdAt) {
		t.Fatalf("升级后用户数据被改动: %+v", user)
	}
	var auditCount int64
	if err := db.Model(&model.AuditLog{}).Count(&auditCount).Error; err != nil || auditCount != 1 {
		t.Fatalf("升级后审计数据异常: count=%d err=%v", auditCount, err)
	}
	for _, table := range []string{"plugins", "skills", "experts", "settings"} {
		if !db.Migrator().HasTable(table) {
			t.Fatalf("升级后缺少表 %s", table)
		}
	}
	if version, err := readSchemaVersion(db); err != nil || version != SchemaVersion {
		t.Fatalf("升级后版本应为 %d，实际 %d (err=%v)", SchemaVersion, version, err)
	}

	// 再次启动等同于「同一版本重装」：不得再生成快照，也不能报错。
	report, err = Migrate(db, MigrateOptions{SQLitePath: path})
	if err != nil {
		t.Fatalf("已升级库二次迁移失败: %v", err)
	}
	if report.BackupPath != "" {
		t.Fatalf("版本已是最新时不应重复备份，得到 %s", report.BackupPath)
	}
}

func TestSQLiteFreshInstallSkipsBackup(t *testing.T) {
	path := filepath.Join(t.TempDir(), "control.db")
	db, err := OpenSQLite(path)
	if err != nil {
		t.Fatal(err)
	}
	report, err := Migrate(db, MigrateOptions{SQLitePath: path})
	if err != nil {
		t.Fatal(err)
	}
	if report.ExistingDB || report.BackupPath != "" {
		t.Fatalf("全新库不应备份: %+v", report)
	}
	if report.ToVersion != SchemaVersion {
		t.Fatalf("全新库应直接写入当前版本，得到 %d", report.ToVersion)
	}
}

// 用户装回旧版本时，库结构版本可能比程序高。此时必须拒绝启动而不是按旧语义继续写。
func TestSQLiteRejectsNewerSchema(t *testing.T) {
	db, err := OpenSQLite(filepath.Join(t.TempDir(), "control.db"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := Migrate(db, MigrateOptions{}); err != nil {
		t.Fatal(err)
	}
	if err := writeSchemaVersion(db, SchemaVersion+1); err != nil {
		t.Fatal(err)
	}
	if _, err := Migrate(db, MigrateOptions{}); err == nil {
		t.Fatal("库版本高于程序时应拒绝启动")
	}
}

func TestDataMigrationsAreOrderedAndTransactional(t *testing.T) {
	db, err := OpenSQLite(filepath.Join(t.TempDir(), "control.db"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := Migrate(db, MigrateOptions{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("CREATE TABLE upgrade_probe (id integer PRIMARY KEY, note text)").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("INSERT INTO upgrade_probe (id, note) VALUES (1, 'old')").Error; err != nil {
		t.Fatal(err)
	}

	var order []int
	migrations := []dataMigration{
		{version: 2, name: "backfill", run: func(tx *gorm.DB) error {
			order = append(order, 2)
			return tx.Exec("UPDATE upgrade_probe SET note = 'new' WHERE id = 1").Error
		}},
		{version: 3, name: "boom", run: func(tx *gorm.DB) error {
			order = append(order, 3)
			return tx.Exec("UPDATE upgrade_probe SET note = 'x' WHERE id = 1").Error
		}},
	}
	reached, err := applyDataMigrations(db, SchemaVersion, migrations)
	if err != nil {
		t.Fatalf("迁移应成功: %v", err)
	}
	if reached != 3 || len(order) != 2 || order[0] != 2 || order[1] != 3 {
		t.Fatalf("迁移未按版本顺序执行: reached=%d order=%v", reached, order)
	}
	var note string
	if err := db.Raw("SELECT note FROM upgrade_probe WHERE id = 1").Scan(&note).Error; err != nil || note != "x" {
		t.Fatalf("迁移数据未落库: %q err=%v", note, err)
	}

	// 失败步骤：写入必须回滚，版本停在最后一个成功步骤。
	migrations = []dataMigration{
		{version: 4, name: "partial", run: func(tx *gorm.DB) error {
			if err := tx.Exec("UPDATE upgrade_probe SET note = 'half' WHERE id = 1").Error; err != nil {
				return err
			}
			return os.ErrInvalid
		}},
	}
	reached, err = applyDataMigrations(db, 3, migrations)
	if err == nil {
		t.Fatal("迁移失败应返回错误")
	}
	if reached != 3 {
		t.Fatalf("失败步骤不应推进版本，实际 %d", reached)
	}
	if err := db.Raw("SELECT note FROM upgrade_probe WHERE id = 1").Scan(&note).Error; err != nil || note != "x" {
		t.Fatalf("失败步骤的数据写入应回滚: %q err=%v", note, err)
	}
}
