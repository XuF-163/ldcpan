-- ─────────────────────────────────────────────────────────────
-- 迁移 002：分享链接系统
-- 用于已部署的线上库（已有 orders/purchases/download_tokens 数据）
-- 运行：wrangler d1 execute ldcpan-db --remote --file=./migrations/002_shares.sql
--
-- SQLite 不支持 ALTER TABLE DROP/改约束，需"重建表"：
--   1. 建新表（带 share_id、user_uid 可空）
--   2. 拷贝旧数据
--   3. 删旧表
--   4. 重命名新表
-- 全部在事务里执行；本地开发库直接重跑 schema.sql 即可。
-- ─────────────────────────────────────────────────────────────

PRAGMA foreign_keys = OFF;
BEGIN;

-- ── orders ───────────────────────────────────────────────
CREATE TABLE orders_new (
  id            TEXT PRIMARY KEY,
  file_id       TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  user_uid      TEXT,
  share_id      TEXT,
  amount        INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',
  trade_no      TEXT,
  created_at    TEXT NOT NULL,
  paid_at       TEXT
);
INSERT INTO orders_new (id, file_id, user_uid, share_id, amount, status, trade_no, created_at, paid_at)
  SELECT id, file_id, user_uid, NULL, amount, status, trade_no, created_at, paid_at FROM orders;
DROP TABLE orders;
ALTER TABLE orders_new RENAME TO orders;
CREATE INDEX IF NOT EXISTS idx_orders_user   ON orders(user_uid);
CREATE INDEX IF NOT EXISTS idx_orders_share  ON orders(share_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

-- ── purchases ───────────────────────────────────────────
CREATE TABLE purchases_new (
  id         TEXT PRIMARY KEY,
  file_id    TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  user_uid   TEXT,
  share_id   TEXT,
  order_id   TEXT,
  created_at TEXT NOT NULL
);
INSERT INTO purchases_new (id, file_id, user_uid, share_id, order_id, created_at)
  SELECT id, file_id, user_uid, NULL, order_id, created_at FROM purchases;
DROP TABLE purchases;
ALTER TABLE purchases_new RENAME TO purchases;
CREATE INDEX IF NOT EXISTS idx_purchases_user  ON purchases(user_uid);
CREATE INDEX IF NOT EXISTS idx_purchases_share ON purchases(share_id);

-- ── download_tokens ─────────────────────────────────────
CREATE TABLE download_tokens_new (
  token      TEXT PRIMARY KEY,
  file_id    TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  user_uid   TEXT,
  share_id   TEXT,
  expires_at TEXT NOT NULL,
  used       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
INSERT INTO download_tokens_new (token, file_id, user_uid, share_id, expires_at, used, created_at)
  SELECT token, file_id, user_uid, NULL, expires_at, used, created_at FROM download_tokens;
DROP TABLE download_tokens;
ALTER TABLE download_tokens_new RENAME TO download_tokens;
CREATE INDEX IF NOT EXISTS idx_dt_user  ON download_tokens(user_uid);
CREATE INDEX IF NOT EXISTS idx_dt_share ON download_tokens(share_id);

-- ── shares（新表）─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shares (
  id            TEXT PRIMARY KEY,
  file_id       TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  created_by    TEXT NOT NULL,
  password_hash TEXT,
  password_salt TEXT,
  expires_at    TEXT,
  max_claims    INTEGER,
  claims        INTEGER NOT NULL DEFAULT 0,
  downloads     INTEGER NOT NULL DEFAULT 0,
  revoked_at    TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_shares_file ON shares(file_id);

COMMIT;
PRAGMA foreign_keys = ON;
