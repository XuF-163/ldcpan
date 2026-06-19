/**
 * /dl 路由：文件下载。
 *  - /dl/free?file_id= : 免费/已购文件，登录后签发令牌再跳转
 *  - /dl/:token        : 消费令牌，流式吐 R2 对象（支持 Range）
 */

import { Hono } from "hono";
import type { Bindings } from "../env";
import { effectivePrice } from "../env";
import { requireAuth, getSession } from "../auth/session";
import { getFile, incrementDownloads } from "../storage/files";
import { rangedGet } from "../storage/r2";
import { isOwned, issueDownloadToken, consumeDownloadToken } from "../payment/orders";
import { getShare, shareStatus, incDownload } from "../storage/shares";

export const downloadRoutes = new Hono<{ Bindings: Bindings }>();

/** 免费或已购买：签发令牌并重定向到 /dl/:token */
downloadRoutes.get("/dl/free", requireAuth, async (c) => {
  const cfg = c.get("config");
  const session = getSession(c)!;
  const fileId = c.req.query("file_id");
  if (!fileId) return c.text("缺少 file_id", 400);

  const file = await getFile(c.env.DB, fileId);
  if (!file || (file.hidden && !session.isAdmin)) {
    return c.text("文件不存在", 404);
  }

  const price = effectivePrice(file.price, cfg.defaultPrice);
  if (price > 0 && !(await isOwned(c.env.DB, file.id, session.uid))) {
    return c.redirect(`/f/${file.id}`);
  }

  const token = await issueDownloadToken(c.env.DB, file.id, session.uid);
  return c.redirect(`/dl/${token}`);
});

/** 消费令牌下载（支持 Range，流式）*/
downloadRoutes.get("/dl/:token", async (c) => {
  const token = c.req.param("token");
  const consumed = await consumeDownloadToken(c.env.DB, token);
  if (!consumed) {
    return c.text("下载链接无效或已过期", 410);
  }

  // 分享令牌：回查 share 是否仍有效（防止吊销/过期/耗尽后旧令牌仍可用）
  if (consumed.shareId) {
    const share = await getShare(c.env.DB, consumed.shareId);
    if (!share || !shareStatus(share).active) {
      return c.text("分享链接已失效（可能已吊销/过期/用尽）", 410);
    }
    // 异步累加分享下载量
    c.executionCtx.waitUntil(incDownload(c.env.DB, consumed.shareId));
  }

  const file = await getFile(c.env.DB, consumed.fileId);
  if (!file) {
    return c.text("文件不存在", 404);
  }

  const rangeHeader = c.req.header("range") || null;
  const obj = await rangedGet(c.env.BUCKET, file.key, rangeHeader, file.name, file.mime);
  if (!obj) {
    return c.text("底层对象缺失", 404);
  }

  // 异步计数（不阻塞响应）
  c.executionCtx.waitUntil(incrementDownloads(c.env.DB, file.id));

  return new Response(obj.body, { status: obj.status, headers: obj.headers });
});
