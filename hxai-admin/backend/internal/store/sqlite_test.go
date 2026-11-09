package store

import (
	"strings"
	"testing"
	"time"

	"github.com/hx/control-plane/internal/model"
)

// SQLite 是桌面内置模式的默认库，类型推导一旦退化（时间列变 string、主键丢了自增），
// 表现是运行期才报 Scan 错 / 审计 id 为 0，所以这里把两处 DDL 约束钉死。
func TestSQLiteSchemaAndRoundTrip(t *testing.T) {
	db, err := OpenSQLite(t.TempDir() + "/control.db")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := Migrate(db, MigrateOptions{}); err != nil {
		t.Fatal(err)
	}

	var ddl string
	if err := db.Raw("SELECT sql FROM sqlite_master WHERE name='audit_logs'").Scan(&ddl).Error; err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(strings.ToLower(ddl), "integer primary key autoincrement") {
		t.Fatalf("audit_logs.id 缺少自增主键: %s", ddl)
	}
	if strings.Contains(strings.ToLower(ddl), "datetime(") {
		t.Fatalf("时间列不应带精度参数，否则驱动无法扫描为 time.Time: %s", ddl)
	}

	now := time.Date(2026, 11, 6, 8, 30, 0, 123000000, time.UTC)
	user := model.User{
		ID:           "usr_roundtrip",
		Username:     "admin",
		DisplayName:  "管理员",
		Role:         "admin",
		Status:       "active",
		PasswordHash: "x",
		CreatedAt:    now,
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	var got model.User
	if err := db.Where("id = ?", user.ID).Take(&got).Error; err != nil {
		t.Fatal(err)
	}
	if !got.CreatedAt.Equal(now) {
		t.Fatalf("created_at 往返不一致: %v != %v", got.CreatedAt, now)
	}
	if got.LastLoginAt != nil {
		t.Fatalf("last_login_at 应为 NULL, 得到 %v", got.LastLoginAt)
	}

	for i := 1; i <= 2; i++ {
		row := model.AuditLog{Action: "smoke"}
		if err := db.Create(&row).Error; err != nil {
			t.Fatal(err)
		}
		if row.ID != uint64(i) {
			t.Fatalf("审计 id 应自增为 %d，得到 %d", i, row.ID)
		}
	}

	// 排序取最近更新时间依赖时间列可比较，这里顺带覆盖市场下发的取时间戳写法。
	var latest time.Time
	if err := db.Raw("SELECT created_at FROM users ORDER BY created_at DESC LIMIT 1").Scan(&latest).Error; err != nil {
		t.Fatal(err)
	}
	if !latest.Equal(now) {
		t.Fatalf("排序取值失败: %v", latest)
	}
}

// 桌面端每次启动都会跑一遍 AutoMigrate，已有库必须幂等；
// 曾经把驱动 Migrator 换成裸 migrator，HasTable 失效导致二次启动重复建表直接失败。
func TestSQLiteMigrateIsIdempotent(t *testing.T) {
	path := t.TempDir() + "/control.db"
	db, err := OpenSQLite(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := Migrate(db, MigrateOptions{}); err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	_ = sqlDB.Close()

	reopened, err := OpenSQLite(path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if sqlDB, err := reopened.DB(); err == nil {
			_ = sqlDB.Close()
		}
	}()
	if _, err := Migrate(reopened, MigrateOptions{}); err != nil {
		t.Fatalf("已存在的库二次迁移失败: %v", err)
	}
	if !reopened.Migrator().HasTable(&model.User{}) {
		t.Fatal("二次迁移后 users 表不存在")
	}
}
