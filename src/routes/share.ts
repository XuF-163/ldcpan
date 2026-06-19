/**
 * /s/* 公开分享链路：提取页、下载（免费）、支付（付费）。
 * 全部无需登录，纯按 share 记录鉴权。
 */

import { Hono } from "hono";
import type { Bindings } from "../env";
import { effectivePrice } from "../env";
import { getFile } from "../storage/files";
import {
  getShare,
  shareStatus,
  hasPassword,
  incClaim,
} from "../storage/shares";
import { verifyPassword } from "../lib/crypto";
import { issueAnonymousDownloadToken, createOrder, newOrderId } from "../payment/orders";
import { buildOrderParams, buildSubmitFormHtml } from "../payment/epay";
import { renderShare } from "../views/share";
import { layout } from "../lib/render";
import { escapeHtml } from "../lib/crypto";

export const shareRoutes = new Hono<{ Bindings: Bindings }>();

const REASON_TEXT: Record<string, string> = {
  revoked: "该分享已被创建者吊销。",
  expired: "该分享已过期。",
  exhausted: "该分享的可用次数已用尽。",
};

// ── GET /s/:id 提取页 ─────────────────────────────────────
shareRoutes.get("/:id", async (c) => {
  const cfg = c.get("config");
  const session = c.get("session"); // 公开链路不强求，仅用于隐藏导航
  const share = await getShare(c.env.DB, c.req.param("id"));
  if (!share) {
    return c.html(
      layout({ config: cfg, session }, "分享不存在", `<div class="panel center"><h2>分享链接无效</h2><p>该链接不存在或已被删除。</p></div>`, { current: "" }),
      404,
    );
  }

  const status = shareStatus(share);
  if (!status.active) {
    return c.html(
      layout({ config: cfg, session }, "分享失效", `<div class="panel center"><h2>分享已失效</h2><p>${escapeHtml(REASON_TEXT[status.reason || ""] || "")}</p></div>`, { current: "" }),
      410,
    );
  }

  const file = await getFile(c.env.DB, share.file_id);
  if (!file) {
    return c.html(
      layout({ config: cfg, session }, "文件缺失", `<div class="panel center"><h2>文件不存在</h2><p>分享对应的文件已被删除。</p></div>`, { current: "" }),
      404,
    );
  }

  const price = effectivePrice(file.price, cfg.defaultPrice);
  const needPassword = hasPassword(share);
  // 是否已通过密码（本次会话内）：用 query ?authed=1 标记（POST 通过后跳转携带）
  const authed = c.req.query("authed") === "1";
  const showPasswordForm = needPassword && !authed;

  return c.html(renderShare({ config: cfg, session }, share, file, { price, needPassword, showPasswordForm }));
});

// ── POST /s/:id 提交密码 ──────────────────────────────────
shareRoutes.post("/:id", async (c) => {
  const cfg = c.get("config");
  const session = c.get("session");
  const share = await getShare(c.env.DB, c.req.param("id"));
  if (!share) return c.redirect("/s/" + c.req.param("id"));

  const status = shareStatus(share);
  if (!status.active) return c.redirect("/s/" + share.id);

  if (!hasPassword(share)) {
    return c.redirect(`/s/${share.id}?authed=1`);
  }

  const form = await c.req.formData();
  const pw = form.get("password");
  const password = typeof pw === "string" ? pw : "";
  const ok = await verifyPassword(password, share.password_salt!, share.password_hash!);
  if (!ok) {
    return c.html(
      renderShare({ config: cfg, session }, share, (await getFile(c.env.DB, share.file_id))!, {
        price: effectivePrice((await getFile(c.env.DB, share.file_id))!.price, cfg.defaultPrice),
        needPassword: true,
        showPasswordForm: true,
        error: "密码错误",
      }),
    );
  }
  // 密码通过 → 计一次 claim → 放行
  await incClaim(c.env.DB, share.id);
  return c.redirect(`/s/${share.id}?authed=1`);
});

// ── GET /s/:id/dl 免费文件直接下载 ────────────────────────
shareRoutes.get("/:id/dl", async (c) => {
  const cfg = c.get("config");
  const share = await getShare(c.env.DB, c.req.param("id"));
  if (!share) return c.text("分享不存在", 404);

  const status = shareStatus(share);
  if (!status.active) return c.text(REASON_TEXT[status.reason || ""] || "分享失效", 410);

  const file = await getFile(c.env.DB, share.file_id);
  if (!file) return c.text("文件不存在", 404);

  const price = effectivePrice(file.price, cfg.defaultPrice);
  if (price > 0) {
    // 付费文件应走 /s/:id/pay
    return c.redirect(`/s/${share.id}/pay`);
  }

  // 免费文件：无密码直接计 claim；有密码但未授权则回提取页
  if (hasPassword(share) && c.req.query("authed") !== "1") {
    return c.redirect(`/s/${share.id}`);
  }
  if (!hasPassword(share)) {
    await incClaim(c.env.DB, share.id);
  }

  const token = await issueAnonymousDownloadToken(c.env.DB, file.id, share.id);
  return c.redirect(`/dl/${token}`);
});

// ── GET /s/:id/pay 付费文件支付（匿名订单）────────────────
shareRoutes.get("/:id/pay", async (c) => {
  const cfg = c.get("config");
  const share = await getShare(c.env.DB, c.req.param("id"));
  if (!share) return c.text("分享不存在", 404);

  const status = shareStatus(share);
  if (!status.active) return c.text(REASON_TEXT[status.reason || ""] || "分享失效", 410);

  const file = await getFile(c.env.DB, share.file_id);
  if (!file) return c.text("文件不存在", 404);

  const price = effectivePrice(file.price, cfg.defaultPrice);
  if (price <= 0) {
    return c.redirect(`/s/${share.id}/dl`);
  }

  // 有密码但未授权 → 回提取页
  if (hasPassword(share) && c.req.query("authed") !== "1") {
    return c.redirect(`/s/${share.id}`);
  }

  // 建匿名订单（user_uid=NULL, share_id=share.id）
  const orderId = newOrderId();
  await createOrder(c.env.DB, {
    id: orderId,
    fileId: file.id,
    userUid: null,
    amount: price,
    shareId: share.id,
  });

  // EasyPay 下单：构造提交参数 → 返回自动 POST 表单跳转 credit
  const notifyUrl = (c.env as unknown as { CREDIT_NOTIFY_URL?: string }).CREDIT_NOTIFY_URL || "";
  const retBase = (c.env as unknown as { CREDIT_RETURN_URL?: string }).CREDIT_RETURN_URL;
  const ret = retBase
    ? `${retBase}${retBase.includes("?") ? "&" : "?"}order=${encodeURIComponent(orderId)}`
    : `${cfg.siteBaseUrl}/pay/return?order=${encodeURIComponent(orderId)}`;

  const result = buildOrderParams(c.env, {
    outTradeNo: orderId,
    name: `${cfg.siteName} · ${file.name}`.slice(0, 64),
    money: price,
    notifyUrl,
    returnUrl: ret,
  });
  return c.html(buildSubmitFormHtml(result));
});
