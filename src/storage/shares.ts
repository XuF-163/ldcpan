/**
 * 分享链接元数据：CRUD + 计数 + 吊销。
 * 有效性判定（isActive）集中在此，路由层复用。
 */

import type { D1Database } from "@cloudflare/workers-types";
import { nowIso } from "../lib/crypto";

export interface ShareRow {
  id: string;
  file_id: string;
  created_by: string;
  password_hash: string | null;
  password_salt: string | null;
  expires_at: string | null;
  max_claims: number | null;
  claims: number;
  downloads: number;
  revoked_at: string | null;
  created_at: string;
}

/** 8 位 base32 短 id（与文件 id 同源，避免歧义字符） */
export function newShareId(): string {
  const alpha = "234567abcdefghijklmnopqrstuvwxyz";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += alpha[bytes[i] % alpha.length];
  return s;
}

export interface CreateShareInput {
  fileId: string;
  createdBy: string;
  passwordHash?: string | null;
  passwordSalt?: string | null;
  expiresAt?: string | null;
  maxClaims?: number | null;
}

export async function createShare(db: D1Database, input: CreateShareInput): Promise<ShareRow> {
  const id = newShareId();
  await db
    .prepare(
      `INSERT INTO shares (id, file_id, created_by, password_hash, password_salt, expires_at, max_claims, claims, downloads, revoked_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, NULL, ?)`,
    )
    .bind(
      id,
      input.fileId,
      input.createdBy,
      input.passwordHash ?? null,
      input.passwordSalt ?? null,
      input.expiresAt ?? null,
      input.maxClaims ?? null,
      nowIso(),
    )
    .run();
  return (await getShare(db, id))!;
}

export async function getShare(db: D1Database, id: string): Promise<ShareRow | null> {
  const row = await db
    .prepare(`SELECT * FROM shares WHERE id = ?`)
    .bind(id)
    .first<ShareRow>();
  return row ?? null;
}

export async function listSharesByFile(db: D1Database, fileId: string): Promise<ShareRow[]> {
  return (
    await db
      .prepare(`SELECT * FROM shares WHERE file_id = ? ORDER BY created_at DESC`)
      .bind(fileId)
      .all<ShareRow>()
  ).results;
}

export async function listAllShares(db: D1Database, limit = 100): Promise<ShareRow[]> {
  return (
    await db
      .prepare(`SELECT * FROM shares ORDER BY created_at DESC LIMIT ?`)
      .bind(limit)
      .all<ShareRow>()
  ).results;
}

/** claims +1（授权成功时调用）。返回是否仍可用（未越 max_claims） */
export async function incClaim(db: D1Database, id: string): Promise<boolean> {
  await db
    .prepare(`UPDATE shares SET claims = claims + 1 WHERE id = ?`)
    .bind(id)
    .run();
  const row = await getShare(db, id);
  if (!row || row.max_claims == null) return true; // 不限次数
  return row.claims <= row.max_claims;
}

export async function incDownload(db: D1Database, id: string): Promise<void> {
  await db
    .prepare(`UPDATE shares SET downloads = downloads + 1 WHERE id = ?`)
    .bind(id)
    .run();
}

export async function revokeShare(db: D1Database, id: string): Promise<void> {
  await db
    .prepare(`UPDATE shares SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`)
    .bind(nowIso(), id)
    .run();
}

export interface ShareStatus {
  active: boolean;
  reason?: "revoked" | "expired" | "exhausted";
}

/** 综合判定分享是否有效（未吊销 / 未过期 / 未耗尽） */
export function shareStatus(s: ShareRow): ShareStatus {
  if (s.revoked_at) return { active: false, reason: "revoked" };
  if (s.expires_at && new Date(s.expires_at).getTime() < Date.now()) {
    return { active: false, reason: "expired" };
  }
  if (s.max_claims != null && s.claims >= s.max_claims) {
    return { active: false, reason: "exhausted" };
  }
  return { active: true };
}

export function hasPassword(s: ShareRow): boolean {
  return !!s.password_hash && !!s.password_salt;
}
