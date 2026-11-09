package service

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"regexp"
	"strings"
	"time"
)

// 与 legacy-node/src/zip.mjs 保持同一套校验：上传时就要拦下缺 manifest 的包，
// 否则 ZCode 客户端安装时才报 plugin_manifest_not_found。

var pluginManifestCandidates = []string{
	".zcode-plugin/plugin.json",
	".claude-plugin/plugin.json",
	".codex-plugin/plugin.json",
}

var PluginNamePattern = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{0,127}$`)

var skillEntryPattern = regexp.MustCompile(`(^|/)SKILL\.md$`)

type zipEntry struct {
	Name             string
	CompressedSize   uint64
	UncompressedSize uint64
}

func listZipEntries(data []byte) ([]zipEntry, error) {
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, fmt.Errorf("不是合法的 ZIP 文件：%s", err)
	}
	entries := make([]zipEntry, 0, len(reader.File))
	for _, file := range reader.File {
		entries = append(entries, zipEntry{
			Name:             file.Name,
			CompressedSize:   file.CompressedSize64,
			UncompressedSize: file.UncompressedSize64,
		})
	}
	return entries, nil
}

func readZipFile(file *zip.File) ([]byte, error) {
	rc, err := file.Open()
	if err != nil {
		return nil, err
	}
	defer rc.Close()
	return io.ReadAll(rc)
}

func findPluginManifest(data []byte) ([]byte, string, error) {
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, "", fmt.Errorf("不是合法的 ZIP 文件：%s", err)
	}
	files := make([]*zip.File, 0, len(reader.File))
	for _, file := range reader.File {
		if !strings.HasSuffix(file.Name, "/") {
			files = append(files, file)
		}
	}
	if len(files) == 0 {
		return nil, "", errors.New("ZIP 是空的")
	}

	topLevel := map[string]struct{}{}
	for _, file := range files {
		topLevel[strings.SplitN(file.Name, "/", 2)[0]] = struct{}{}
	}
	prefixes := []string{""}
	if len(topLevel) == 1 {
		for only := range topLevel {
			isManifestDir := false
			for _, candidate := range pluginManifestCandidates {
				if strings.HasPrefix(candidate, only+"/") {
					isManifestDir = true
					break
				}
			}
			if !isManifestDir {
				prefixes = append(prefixes, only+"/")
			}
		}
	}

	for _, prefix := range prefixes {
		for _, candidate := range pluginManifestCandidates {
			target := prefix + candidate
			for _, file := range files {
				if file.Name != target {
					continue
				}
				content, err := readZipFile(file)
				if err != nil {
					return nil, "", fmt.Errorf("读取插件清单失败：%s", err)
				}
				return content, file.Name, nil
			}
		}
	}

	names := make([]string, 0, 5)
	for i, file := range files {
		if i >= 5 {
			break
		}
		names = append(names, file.Name)
	}
	sample := strings.Join(names, ", ")
	if len(files) > 5 {
		sample += fmt.Sprintf(" …共 %d 个", len(files))
	}
	return nil, "", fmt.Errorf(
		"包内缺少插件清单：需要 %s（也接受 .claude-plugin/plugin.json / .codex-plugin/plugin.json）。当前包内文件：%s",
		pluginManifestCandidates[0], sample,
	)
}

func countSkillEntries(data []byte) int {
	entries, err := listZipEntries(data)
	if err != nil {
		return 0
	}
	count := 0
	for _, entry := range entries {
		if !strings.HasSuffix(entry.Name, "/") && skillEntryPattern.MatchString(entry.Name) {
			count++
		}
	}
	return count
}

type zipInput struct {
	Name string
	Data []byte
}

func createZip(files []zipInput) ([]byte, error) {
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	seenDirs := map[string]struct{}{}
	stamp := time.Date(1980, 1, 1, 0, 0, 0, 0, time.UTC)

	writeDir := func(name string) error {
		header := &zip.FileHeader{Name: name, Method: zip.Store, Modified: stamp}
		header.SetMode(0o755 | os.ModeDir)
		_, err := writer.CreateHeader(header)
		return err
	}

	for _, file := range files {
		parts := strings.Split(file.Name, "/")
		for i := 1; i < len(parts); i++ {
			dir := strings.Join(parts[:i], "/") + "/"
			if _, ok := seenDirs[dir]; ok {
				continue
			}
			seenDirs[dir] = struct{}{}
			if err := writeDir(dir); err != nil {
				return nil, err
			}
		}
		header := &zip.FileHeader{Name: file.Name, Method: zip.Deflate, Modified: stamp}
		header.SetMode(0o644)
		entry, err := writer.CreateHeader(header)
		if err != nil {
			return nil, err
		}
		if _, err := entry.Write(file.Data); err != nil {
			return nil, err
		}
	}
	if err := writer.Close(); err != nil {
		return nil, err
	}
	return buffer.Bytes(), nil
}

func sha256Hex(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func safeFileName(value string) string {
	cleaned := regexp.MustCompile(`[^0-9A-Za-z._-]`).ReplaceAllString(value, "_")
	if len(cleaned) > 40 {
		cleaned = cleaned[:40]
	}
	if cleaned == "" {
		cleaned = "1.0.0"
	}
	return cleaned
}
