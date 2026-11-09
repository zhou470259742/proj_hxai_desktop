package store

import (
	"testing"
	"time"

	"github.com/hx/control-plane/internal/model"
)

// 迁移的硬约束：Go 版算出的审计哈希必须与 Node 版逐字节一致，
// 否则历史库导入后 /api/audit/verify 会立刻判为断链。
func TestComputeAuditHashMatchesNodeImplementation(t *testing.T) {
	row := model.AuditLog{
		ActorID:    ptr("usr_1"),
		ActorName:  ptr("张三"),
		Action:     "登录",
		TargetType: ptr("session"),
		TargetID:   ptr("usr_1"),
		TargetName: ptr("管理控制台"),
		DetailJSON: `{"username":"zhangsan"}`,
		IP:         ptr("127.0.0.1"),
		CreatedAt:  time.Date(2026, 11, 5, 2, 3, 4, 500*int(time.Millisecond), time.UTC),
	}
	got := ComputeAuditHash("abc123", row)
	// 期望值由 Node 版 computeAuditHash 用同一行数据算出；两边必须逐字节一致。
	const want = "cb4f484e6debe33c558254f974a58e706193fc578d4394e888043b5d0029377d"
	if got != want {
		t.Fatalf("审计哈希与 Node 版不一致\n got=%s\nwant=%s", got, want)
	}
	// 同一输入的稳定性：排序与拼接规则一旦被改动，这里会立刻失败。
	if ComputeAuditHash("abc123", row) != got {
		t.Fatal("哈希计算不稳定")
	}
	// 空值必须按空串参与，而不是跳过字段。
	empty := ComputeAuditHash("", model.AuditLog{Action: "x", CreatedAt: row.CreatedAt})
	if empty == got {
		t.Fatal("空字段不应与有值字段算出同一哈希")
	}
	// 字段边界不能被内容拼接绕过（\u0000 分隔的意义）。
	a := ComputeAuditHash("", model.AuditLog{ActorName: ptr("a"), Action: "bc"})
	b := ComputeAuditHash("", model.AuditLog{ActorName: ptr("ab"), Action: "c"})
	if a == b {
		t.Fatal("字段分隔失效：不同字段组合算出了同一哈希")
	}
}

func TestComputeAuditHashUsesMillisecondUTC(t *testing.T) {
	base := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	withMillis := base.Add(500 * time.Millisecond)
	sameSecond := base.Add(500 * time.Millisecond).In(time.FixedZone("CST", 8*3600))

	a := ComputeAuditHash("", model.AuditLog{Action: "x", CreatedAt: withMillis})
	b := ComputeAuditHash("", model.AuditLog{Action: "x", CreatedAt: sameSecond})
	if a != b {
		t.Fatal("同一时刻的不同时区表示应算出同一哈希")
	}
	c := ComputeAuditHash("", model.AuditLog{Action: "x", CreatedAt: base})
	if a == c {
		t.Fatal("毫秒应参与哈希")
	}
}

func ptr(v string) *string { return &v }
