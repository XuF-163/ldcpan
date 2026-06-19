/**
 * /pay 路由：EasyPay 协议（LINUX DO Credit）。
 *
 * 流程：
 *   /create → 建订单 → 构造 EasyPay 下单参数 → 返回自动 POST 提交表单
 *   用户在 credit 平台完成扣分
 *   平台异步 GET /notify?...&sign=...  → 验签 → markPaid → 回 "success"
 *   平台同步 GET /return?order=...      → 展示等待页（轮询 /status）
 *   /status 返回 paid 后跳 /done → 发下载令牌 → 跳下载
 *
 * 签名验证失败排查要点：
 *   - money 必须与提交/回调中完全一致（统一 formatMoney 规范化）
 *   - 仅非空字段参与签名，按 key ASCII 升序，末尾拼接商户密钥
 */

import { Hono } from "hono";
import type { Context } from "hono";
import type { D1Database } from "@cloudflare/workers-types";
import type { Bindings } from "../env";
import { effectivePrice } from "../env";
import { requireAuth, getSession } from "../auth/session";
import { getFile } from "../storage/files";
import {
  createOrder,
  getOrder,
  markPaid,
  newOrderId,
  isOwned,
  issueDownloadToken,
  issueAnonymousDownloadToken,
} from "../payment/orders";
import {
  buildOrderParams,
  buildSubmitFormHtml,
  sign,
  verifySign,
  formatMoney,
} from "../payment/epay";
import { getShare, shareStatus } from "../storage/shares";
import { renderResult, renderWaiting } from "../views/pay";

export const payRoutes = new Hono<{ Bindings: Bindings }>();

/** 读取 notify/return 配置（wrangler.toml 已配置，兼容缺失） */
function notifyUrl(env: Bindings): string {
  return (
    (env as unknown as { CREDIT_NOTIFY_URL?: string }).CREDIT_NOTIFY_URL || ""
  );
}
function returnUrl(env: Bindings, orderId: string): string {
  const base = (env as unknown as { CREDIT_RETURN_URL?: string }).CREDIT_RETURN_URL;
  if (base) {
    // 带 order 参数，便于 return 页回查订单
    const sep = base.includes("?") ? "&" : "?";
    return `${base}${sep}order=${encodeURIComponent(orderId)}`;
  }
  return "";
}

/** 商品名：站点名 · 文件名（平台限制 64 字符，buildOrderParams 内会再截断） */
function productName(cfg: { siteName: string }, fileName: string): string {
  return `${cfg.siteName} · ${fileName}`.slice(0, 64);
}

// ── 创建订单 + 跳转 credit 下单页 ───────────────────────
// 登录用户付费
payRoutes.get("/create", requireAuth, async (c) => {
  const cfg = c.get("config");
  const session = getSession(c)!;
  const fileId = c.req.query("file_id");
  if (!fileId) return c.text("缺少 file_id", 400);

  const file = await getFile(c.env.DB, fileId);
  if (!file || (file.hidden && !session.isAdmin)) {
    return c.text("文件不存在", 404);
  }

  const price = effectivePrice(file.price, cfg.defaultPrice);

  // 免费或已购买：直接发下载令牌
  if (price <= 0 || (await isOwned(c.env.DB, file.id, session.uid))) {
    return c.redirect(`/dl/free?file_id=${encodeURIComponent(file.id)}`);
  }

  const orderId = newOrderId();
  await createOrder(c.env.DB, {
    id: orderId,
    fileId: file.id,
    userUid: session.uid,
    amount: price,
  });

  const result = buildOrderParams(c.env, {
    outTradeNo: orderId,
    name: productName(cfg, file.name),
    money: price,
    notifyUrl: notifyUrl(c.env),
    returnUrl: returnUrl(c.env, orderId),
  });
  return c.html(buildSubmitFormHtml(result));
});

// ── 异步通知（EasyPay 平台 GET 回调）────────────────────
// notify 不强制登录；平台主动请求，可能无 cookie
payRoutes.get("/notify", async (c) => {
  const q = c.req.query();
  // 平台参数：pid, trade_no, out_trade_no, type, name, money,
  //           trade_status=TRADE_SUCCESS, sign_type, sign
  const expectedSign = q.sign || "";
  const tradeStatus = q.trade_status || "";
  const outTradeNo = q.out_trade_no || "";
  const tradeNo = q.trade_no || "";
  const money = q.money || "";

  // 基本校验
  if (!outTradeNo || !expectedSign) {
    return c.text("fail", 400);
  }

  // 验签（用回调原始参数，排除 sign/sign_type 后重算）
  if (!verifySign(q as Record<string, string | number | undefined>, c.env.CREDIT_KEY, expectedSign)) {
    console.warn("[pay/notify] 签名校验失败", { outTradeNo, tradeStatus });
    return c.text("fail", 400);
  }

  const order = await getOrder(c.env.DB, outTradeNo);
  if (!order) {
    console.warn("[pay/notify] 订单不存在", outTradeNo);
    return c.text("fail", 404);
  }

  // trade_status=TRADE_SUCCESS 且金额匹配才发货
  if (tradeStatus !== "TRADE_SUCCESS") {
    return c.text("success"); // 非 SUCCESS 不发货，但仍回 success 避免重试
  }

  // 金额校验：回调金额可能是 "1" 或 "1.00"，统一 parse 比较
  const paidAmount = Number.parseFloat(money);
  if (!Number.isFinite(paidAmount) || Math.trunc(paidAmount) !== order.amount) {
    console.warn("[pay/notify] 金额不匹配", { expect: order.amount, got: money });
    return c.text("fail", 400);
  }

  const { fulfilled } = await markPaid(c.env.DB, outTradeNo, tradeNo, order.amount);
  if (fulfilled) {
    console.log("[pay/notify] 订单支付完成", { outTradeNo, tradeNo });
  }
  // 不论是否本次发货，都回 success（幂等；防平台重试）
  return c.text("success");
});

