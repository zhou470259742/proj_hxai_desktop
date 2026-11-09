/**
 * 极简 ZIP 读取器（仅用 node 内置能力）
 *
 * 后台不引第三方依赖，但上传插件包时必须校验包内 manifest：
 * ZCode 客户端安装时要求包内存在 .zcode-plugin/plugin.json（或 .claude-plugin /
 * .codex-plugin），否则安装直接报 plugin_manifest_not_found。若不在上传时拦下，
 * 运营要等到用户点安装才会发现包是坏的。
 *
 * 只实现「列目录 + 读单个文件」两条路径，足够做校验；不解压落盘。
 */
import { deflateRawSync, inflateRawSync } from "node:zlib";

const EOCD_SIGNATURE = 0x06054b50;
const EOCD64_SIGNATURE = 0x06064b50;
const EOCD64_LOCATOR_SIGNATURE = 0x07064b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const LOCAL_HEADER_SIGNATURE = 0x04034b50;

export class ZipError extends Error {
  constructor(message) {
    super(message);
    this.name = "ZipError";
  }
}

function findEndOfCentralDirectory(buffer) {
  // EOCD 之后最多 64KB 注释，从尾部往前找。
  const maxComment = 0xffff;
  const minPos = Math.max(0, buffer.length - maxComment - 22);
  for (let pos = buffer.length - 22; pos >= minPos; pos -= 1) {
    if (buffer.readUInt32LE(pos) === EOCD_SIGNATURE) return pos;
  }
  throw new ZipError("不是合法的 ZIP 文件（找不到中央目录结尾）");
}

