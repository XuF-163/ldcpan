/**
 * 文件元数据：CRUD + 列表查询。薄封装于 D1。
 */

import type { D1Database } from "@cloudflare/workers-types";
import { nowIso } from "../lib/crypto";

export interface FileRow {
  id: string;
  key: string;
  name: string;
  size: number;
  mime: string;
  price: number | null;
  description: string | null;
  category: string | null;
  downloads: number;
  uploaded_by: string | null;
  hidden: number;
  created_at: string;
}

/** 8 位 base32 短 id（不区分大小写字母去歧义） */
export function newFileId(): string {
  const alpha = "234567abcdefghijklmnopqrstuvwxyz";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += alpha[bytes[i] % alpha.length];
  return s;
}

export interface CreateFileInput {
  key: string;
  name: string;
  size: number;
  mime: string;
  price: number | null;
  description?: string | null;
  category?: string | null;
  uploaded_by: string;
}

export async function createFile(db: D1Database, input: CreateFileInput): Promise<FileRow> {
  const id = newFileId();
  await db
    .prepare(
      `INSERT INTO files (id, key, name, size, mime, price, description, category, downloads, uploaded_by, hidden, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0, ?)`,
    )
    .bind(
      id,
      input.key,
      input.name,
      input.size,
      input.mime,
      input.price,
      input.description ?? null,
      input.category ?? null,
      input.uploaded_by,
      nowIso(),
    )
    .run();
  return (await getFile(db, id))!;
}

export async function getFile(db: D1Database, id: string): Promise<FileRow | null> {
  const row = await db
    .prepare(`SELECT * FROM files WHERE id = ?`)
    .bind(id)
    .first<FileRow>();
  return row ?? null;
}

export async function updateFile(
  db: D1Database,
  id: string,
  patch: Partial<Pick<FileRow, "price" | "description" | "category" | "hidden">>,
): Promise<void> {
  const sets: string[] = [];
  const vals: (string | number | null)[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    sets.push(`${k} = ?`);
    if (k === "hidden") vals.push(v ? 1 : 0);
    else vals.push(v as string | number | null);
  }
  if (sets.length === 0) return;
  vals.push(id);
  await db.prepare(`UPDATE files SET ${sets.join(", ")} WHERE id = ?`).bind(...vals).run();
}

export async function deleteFile(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM files WHERE id = ?`).bind(id).run();
}

export async function incrementDownloads(db: D1Database, id: string): Promise<void> {
  await db.prepare(`UPDATE files SET downloads = downloads + 1 WHERE id = ?`).bind(id).run();
}

export interface ListOptions {
  category?: string;
  q?: string;
  includeHidden?: boolean;
  limit?: number;
  offset?: number;
}

export async function listFiles(db: D1Database, opts: ListOptions = {}): Promise<FileRow[]> {
  const where: string[] = [];
  const vals: (string | number)[] = [];
  if (!opts.includeHidden) {
    where.push("hidden = 0");
  }
  if (opts.category) {
    where.push("category = ?");
    vals.push(opts.category);
  }
  if (opts.q) {
    where.push("(name LIKE ? OR description LIKE ?)");
    const like = `%${opts.q}%`;
    vals.push(like, like);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  return (
    await db
      .prepare(
        `SELECT * FROM files ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      )
      .bind(...vals, limit, offset)
      .all<FileRow>()
  ).results;
}

export async function listCategories(db: D1Database): Promise<string[]> {
  const rows = await db
    .prepare(
      `SELECT DISTINCT category FROM files WHERE category IS NOT NULL AND category != '' AND hidden = 0 ORDER BY category`,
    )
    .all<{ category: string }>();
  return rows.results.map((r) => r.category);
}
