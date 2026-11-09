// Package passwd 与 Node 版 crypto.mjs 保持同一种散列格式：scrypt$N$salt$hash。
// 迁移期 Node 与 Go 共用用户表，格式必须双向兼容，回退时才不会把所有人挡在门外。
package passwd

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"fmt"
	"strconv"
	"strings"

	"golang.org/x/crypto/scrypt"
)

const (
	defaultN = 16384
	keyLen   = 64
)

func Hash(password string) (string, error) {
	var salt [16]byte
	if _, err := rand.Read(salt[:]); err != nil {
		return "", err
	}
	saltHex := hex.EncodeToString(salt[:])
	sum, err := scrypt.Key([]byte(password), []byte(saltHex), defaultN, 8, 1, keyLen)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("scrypt$%d$%s$%s", defaultN, saltHex, hex.EncodeToString(sum)), nil
}

func Verify(password, stored string) bool {
	parts := strings.Split(stored, "$")
	if len(parts) != 4 || parts[0] != "scrypt" {
		return false
	}
	n, err := strconv.Atoi(parts[1])
	if err != nil || n <= 1 {
		return false
	}
	expected, err := hex.DecodeString(parts[3])
	if err != nil {
		return false
	}
	sum, err := scrypt.Key([]byte(password), []byte(parts[2]), n, 8, 1, len(expected))
	if err != nil {
		return false
	}
	return subtle.ConstantTimeCompare(sum, expected) == 1
}
