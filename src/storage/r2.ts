/**
 * R2 对象存储封装：上传、按 Range 流式读取、删除、生成对象 key。
 * 文件不落 Worker 内存，全程 stream。
 */

import type { R2Bucket } from "@cloudflare/workers-types";

/** 生成 R2 key：yyyy/mm/<id>/<name> */
export function makeObjectKey(id: string, name: string): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const safe = name.replace(/[\\/:*?"<>|]/g, "_").slice(0, 100);
  return `${d.getUTCFullYear()}/${mm}/${id}/${safe}`;
}

export async function putObject(
  bucket: R2Bucket,
  key: string,
  body: ReadableStream | ArrayBuffer | Blob,
  mime: string,
  meta?: Record<string, string>,
): Promise<void> {
  // R2 自定义元数据值必须为字符串且长度受限
  const customMetadata: Record<string, string> = {};
  if (meta) {
    for (const [k, v] of Object.entries(meta)) {
      if (v != null) customMetadata[k] = String(v).slice(0, 1024);
    }
  }
  await bucket.put(key, body, {
    httpMetadata: { contentType: mime },
    customMetadata,
  });
}

export async function deleteObject(bucket: R2Bucket, key: string): Promise<void> {
  await bucket.delete(key);
}

/**
 * 简单全量读取（用于缩略图等小对象预览）。
 * 返回 body 流 + content-type + size，供路由直接 new Response。
 */
export async function getObject(
  bucket: R2Bucket,
  key: string,
): Promise<{ body: ReadableStream; size: number; etag: string | null } | null> {
  const obj = await bucket.get(key);
  if (!obj) return null;
  return {
    body: obj.body,
    size: obj.size,
    etag: obj.etag ?? null,
  };
}

export interface RangedObject {
  body: ReadableStream;
  status: number;
  headers: Record<string, string>;
}

/**
 * 读取对象，支持 Range。
 * 返回可直接喂给 `new Response` 的 status 与 headers。
 */
export async function rangedGet(
  bucket: R2Bucket,
  key: string,
  rangeHeader: string | null,
  filename: string,
  mime: string,
): Promise<RangedObject | null> {
  const parsed = rangeHeader ? parseRange(rangeHeader) : null;
  const obj = parsed ? await bucket.get(key, { range: toR2Range(parsed) }) : await bucket.get(key);
  if (!obj) return null;

  const headers: Record<string, string> = {
    "Content-Type": mime || "application/octet-stream",
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    "Cache-Control": "private, max-age=0, no-store",
  };

  let status = 200;
  if (parsed && obj.size != null) {
    const total = obj.size;
    let start: number;
    let len: number;
    if (Number.isNaN(parsed.start)) {
      // suffix 模式：取末尾 length 字节
      len = Math.min(parsed.length, total);
      start = total - len;
    } else if (parsed.length === Infinity) {
      start = Math.min(parsed.start, total);
      len = total - start;
    } else {
      start = parsed.start;
      len = Math.min(parsed.length, total - start);
    }
    if (len < 0) len = 0;
    const end = start + Math.max(0, len) - 1;
    headers["Content-Range"] = `bytes ${start}-${end}/${total}`;
    headers["Content-Length"] = String(len);
    headers["Accept-Ranges"] = "bytes";
    status = 206;
  } else if (obj.size != null) {
    headers["Content-Length"] = String(obj.size);
    headers["Accept-Ranges"] = "bytes";
  }

  return { body: obj.body, status, headers };
}

/** 已解析的范围（归一化为 start + length） */
interface ParsedRange {
  start: number;
  length: number;
}

/**
 * 解析 `bytes=START-END`（单范围）。
 *   bytes=START-END  → start=START, length=END-START+1
 *   bytes=START-     → start=START, length=Infinity（实际取到文件尾）
 *   bytes=-END       → length=END，从文件末尾算
 */
function parseRange(header: string): ParsedRange | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const hasStart = m[1].length > 0;
  const hasEnd = m[2].length > 0;
  if (!hasStart && !hasEnd) return null;
  if (hasStart && hasEnd) {
    const start = parseInt(m[1], 10);
    const end = parseInt(m[2], 10);
    return { start, length: end - start + 1 };
  }
  if (hasStart) {
    return { start: parseInt(m[1], 10), length: Infinity };
  }
  // bytes=-END：取末尾 END 字节（start 需依赖文件大小，此处用 suffix 表达）
  return { start: NaN, length: parseInt(m[2], 10) }; // start=NaN 表示 suffix 模式
}

/** 把已解析范围转成 R2 get 接受的 R2Range */
function toR2Range(p: ParsedRange): R2Range {
  if (Number.isNaN(p.start)) {
    return { suffix: p.length }; // bytes=-END
  }
  if (p.length === Infinity) {
    return { offset: p.start };
  }
  return { offset: p.start, length: p.length };
}
