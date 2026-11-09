package store

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strings"
	"time"

	"github.com/hx/control-plane/internal/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// ComputeAuditHash 与 Node 版 computeAuditHash 逐字段对齐：字段顺序、\u0000 分隔、
// 以及"空值按空串参与"的规则都不能改，否则迁移后历史链会立刻判为断裂。
func ComputeAuditHash(prevHash string, row model.AuditLog) string {
	deref := func(v *string) string {
		if v == nil {
			return ""
		}
		return *v
	}
	fields := []string{
		prevHash,
		deref(row.ActorID),
		deref(row.ActorName),
		row.Action,
		deref(row.TargetType),
		deref(row.TargetID),
		deref(row.TargetName),
		row.DetailJSON,
		deref(row.IP),
		row.CreatedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
	}
	sum := sha256.Sum256([]byte(strings.Join(fields, "\u0000")))
	return hex.EncodeToString(sum[:])
}

type AuditRecord struct {
	ActorID    string
	ActorName  string
	Action     string
	TargetType string
	TargetID   string
	TargetName string
	Detail     any
	IP         string
}

// Append 在一个事务里锁链头行再写审计，保证多实例并发时链不分叉。
func Append(db *gorm.DB, rec AuditRecord) error {
	detail := "{}"
	if rec.Detail != nil {
		if body, err := json.Marshal(rec.Detail); err == nil {
			detail = string(body)
		}
	}
	return db.Transaction(func(tx *gorm.DB) error {
		var head model.AuditChainHead
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", 1).Take(&head).Error; err != nil {
			return err
		}
		row := model.AuditLog{
			ActorID:    nullable(rec.ActorID),
			ActorName:  nullable(rec.ActorName),
			Action:     rec.Action,
			TargetType: nullable(rec.TargetType),
			TargetID:   nullable(rec.TargetID),
			TargetName: nullable(rec.TargetName),
			DetailJSON: detail,
			IP:         nullable(rec.IP),
			// MySQL datetime(3) 会对第 4 位小数四舍五入，而哈希按字符串截断；
			// 写入前统一截到毫秒，保证"算哈希的时间"与"读回来的时间"逐字节一致。
			CreatedAt: Now().Truncate(time.Millisecond),
		}
		prev := head.Hash
		row.PrevHash = &prev
		hash := ComputeAuditHash(prev, row)
		row.Hash = &hash
		if err := tx.Create(&row).Error; err != nil {
			return err
		}
		return tx.Model(&model.AuditChainHead{}).Where("id = ?", 1).Update("hash", hash).Error
	})
}

type VerifyResult struct {
	OK       bool    `json:"ok"`
	Checked  int     `json:"checked"`
	BrokenAt *uint64 `json:"brokenAt"`
	Reason   *string `json:"reason"`
}

func VerifyChain(db *gorm.DB, limit int) (VerifyResult, error) {
	query := db.Order("id ASC")
	if limit > 0 {
		query = query.Limit(limit)
	}
	var rows []model.AuditLog
	if err := query.Find(&rows).Error; err != nil {
		return VerifyResult{}, err
	}
	prev := ""
	checked := 0
	for _, row := range rows {
		checked++
		if row.Hash == nil || *row.Hash == "" {
			return broken(checked, row.ID, "该行没有哈希（可能是哈希链启用前写入且未封链）"), nil
		}
		prevHash := ""
		if row.PrevHash != nil {
			prevHash = *row.PrevHash
		}
		if prevHash != prev {
			return broken(checked, row.ID, "prev_hash 与上一条记录的 hash 不一致（记录被删除或插入）"), nil
		}
		if ComputeAuditHash(prev, row) != *row.Hash {
			return broken(checked, row.ID, "字段内容与哈希不匹配（记录被修改）"), nil
		}
		prev = *row.Hash
	}
	return VerifyResult{OK: true, Checked: checked}, nil
}

func broken(checked int, id uint64, reason string) VerifyResult {
	return VerifyResult{OK: false, Checked: checked, BrokenAt: &id, Reason: &reason}
}

func nullable(v string) *string {
	if v == "" {
		return nil
	}
	return &v
}

// SealAuditChain 给迁移前没有哈希的历史行补链（幂等）。
// 补算无法证明历史未被改过，因此返回补链条数与时间，供运维标注取证起点。
func SealAuditChain(db *gorm.DB) (int, error) {
	var head model.AuditChainHead
	if err := db.Where("id = ?", 1).Take(&head).Error; err != nil {
		return 0, err
	}
	var pending []model.AuditLog
	if err := db.Where("hash IS NULL OR hash = ''").Order("id ASC").Find(&pending).Error; err != nil {
		return 0, err
	}
	if len(pending) == 0 {
		return 0, nil
	}
	prev := head.Hash
	if err := db.Transaction(func(tx *gorm.DB) error {
		for _, row := range pending {
			prevHash := prev
			row.PrevHash = &prevHash
			hash := ComputeAuditHash(prev, row)
			row.Hash = &hash
			if err := tx.Model(&model.AuditLog{}).Where("id = ?", row.ID).
				Updates(map[string]any{"prev_hash": prevHash, "hash": hash}).Error; err != nil {
				return err
			}
			prev = hash
		}
		return tx.Model(&model.AuditChainHead{}).Where("id = ?", 1).Update("hash", prev).Error
	}); err != nil {
		return 0, err
	}
	return len(pending), nil
}
