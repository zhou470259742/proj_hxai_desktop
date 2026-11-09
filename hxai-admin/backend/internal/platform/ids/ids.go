// Package ids 生成与 Node 版同构的业务 ID：<prefix>_<12 位小写 hex>。
package ids

import (
	"crypto/rand"
	"encoding/hex"
)

func New(prefix string) string {
	var b [6]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic("crypto/rand 不可用: " + err.Error())
	}
	return prefix + "_" + hex.EncodeToString(b[:])
}

// Token 生成 URL-safe 随机串，等价于 Node 的 randomBytes(n).toString("base64url")。
func Token(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic("crypto/rand 不可用: " + err.Error())
	}
	return encodeBase64URL(b)
}

func encodeBase64URL(b []byte) string {
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
	out := make([]byte, 0, (len(b)*4+2)/3)
	for i := 0; i < len(b); i += 3 {
		var chunk [3]byte
		n := copy(chunk[:], b[i:])
		out = append(out, alphabet[chunk[0]>>2])
		out = append(out, alphabet[((chunk[0]&0x03)<<4)|(chunk[1]>>4)])
		if n > 1 {
			out = append(out, alphabet[((chunk[1]&0x0f)<<2)|(chunk[2]>>6)])
		}
		if n > 2 {
			out = append(out, alphabet[chunk[2]&0x3f])
		}
	}
	return string(out)
}
