/**
 * 订单 / 购买记录 / 下载令牌的生命周期管理。
 * 所有写操作幂等，可安全应对重复回调。
 */

import type { D1Database } from "@cloudflare/workers-types";
import { nowIso, nowSec, randomBase64url } from "../lib/crypto";

export interface OrderRow {
  id: string;
  file_id: string;
  user_uid: string | null;
  share_id: string | null;
  amount: number;
  status: string; // pending | paid | failed
  trade_no: string | null;
  created_at: string;
  paid_at: string | null;
}

/** 生成订单号：时间戳 + 随机，避免冲突 */
export function newOrderId(): string {
  const ts = Date.now().toString(36);
  const rand = randomBase64url(6);
  return `LDC${ts}${rand}`.replace(/[-_]/g, "").toUpperCase().slice(0, 28);
}

export async function createOrder(
  db: D1Database,
  input: {
    id: string;
    fileId: string;
    userUid: string | null;
    amount: number;
    shareId?: string | null;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO orders (id, file_id, user_uid, share_id, amount, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
    )
    .bind(input.id, input.fileId, input.userUid, input.shareId ?? null, input.amount, nowIso())
    .run();
}

export async function getOrder(db: D1Database, id: string): Promise<OrderRow | null> {
  const row = await db
    .prepare(`SELECT * FROM orders WHERE id = ?`)
    .bind(id)
    .first<OrderRow>();
  return row ?? null;
}

/**
 * 标记订单为已支付（幂等）。
 * 仅当金额与订单一致、订单未取消时，写购买记录。
 * 返回是否本次真正完成了发货（用于幂等性判断）。
 */
export async function markPaid(
  db: D1Database,
  orderId: string,
  tradeNo: string | null,
  amount: number,
): Promise<{ fulfilled: boolean; order: OrderRow | null }> {
  const order = await getOrder(db, orderId);
  if (!order) return { fulfilled: false, order: null };

  // 金额必须匹配
  if (order.amount !== amount) {
    return { fulfilled: false, order };
  }

  // 已发货：幂等返回，不再重复
  if (order.status === "paid") {
    return { fulfilled: false, order };
  }

  // 用事务保证：更新订单 + 写购买记录
  // 登录订单：写 purchases(user_uid) ；分享匿名订单：写 purchases(share_id, user_uid=NULL)
  const stmts = [
    db
      .prepare(
        `UPDATE orders SET status = 'paid', trade_no = ?, paid_at = ? WHERE id = ? AND status != 'paid'`,
      )
      .bind(tradeNo, nowIso(), orderId),
    db
      .prepare(
        `INSERT OR IGNORE INTO purchases (id, file_id, user_uid, share_id, order_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        randomBase64url(12),
        order.file_id,
        order.user_uid,
        order.share_id,
        orderId,
        nowIso(),
      ),
  ];
  await db.batch(stmts);

  return { fulfilled: true, order: (await getOrder(db, orderId))! };
}

export async function markFailed(db: D1Database, orderId: string): Promise<void> {
  await db
    .prepare(`UPDATE orders SET status = 'failed' WHERE id = ? AND status = 'pending'`)
    .bind(orderId)
    .run();
}

/** 用户是否已购买（或免费）某文件 */
export async function isOwned(db: D1Database, fileId: string, userUid: string): Promise<boolean> {
  const row = await db
    .prepare(`SELECT 1 FROM purchases WHERE file_id = ? AND user_uid = ? LIMIT 1`)
    .bind(fileId, userUid)
    .first();
  return !!row;
}

/**
 * 若存在已支付订单，补记 purchase（用于免费/历史情况）。
 * 仅当 price<=0（免费）或存在 paid 订单时插入。
 */
export async function recordPurchaseIfPaid(
  db: D1Database,
  fileId: string,
  userUid: string,
  orderId: string | null,
): Promise<boolean> {
  // 免费文件直接记
  if (orderId === null) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO purchases (id, file_id, user_uid, share_id, order_id, created_at)
         VALUES (?, ?, ?, NULL, NULL, ?)`,
      )
      .bind(randomBase64url(12), fileId, userUid, nowIso())
      .run();
    return true;
  }
  // 校验订单已支付
  const o = await getOrder(db, orderId);
  if (!o || o.status !== "paid") return false;
  await db
    .prepare(
      `INSERT OR IGNORE INTO purchases (id, file_id, user_uid, share_id, order_id, created_at)
       VALUES (?, ?, ?, NULL, ?, ?)`,
    )
    .bind(randomBase64url(12), fileId, userUid, orderId, nowIso())
    .run();
  return true;
}

// ── 下载令牌 ──────────────────────────────────────────────
const TOKEN_TTL_SEC = 10 * 60;

export interface ConsumedToken {
  fileId: string;
  userUid: string | null;
  shareId: string | null;
}

/** 登录用户令牌：带 user_uid */
export async function issueDownloadToken(
  db: D1Database,
  fileId: string,
  userUid: string,
): Promise<string> {
  return issueToken(db, fileId, userUid, null);
}

/** 分享匿名令牌：user_uid=NULL，带 share_id（用于吊销/过期回查） */
export async function issueAnonymousDownloadToken(
  db: D1Database,
  fileId: string,
  shareId: string,
): Promise<string> {
  return issueToken(db, fileId, null, shareId);
}

async function issueToken(
  db: D1Database,
  fileId: string,
  userUid: string | null,
  shareId: string | null,
): Promise<string> {
  const token = randomBase64url(24);
  const exp = new Date((nowSec() + TOKEN_TTL_SEC) * 1000).toISOString();
  await db
    .prepare(
      `INSERT INTO download_tokens (token, file_id, user_uid, share_id, expires_at, used, created_at)
       VALUES (?, ?, ?, ?, ?, 0, ?)`,
    )
    .bind(token, fileId, userUid, shareId, exp, nowIso())
    .run();
  return token;
}

/**
 * 消费下载令牌（一次性）。
 * 返回文件 id 与关联的 uid/share_id；无效/已用/过期返回 null。
 * 注意：share 令牌的有效性（吊销/过期/耗尽）由路由层据 shareId 回查，
 * 这里只保证令牌本身的一次性与时效。
 */
export async function consumeDownloadToken(
  db: D1Database,
  token: string,
): Promise<ConsumedToken | null> {
  const row = await db
    .prepare(
      `SELECT file_id, user_uid, share_id, expires_at, used FROM download_tokens WHERE token = ?`,
    )
    .bind(token)
    .first<{ file_id: string; user_uid: string | null; share_id: string | null; expires_at: string; used: number }>();
  if (!row) return null;
  if (row.used) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  // 标记已用（仅在未用时）
  const res = await db
    .prepare(`UPDATE download_tokens SET used = 1 WHERE token = ? AND used = 0`)
    .bind(token)
    .run();
  if (res.meta.changes === 0) return null; // 并发竞争失败
  return { fileId: row.file_id, userUid: row.user_uid, shareId: row.share_id };
}