// POST 也支持（部分网关用 POST 通知）
payRoutes.post("/notify", async (c) => {
  // 复用 GET 逻辑：把 form 参数当 query 处理
  const form = await c.req.parseBody();
  const merged: Record<string, string> = {};
  for (const [k, v] of Object.entries(form)) {
    if (typeof v === "string") merged[k] = v;
  }
  const q = merged;
  const expectedSign = q.sign || "";
  const tradeStatus = q.trade_status || "";
  const outTradeNo = q.out_trade_no || "";
  const tradeNo = q.trade_no || "";
  const money = q.money || "";

  if (!outTradeNo || !expectedSign) return c.text("fail", 400);
  if (!verifySign(q, c.env.CREDIT_KEY, expectedSign)) {
    console.warn("[pay/notify POST] 签名校验失败", { outTradeNo });
    return c.text("fail", 400);
  }
  const order = await getOrder(c.env.DB, outTradeNo);
  if (!order) return c.text("fail", 404);
  if (tradeStatus !== "TRADE_SUCCESS") return c.text("success");

  const paidAmount = Number.parseFloat(money);
  if (!Number.isFinite(paidAmount) || Math.trunc(paidAmount) !== order.amount) {
    return c.text("fail", 400);
  }
  await markPaid(c.env.DB, outTradeNo, tradeNo, order.amount);
  return c.text("success");
});

// ── 同步跳转（用户支付完浏览器返回）──────────────────────
// 展示等待页，轮询 /status 直到 paid/failed
payRoutes.get("/return", async (c) => {
  const cfg = c.get("config");
  const session = getSession(c);
  const orderId = c.req.query("order") || c.req.query("state");
  const errParam = c.req.query("error");

  if (errParam) {
    return c.html(
      renderResult({ config: cfg, session }, { ok: false, message: `支付未完成：${errParam}` }),
    );
  }
  if (!orderId) return c.redirect("/");

  const order = await getOrder(c.env.DB, orderId);
  if (!order) return c.redirect("/");

  // 若已 paid（异步通知先到），直接走结果页
  if (order.status === "paid") {
    return finalize(c, orderId);
  }
  // 否则展示等待页轮询
  return c.html(renderWaiting({ config: cfg, session }, orderId));
});

// ── 订单状态查询（等待页轮询/测试用）────────────────────
payRoutes.get("/status", async (c) => {
  const session = getSession(c);
  const id = c.req.query("id");
  const orderId = c.req.query("order") || id;
  if (!orderId) return c.json({ error: "missing id" }, 400);

  const order = await getOrder(c.env.DB, orderId);
  if (!order) return c.json({ error: "not found" }, 404);

  // 权限：登录订单校验 uid；分享订单允许（已由 share_id 关联）
  if (order.user_uid && (!session || order.user_uid !== session.uid)) {
    return c.json({ error: "not found" }, 404);
  }
  return c.json({ id: orderId, status: order.status, amount: order.amount });
});

// ── 结果页 ──────────────────────────────────────────────
// 登录用户 / 分享访客统一走结果页：展示文件信息 + 下载按钮，倒计时后开始下载。
payRoutes.get("/done", async (c) => {
  const cfg = c.get("config");
  const session = getSession(c);
  const id = c.req.query("id");
  const order = id ? await getOrder(c.env.DB, id) : null;
  if (!order) return c.redirect("/");

  const realOk = order.status === "paid";
  const file = await getFile(c.env.DB, order.file_id);

  // 未支付：展示失败结果页（游客也可见）
  if (!realOk) {
    return c.html(
      renderResult({ config: cfg, session }, {
        ok: false,
        orderId: id || undefined,
        message: "支付未完成或已取消。",
        fileName: file?.name,
      }),
    );
  }

  // ── 已支付：按订单类型发令牌，统一走结果页 + 倒计时下载 ──
  if (order.share_id) {
    // 分享访客订单：校验 share 有效 → 发匿名令牌 → 结果页
    const share = await getShare(c.env.DB, order.share_id);
    if (!share || !shareStatus(share).active) {
      return c.html(
        renderResult({ config: cfg, session }, { ok: false, orderId: id, message: "分享链接已失效" }),
      );
    }
    const token = await issueAnonymousDownloadToken(c.env.DB, order.file_id, order.share_id);
    return c.html(
      renderResult({ config: cfg, session }, {
        ok: true,
        orderId: id || undefined,
        message: "积分扣减成功，即将开始下载。",
        fileName: file?.name,
        downloadToken: token,
        backHref: `/s/${share.id}`,
      }),
    );
  }

  // 登录订单：需登录态 + 属主校验
  if (!session) return c.redirect("/");
  if (order.user_uid && order.user_uid !== session.uid) return c.redirect("/");

  const token = await issueDownloadToken(c.env.DB, order.file_id, session.uid);
  return c.html(
    renderResult({ config: cfg, session }, {
      ok: true,
      orderId: id || undefined,
      message: "积分扣减成功，即将开始下载。",
      fileName: file?.name,
      downloadToken: token,
      backHref: "/",
    }),
  );
});

/** /return 命中已 paid 时统一跳结果页（不再直接跳下载） */
async function finalize(c: Context, orderId: string): Promise<Response> {
  return c.redirect(`/pay/done?id=${encodeURIComponent(orderId)}`);
}

// ── 工具导出（供测试/分享页复用）────────────────────────
export { buildOrderParams, buildSubmitFormHtml, sign, formatMoney };
export type { CreateOrderInput } from "../payment/epay";

void (undefined as unknown as D1Database); // 保留 D1Database 类型引用（如有）