function readCentralDirectory(buffer) {
  const eocd = findEndOfCentralDirectory(buffer);
  let total = buffer.readUInt16LE(eocd + 10);
  let cdOffset = buffer.readUInt32LE(eocd + 16);

  // ZIP64：条目数或偏移溢出时从 ZIP64 EOCD 读取真实值。
  if (total === 0xffff || cdOffset === 0xffffffff) {
    const locatorPos = eocd - 20;
    if (locatorPos >= 0 && buffer.readUInt32LE(locatorPos) === EOCD64_LOCATOR_SIGNATURE) {
      const eocd64Pos = Number(buffer.readBigUInt64LE(locatorPos + 8));
      if (buffer.readUInt32LE(eocd64Pos) === EOCD64_SIGNATURE) {
        total = Number(buffer.readBigUInt64LE(eocd64Pos + 32));
        cdOffset = Number(buffer.readBigUInt64LE(eocd64Pos + 48));
      }
    }
  }

  const entries = [];
  let pos = cdOffset;
  for (let i = 0; i < total; i += 1) {
    if (pos + 46 > buffer.length || buffer.readUInt32LE(pos) !== CENTRAL_HEADER_SIGNATURE) {
      throw new ZipError("ZIP 中央目录损坏");
    }
    const flags = buffer.readUInt16LE(pos + 8);
    const compression = buffer.readUInt16LE(pos + 10);
    const compressedSize = buffer.readUInt32LE(pos + 20);
    const uncompressedSize = buffer.readUInt32LE(pos + 24);
    const nameLen = buffer.readUInt16LE(pos + 28);
    const extraLen = buffer.readUInt16LE(pos + 30);
    const commentLen = buffer.readUInt16LE(pos + 32);
    const localOffset = buffer.readUInt32LE(pos + 42);
    const name = buffer.toString("utf8", pos + 46, pos + 46 + nameLen);
    if ((flags & 0x1) !== 0) throw new ZipError(`不支持加密 ZIP 条目：${name}`);
    entries.push({ name, compression, compressedSize, uncompressedSize, localOffset });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

export function listZipEntries(buffer) {
  return readCentralDirectory(buffer);
}

/** 读取单个条目内容；仅支持 stored(0) 与 deflate(8)，这也是 zip 命令的默认输出。 */
export function readZipEntry(buffer, entry) {
  const pos = entry.localOffset;
  if (buffer.readUInt32LE(pos) !== LOCAL_HEADER_SIGNATURE) {
    throw new ZipError(`ZIP 条目头损坏：${entry.name}`);
  }
  const nameLen = buffer.readUInt16LE(pos + 26);
  const extraLen = buffer.readUInt16LE(pos + 28);
  const dataStart = pos + 30 + nameLen + extraLen;
  const raw = buffer.subarray(dataStart, dataStart + entry.compressedSize);
  if (entry.compression === 0) return Buffer.from(raw);
  if (entry.compression === 8) return inflateRawSync(raw);
  throw new ZipError(`不支持的 ZIP 压缩方式 ${entry.compression}：${entry.name}`);
}

const MANIFEST_CANDIDATES = [
  ".zcode-plugin/plugin.json",
  ".claude-plugin/plugin.json",
  ".codex-plugin/plugin.json",
];

/**
 * 定位插件 manifest。
 * ZCode 解压后若只有一个顶层目录会自动剥离（stripRoot），所以 manifest 可能在
 * 根目录，也可能在 `<单层目录>/` 下；这里两种都认。
 */
export function findPluginManifest(buffer) {
  const entries = readCentralDirectory(buffer);
  const files = entries.filter((e) => !e.name.endsWith("/"));
  if (files.length === 0) throw new ZipError("ZIP 是空的");

  const topLevel = new Set(files.map((e) => e.name.split("/")[0]));
  // 顶层只有一个目录时视为 stripRoot 后的插件根。
  const prefixes = [""];
  if (topLevel.size === 1) {
    const only = [...topLevel][0];
    if (!MANIFEST_CANDIDATES.includes(only)) prefixes.push(`${only}/`);
  }

  for (const prefix of prefixes) {
    for (const candidate of MANIFEST_CANDIDATES) {
      const entry = files.find((e) => e.name === prefix + candidate);
      if (entry) {
        return { entry, bytes: readZipEntry(buffer, entry), manifestPath: entry.name };
      }
    }
  }

  const sample = files.slice(0, 5).map((e) => e.name).join(", ");
  throw new ZipError(
    `包内缺少插件清单：需要 ${MANIFEST_CANDIDATES[0]}（也接受 .claude-plugin/plugin.json / .codex-plugin/plugin.json）。` +
      `当前包内文件：${sample}${files.length > 5 ? ` …共 ${files.length} 个` : ""}`
  );
}

export const PLUGIN_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/u;

/** 统计包内 SKILL.md 数量，供上传结果回显（ZCode 按 skills/<name>/SKILL.md 枚举）。 */
export function countSkillEntries(buffer) {
  try {
    return readCentralDirectory(buffer).filter(
      (e) => !e.name.endsWith("/") && /(^|\/)SKILL\.md$/u.test(e.name)
    ).length;
  } catch {
    return 0;
  }
}

/* ================================ 写入 ================================ */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

/**
 * 生成 ZIP（deflate 压缩）。
 * @param {Array<{name: string, data: string|Buffer}>} files 路径用 `/` 分隔，目录自动补条目
 * @returns {Buffer}
 */
export function createZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const seenDirs = new Set();

  // 显式写目录条目，避免部分解压器对隐式目录处理不一致。
  const allEntries = [];
  for (const file of files) {
    const parts = file.name.split("/");
    for (let i = 1; i < parts.length; i += 1) {
      const dir = parts.slice(0, i).join("/") + "/";
      if (!seenDirs.has(dir)) {
        seenDirs.add(dir);
        allEntries.push({ name: dir, data: Buffer.alloc(0), isDir: true });
      }
    }
    allEntries.push({ name: file.name, data: Buffer.from(file.data), isDir: false });
  }

  for (const entry of allEntries) {
    const nameBytes = Buffer.from(entry.name, "utf8");
    const raw = entry.data;
    const compressed = entry.isDir || raw.length === 0 ? raw : deflateRawSync(raw, { level: 9 });
    const useDeflate = !entry.isDir && raw.length > 0;
    const crc = entry.isDir ? 0 : crc32(raw);
    // 0x0800 = UTF-8 文件名标志
    const flags = 0x0800;
    const method = useDeflate ? 8 : 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10); // 时间
    local.writeUInt16LE(0x21, 12); // 日期（1980-01-01，固定值保证可复现构建）
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(entry.isDir ? 0x41ed0010 : 0x81a40000, 38); // unix mode in high 16 bits
    central.writeUInt32LE(offset, 42);

    localParts.push(local, nameBytes, compressed);
    centralParts.push(central, nameBytes);
    offset += local.length + nameBytes.length + compressed.length;
  }

  const centralBuffer = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIGNATURE, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(allEntries.length, 8);
  eocd.writeUInt16LE(allEntries.length, 10);
  eocd.writeUInt32LE(centralBuffer.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralBuffer, eocd]);
}
