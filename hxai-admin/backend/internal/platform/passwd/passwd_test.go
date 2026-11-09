package passwd

import "testing"

// 与 Node 版 crypto.mjs 的兼容性是迁移前提：同一个 scrypt 串必须双向可验。
func TestVerifyNodeScryptHash(t *testing.T) {
	// 由 Node crypto.scryptSync("Admin@12345", salt, 64, {N:16384}) 生成
	stored := "scrypt$16384$00112233445566778899aabbccddeeff$c08cc22970f58c4f8802392664cf4a5ebb36ceb6a7e28e9bdaf0005142d1be317b5e8bbae23d060239127314a7adab30a4edb869ba0e7b6a622846a07ca0262a"
	if !Verify("Admin@12345", stored) {
		t.Fatal("Node 版生成的 scrypt 散列在 Go 侧校验失败")
	}
	if Verify("Wrong@12345", stored) {
		t.Fatal("错误口令不应通过 Node 版散列校验")
	}
	hash, err := Hash("Admin@12345")
	if err != nil {
		t.Fatalf("Hash 失败: %v", err)
	}
	if !Verify("Admin@12345", hash) {
		t.Fatal("新生成的散列无法通过校验")
	}
	if Verify("wrong-password", hash) {
		t.Fatal("错误口令不应通过校验")
	}
	if Verify("Admin@12345", "bcrypt$whatever") {
		t.Fatal("非 scrypt 格式应直接判失败")
	}
	if Verify("Admin@12345", "scrypt$bad$salt$hash") {
		t.Fatal("非法参数应判失败")
	}
}
