-- ─────────────────────────────────────────────────────────────
-- LDC 内部网盘 D1 schema（含分享链接系统）
-- 初始化：wrangler d1 execute ldcpan-db --remote --file=./schema.sql
-- 已有库升级：见 migrations/002_shares.sql
-- ─────────────────────────────────────────────────────────────

PRAGMA foreign_keys = ON;

-- 用户表：来自 LINUX DO Connect userinfo
CREATE TABLE IF NOT EXISTS users (
  uid         TEXT PRIMARY KEY,          -- = Connect sub
  username    TEXT NOT NULL UNIQUE,
  name        TEXT,
  email       TEXT,
  avatar_url  TEXT,
  trust_level INTEGER NOT NULL DEFAULT 0,
  is_admin    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  last_login  TEXT NOT NULL
);

-- 文件元数据
CREATE TABLE IF NOT EXISTS files (
  id          TEXT PRIMARY KEY,          -- 短 id（8 位 base32）
  key         TEXT NOT NULL UNIQUE,       -- R2 对象 key
  name        TEXT NOT NULL,              -- 原始文件名
  size        INTEGER NOT NULL,
  mime        TEXT NOT NULL,
  price       INTEGER,                    -- NULL=用默认价；0=免费；>0=单价
  description TEXT,
  category    TEXT,
  downloads   INTEGER NOT NULL DEFAULT 0,
  uploaded_by TEXT,
  hidden      INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_files_category ON files(category);
CREATE INDEX IF NOT EXISTS idx_files_created  ON files(created_at DESC);

-- 订单（id 即 EasyPay 的 out_trade_no）
-- user_uid 可空：分享链路产生的匿名订单无 uid，改用 share_id 关联
CREATE TABLE IF NOT EXISTS orders (
  id            TEXT PRIMARY KEY,        -- out_trade_no
  file_id       TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  user_uid      TEXT,                     -- 登录态购买有值；分享匿名订单为 NULL
  share_id      TEXT,                     -- 分享订单才有值
  amount        INTEGER NOT NULL,        -- 积分（整数）
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending | paid | failed
  trade_no      TEXT,                     -- 平台流水号
  created_at    TEXT NOT NULL,
  paid_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_user   ON orders(user_uid);
CREATE INDEX IF NOT EXISTS idx_orders_share  ON orders(share_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

-- 购买记录（一个文件每用户只记一次，支持重复下载）
-- user_uid 可空：分享匿名购买记录无 uid，改用 share_id
CREATE TABLE IF NOT EXISTS purchases (
  id         TEXT PRIMARY KEY,
  file_id    TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  user_uid   TEXT,                        -- 登录用户有值；分享匿名购买为 NULL
  share_id   TEXT,                        -- 分享匿名购买才有值
  order_id   TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_purchases_user  ON purchases(user_uid);
CREATE INDEX IF NOT EXISTS idx_purchases_share ON purchases(share_id);
-- 登录用户：(file_id, user_uid) 去重；分享：(file_id, share_id) 不去重（每次付费一次下载）

-- 一次性短时下载令牌
-- user_uid 可空：分享匿名令牌无 uid，改用 share_id
CREATE TABLE IF NOT EXISTS download_tokens (
  token      TEXT PRIMARY KEY,
  file_id    TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  user_uid   TEXT,                        -- 登录用户令牌有值；分享匿名令牌为 NULL
  share_id   TEXT,                        -- 分享令牌才有值（用于吊销/过期回查）
  expires_at TEXT NOT NULL,
  used       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dt_user  ON download_tokens(user_uid);
CREATE INDEX IF NOT EXISTS idx_dt_share ON download_tokens(share_id);

-- ── 分享链接系统 ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shares (
  id            TEXT PRIMARY KEY,         -- 8 位短 id，用于 /s/:id
  file_id       TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  created_by    TEXT NOT NULL,            -- 管理员 uid
  password_hash TEXT,                      -- 可空=无密码；sha256(salt+password)
  password_salt TEXT,                      -- 有密码时必填
  expires_at    TEXT,                      -- 可空=永久
  max_claims    INTEGER,                   -- 可空=不限；claims>=max_claims 失效
  claims        INTEGER NOT NULL DEFAULT 0,
  downloads     INTEGER NOT NULL DEFAULT 0,
  revoked_at    TEXT,                      -- 非空=已吊销
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_shares_file ON shares(file_id);
