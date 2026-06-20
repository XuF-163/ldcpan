/**
 * 纯手写 ZIP 打包器（STORE 模式，不压缩）。
 * 零外部依赖，浏览器与 Node 通用。
 *
 * 实现的 ZIP 格式结构（每条目 STORE=method 0）：
 *   [Local File Header][文件数据] × N
 *   [Central Directory Header] × N
 *   [End Of Central Directory Record]
 * 所有多字节整数用小端（little-endian）。
 *
 * 适用：文件夹上传时把多文件打包成单个 .zip。不压缩，体积≈原文件总和，
 * 但对图片/视频/已压缩文件几乎无损，且实现简单可靠。
 */

export interface ZipEntry {
  /** ZIP 内相对路径，用 / 分隔（如 "项目A/源码/main.ts"）；目录条目以 / 结尾 */
  path: string;
  /** 文件字节；目录条目传空 Uint8Array */
  data: Uint8Array;
  /** 是否目录（空目录占位条目） */
  isDir?: boolean;
}

// ── CRC32（标准查表法）──────────────────────────────────
const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

/** 计算字节的 CRC32（返回无符号 32 位整数） */
export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** UTF-8 字符串编码（兼容环境无 TextEncoder 的极旧浏览器，否则直接用） */
function utf8(str: string): Uint8Array {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(str);
  }
  // fallback：手动 UTF-8（仅 ASCII/BMP 覆盖）
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c < 0x80) bytes.push(c);
    else if (c < 0x800) {
      bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else {
      bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
  }
  return new Uint8Array(bytes);
}

/** 把 UTF-8 字符串当作通用标志位的"语言编码"标记（bit 11）置 1 */
const FLAG_UTF8 = 0x800;

/** DOS 时间/日期（固定 1980-01-01 00:00:00，ZIP 最小合法值） */
const DOS_TIME = 0x0000;
const DOS_DATE = 0x0021;

/**
 * 打包多个条目为 ZIP 字节流（STORE 模式）。
 * @param entries 条目列表（文件 + 可选目录占位）
 * @returns 完整 ZIP 文件字节
 */
export function buildZip(entries: ZipEntry[]): Uint8Array {
  // 先算每条目的元数据与字节布局
  type Meta = {
    name: Uint8Array;
    data: Uint8Array;
    crc: number;
    isDir: boolean;
    localOffset: number;
    localSize: number;
  };

  const metas: Meta[] = [];
  let offset = 0;

  for (const e of entries) {
    // 路径规范化：ZIP 规范要求正斜杠；目录条目以 / 结尾
    let p = e.path.replace(/\\/g, "/");
    const isDir = !!e.isDir || p.endsWith("/");
    if (isDir && !p.endsWith("/")) p += "/";
    const name = utf8(p);
    const data = isDir ? new Uint8Array(0) : e.data;
    const crc = isDir ? 0 : crc32(data);
    const localSize = 30 + name.length + data.length; // Local File Header 固定 30 字节
    metas.push({ name, data, crc, isDir, localOffset: offset, localSize });
    offset += localSize;
  }

  // 中央目录大小
  let cdSize = 0;
  for (const m of metas) {
    cdSize += 46 + m.name.length; // Central Directory Header 固定 46 字节
  }
  const eocdSize = 22; // EOCD 固定 22 字节

  const total = offset + cdSize + eocdSize;
  const buf = new Uint8Array(total);
  const dv = new DataView(buf.buffer);

  let pos = 0;

  // ── Local File Header + 数据 ──
  const writeLocal = (m: Meta) => {
    const start = pos;
    dv.setUint32(pos, 0x04034b50, true); pos += 4; // 本地文件头魔数 PK\x03\x04
    dv.setUint16(pos, 20, true); pos += 2; // 解压所需版本 2.0
    dv.setUint16(pos, FLAG_UTF8, true); pos += 2; // 通用标志：UTF-8 文件名
    dv.setUint16(pos, 0, true); pos += 2; // 压缩方法 0=STORE
    dv.setUint16(pos, DOS_TIME, true); pos += 2; // 最后修改时间
    dv.setUint16(pos, DOS_DATE, true); pos += 2; // 最后修改日期
    dv.setUint32(pos, m.crc, true); pos += 4; // CRC-32
    dv.setUint32(pos, m.data.length, true); pos += 4; // 压缩后大小
    dv.setUint32(pos, m.data.length, true); pos += 4; // 压缩前大小（STORE 下=压缩后）
    dv.setUint16(pos, m.name.length, true); pos += 2; // 文件名长度
    dv.setUint16(pos, 0, true); pos += 2; // 额外字段长度
    buf.set(m.name, pos); pos += m.name.length; // 文件名
    buf.set(m.data, pos); pos += m.data.length; // 文件数据
    void start;
  };

  // ── Central Directory Header ──
  const writeCentral = (m: Meta) => {
    dv.setUint32(pos, 0x02014b50, true); pos += 4; // 中央目录头魔数 PK\x01\x02
    dv.setUint16(pos, 20, true); pos += 2; // 制作版本 2.0
    dv.setUint16(pos, 20, true); pos += 2; // 解压所需版本 2.0
    dv.setUint16(pos, FLAG_UTF8, true); pos += 2; // 通用标志：UTF-8
    dv.setUint16(pos, 0, true); pos += 2; // 压缩方法 0=STORE
    dv.setUint16(pos, DOS_TIME, true); pos += 2; // 最后修改时间
    dv.setUint16(pos, DOS_DATE, true); pos += 2; // 最后修改日期
    dv.setUint32(pos, m.crc, true); pos += 4; // CRC-32
    dv.setUint32(pos, m.data.length, true); pos += 4; // 压缩后大小
    dv.setUint32(pos, m.data.length, true); pos += 4; // 压缩前大小
    dv.setUint16(pos, m.name.length, true); pos += 2; // 文件名长度
    dv.setUint16(pos, 0, true); pos += 2; // 额外字段长度
    dv.setUint16(pos, 0, true); pos += 2; // 文件注释长度
    dv.setUint16(pos, 0, true); pos += 2; // 起始盘号
    dv.setUint16(pos, 0, true); pos += 2; // 内部属性
    dv.setUint32(pos, m.isDir ? 0x10 : 0, true); pos += 4; // 外部属性（目录=0x10）
    dv.setUint32(pos, m.localOffset, true); pos += 4; // 本地头相对偏移
    buf.set(m.name, pos); pos += m.name.length; // 文件名
  };

  for (const m of metas) writeLocal(m);
  const cdStart = pos;
  for (const m of metas) writeCentral(m);
  const cdEnd = pos;

  // ── End Of Central Directory Record ──
  dv.setUint32(pos, 0x06054b50, true); pos += 4; // EOCD 魔数 PK\x05\x06
  dv.setUint16(pos, 0, true); pos += 2; // 当前盘号
  dv.setUint16(pos, 0, true); pos += 2; // 中央目录起始盘号
  dv.setUint16(pos, metas.length, true); pos += 2; // 本盘中央目录条目数
  dv.setUint16(pos, metas.length, true); pos += 2; // 中央目录总条目数
  dv.setUint32(pos, cdEnd - cdStart, true); pos += 4; // 中央目录大小
  dv.setUint32(pos, cdStart, true); pos += 4; // 中央目录起始偏移
  dv.setUint16(pos, 0, true); pos += 2; // 注释长度

  return buf;
}
