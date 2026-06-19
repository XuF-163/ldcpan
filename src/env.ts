/**
 * Cloudflare Worker bindings、变量、密钥的类型定义。
 *  - bindings: R2 / D1 / KV
 *  - vars:     wrangler.toml [vars] 中可明文的配置
 *  - secrets:  通过 `wrangler secret put` 注入的敏感值
 */

/** Worker 绑定资源 */
export interface Bindings {
  // ── 资源 ──
  BUCKET: R2Bucket;
  DB: D1Database;
  SESSIONS: KVNamespace;

  // ── 非敏感变量（来自 [vars]）──
  SITE_NAME: string;
  SITE_BASE_URL: string; // 形如 https://ldcpan.example.workers.dev（无尾斜杠）
  DEFAULT_PRICE: string; // 字符串形式，运行时 parse

  // LINUX DO Connect
  LDC_CLIENT_ID: string;
  LDC_REDIRECT_URI: string;

  // LINUX DO Credit（EasyPay）
  CREDIT_PID: string;
  CREDIT_NOTIFY_URL: string;
  CREDIT_RETURN_URL: string;

  // 管理员用户名（逗号分隔）
  ADMIN_USERNAMES: string;

  // ── 密钥（secret put）──
  LDC_CLIENT_SECRET: string; // Connect OAuth2 client secret
  CREDIT_KEY: string; // EasyPay 商户密钥
  SESSION_SECRET: string; // 会话 cookie / state 签名密钥
}

/** 从 env 读取解析后的配置 */
export interface AppConfig {
  siteName: string;
  siteBaseUrl: string;
  defaultPrice: number;
  adminUsernames: Set<string>;
}

export function readConfig(env: Bindings): AppConfig {
  const defaultPrice = Number.parseInt(env.DEFAULT_PRICE ?? "0", 10);
  return {
    siteName: env.SITE_NAME || "LDC 网盘",
    siteBaseUrl: (env.SITE_BASE_URL || "").replace(/\/+$/, ""),
    defaultPrice: Number.isFinite(defaultPrice) ? defaultPrice : 0,
    adminUsernames: new Set(
      (env.ADMIN_USERNAMES || "")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    ),
  };
}

/** 计算文件的有效价格：null → 默认价；0 → 免费；>0 → 自定价 */
export function effectivePrice(
  filePrice: number | null,
  defaultPrice: number,
): number {
  if (filePrice === null) return defaultPrice;
  return Math.max(0, filePrice);
}
