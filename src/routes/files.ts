/**
 * 文件相关路由：列表、详情、上传、改价/隐藏/删除（管理员）。
 */

import { Hono } from "hono";
import type { Context } from "hono";
import type { Bindings } from "../env";
import { effectivePrice } from "../env";
import { requireAdmin, getSession } from "../auth/session";
import { makeObjectKey, putObject, deleteObject } from "../storage/r2";
import {
  getFile,
  listFiles,
  listCategories,
  updateFile,
  deleteFile,
  newFileId,
} from "../storage/files";
import type { FileRow } from "../storage/files";
import { isOwned, recordPurchaseIfPaid } from "../payment/orders";
import {
  createShare,
  listSharesByFile,
  listAllShares,
  revokeShare,
} from "../storage/shares";
import type { ShareRow } from "../storage/shares";
import { hashPassword } from "../lib/crypto";
import { renderList } from "../views/list";
import { renderDetail } from "../views/detail";
import { renderUpload } from "../views/upload";
import { renderSharesAdmin } from "../views/shares-admin";
import { layout } from "../lib/render";
import { escapeHtml } from "../lib/crypto";

export const fileRoutes = new Hono<{ Bindings: Bindings }>();

// ── 首页：文件列表 ────────────────────────────────────────
fileRoutes.get("/", async (c) => {
  const cfg = c.get("config");
  const session = getSession(c);
  const category = c.req.query("category") || undefined;
  const q = c.req.query("q") || undefined;

  const [files, categories] = await Promise.all([
    listFiles(c.env.DB, { category, q, includeHidden: session?.isAdmin }),
    listCategories(c.env.DB),
  ]);

  return c.html(renderList({ config: cfg, session }, files, categories, category, q));
});

// ── 详情 ─────────────────────────────────────────────────
fileRoutes.get("/f/:id", async (c) => {
  const cfg = c.get("config");
  const session = getSession(c);
  const ajax = wantsJson(c);
  const file = await getFile(c.env.DB, c.req.param("id"));
  if (!file || (file.hidden && !(session?.isAdmin))) {
    if (ajax) return c.json({ ok: false, error: "文件不存在或已隐藏" }, 404);
    return c.html(layout({ config: cfg, session }, "未找到", `<div class="panel center"><h2>文件不存在或已隐藏</h2><p><a class="btn" href="/">返回</a></p></div>`), 404);
  }

  const price = effectivePrice(file.price, cfg.defaultPrice);
  const owned = price <= 0 || (session ? await isOwned(c.env.DB, file.id, session.uid) : false);
  // 若曾购买（或免费），尝试补记 purchase（便于已购列表）
  if (owned && session && price > 0) {
    await recordPurchaseIfPaid(c.env.DB, file.id, session.uid, null);
  }

  // AJAX → 返回 JSON（供列表页弹窗渲染）
  if (ajax) {
    return c.json({
      ok: true,
      id: file.id,
      name: file.name,
      size: file.size,
      mime: file.mime,
      price,
      priceRaw: file.price,
      description: file.description,
      category: file.category,
      downloads: file.downloads,
      hidden: !!file.hidden,
      createdAt: file.created_at,
      owned,
      isAdmin: !!session?.isAdmin,
      isImage: (file.mime || "").startsWith("image/"),
    });
  }
  return c.html(renderDetail({ config: cfg, session }, file, { owned, price }));
});

// ── 上传表单（管理员）────────────────────────────────────
fileRoutes.get("/upload", requireAdmin, async (c) => {
  const cfg = c.get("config");
  const session = getSession(c)!;
  const categories = await listCategories(c.env.DB);
  return c.html(renderUpload({ config: cfg, session }, categories));
});

// ── 上传处理（管理员）────────────────────────────────────
// 支持两种响应：
//   - AJAX 请求（X-Requested-With: fetch 或 Accept: application/json）→ JSON
//   - 普通表单提交 → HTML/302（兼容 /upload 页面和测试）
function wantsJson(c: Context): boolean {
  const accept = c.req.header("accept") || "";
  const xrw = c.req.header("x-requested-with") || "";
  return accept.includes("application/json") || xrw.toLowerCase() === "fetch";
}

fileRoutes.post("/upload", requireAdmin, async (c) => {
  const cfg = c.get("config");
  const session = getSession(c)!;
  const ajax = wantsJson(c);

  // 统一错误响应：AJAX 返回 JSON，否则 HTML
  const fail = (msg: string, status = 400) => {
    if (ajax) return c.json({ ok: false, error: msg }, status as 400);
    return c.html(layout({ config: cfg, session }, "上传失败", `<div class="panel"><div class="notice err">${escapeHtml(msg)}</div><p><a class="btn" href="/upload">返回</a></p></div>`), status as 400);
  };

  const form = await c.req.formData();
  const upload = form.get("file") as unknown as File | string | null;
  if (!upload || typeof upload === "string") {
    return fail("未收到文件");
  }
  if (upload.size === 0) {
    return fail("文件为空");
  }

  const categoryVal = form.get("category");
  const category = categoryVal && categoryVal.trim() ? categoryVal.trim() : null;
  const descVal = form.get("description");
  const description = descVal && descVal.trim() ? descVal.trim() : null;
  const priceVal = form.get("price");
  const priceRaw = priceVal ? priceVal.trim() : "";
  let price: number | null = null;
  if (priceRaw !== "") {
    const n = parseInt(priceRaw, 10);
    if (!Number.isFinite(n) || n < 0) {
      return fail("价格必须是非负整数");
    }
    price = n;
  }

  const mime = upload.type || "application/octet-stream";
  const name = upload.name || "file";
  const id = newFileId();
  const key = makeObjectKey(id, name);

  try {
    await putObject(c.env.BUCKET, key, upload.stream(), mime, {
      originalName: name,
      uploadedBy: session.uid,
    });

    await c.env.DB.prepare(
      `INSERT INTO files (id, key, name, size, mime, price, description, category, downloads, uploaded_by, hidden, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0, datetime('now'))`,
    )
      .bind(id, key, name, upload.size, mime, price, description, category, session.uid)
      .run();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return fail(`上传失败：${msg}`, 500);
  }

  // 成功：AJAX 返回 JSON，否则 302 跳详情页
  if (ajax) {
    return c.json({ ok: true, id, url: `/f/${id}`, name });
  }
  return c.redirect(`/f/${id}`);
});

// ── 管理操作：改价 / 隐藏 / 删除（管理员）────────────────
fileRoutes.post("/f/:id/edit", requireAdmin, async (c) => {
  const id = c.req.param("id");
  const form = await c.req.formData();
  const patch: Partial<Pick<FileRow, "price" | "description" | "category" | "hidden">> = {};
  const priceVal = form.get("price");
  if (priceVal !== null) {
    const v = (priceVal as string).trim();
    if (v === "") patch.price = null;
    else {
      const n = parseInt(v, 10);
      if (!Number.isFinite(n) || n < 0) return c.text("价格必须是非负整数", 400);
      patch.price = n;
    }
  }
  const desc = form.get("description");
  if (desc !== null) patch.description = (desc as string).trim() || null;
  const cat = form.get("category");
  if (cat !== null) patch.category = (cat as string).trim() || null;
  const hidden = form.get("hidden");
  if (hidden !== null) patch.hidden = hidden === "1" ? 1 : 0;

  await updateFile(c.env.DB, id, patch);
  return c.redirect(`/f/${id}`);
});

fileRoutes.post("/f/:id/delete", requireAdmin, async (c) => {
  const id = c.req.param("id");
  const ajax = wantsJson(c);
  const file = await getFile(c.env.DB, id);
  if (!file) {
    if (ajax) return c.json({ ok: false, error: "文件不存在" }, 404);
    return c.redirect("/");
  }
  await deleteObject(c.env.BUCKET, file.key).catch(() => {});
  await deleteFile(c.env.DB, id);
  if (ajax) return c.json({ ok: true, id, name: file.name });
  return c.redirect("/");
});

// ── 分享管理（管理员）─────────────────────────────────────

// 列出/创建分享
fileRoutes.get("/admin/shares", requireAdmin, async (c) => {
  const cfg = c.get("config");
  const session = getSession(c)!;
  const focusFileId = c.req.query("file_id") || undefined;

  // 若聚焦某文件，列该文件；否则列全部
  const shares: ShareRow[] = focusFileId
    ? await listSharesByFile(c.env.DB, focusFileId)
    : await listAllShares(c.env.DB);

  // 预取相关文件元数据
  const fileIds = [...new Set(shares.map((s) => s.file_id))];
  const filesMap = new Map<string, FileRow>();
  for (const fid of fileIds) {
    const f = await getFile(c.env.DB, fid);
    if (f) filesMap.set(fid, f);
  }

  return c.html(renderSharesAdmin({ config: cfg, session }, shares, filesMap, focusFileId));
});

// 创建分享
fileRoutes.post("/admin/shares", requireAdmin, async (c) => {
  const session = getSession(c)!;
  const form = await c.req.formData();
  const fileId = (form.get("file_id") as string | null)?.trim();
  if (!fileId) return c.redirect("/admin/shares");

  const file = await getFile(c.env.DB, fileId);
  if (!file) {
    return c.text("文件不存在", 404);
  }

  // 密码（可选）
  const pwRaw = form.get("password");
  const password = typeof pwRaw === "string" && pwRaw.trim() ? pwRaw : null;
  let passwordHash: string | null = null;
  let passwordSalt: string | null = null;
  if (password) {
    const h = await hashPassword(password);
    passwordHash = h.hash;
    passwordSalt = h.salt;
  }

  // 有效期（可选）
  const expiresRaw = form.get("expires");
  let expiresAt: string | null = null;
  if (typeof expiresRaw === "string" && expiresRaw) {
    const days = { "1d": 1, "7d": 7, "30d": 30, "90d": 90 }[expiresRaw];
    if (days) {
      expiresAt = new Date(Date.now() + days * 24 * 3600 * 1000).toISOString();
    }
  }

  // 次数（可选）
  const claimsRaw = form.get("max_claims");
  let maxClaims: number | null = null;
  if (typeof claimsRaw === "string" && claimsRaw.trim()) {
    const n = parseInt(claimsRaw, 10);
    if (Number.isFinite(n) && n > 0) maxClaims = n;
  }

  const share = await createShare(c.env.DB, {
    fileId: file.id,
    createdBy: session.uid,
    passwordHash,
    passwordSalt,
    expiresAt,
    maxClaims,
  });

  return c.redirect(`/s/${share.id}`);
});

// 吊销分享
fileRoutes.post("/admin/shares/:id/revoke", requireAdmin, async (c) => {
  const id = c.req.param("id");
  await revokeShare(c.env.DB, id);
  return c.redirect("/admin/shares");
});

// ── 管理员统计：GET /admin/stats（JSON）─────────────────────
// 收益（积分）/ 存储占用 / 文件·用户·分享·下载 计数，供头像下拉菜单展示。
fileRoutes.get("/admin/stats", requireAdmin, async (c) => {
  const db = c.env.DB;

  // 收益：已支付订单积分总和 + 订单数
  const rev = await db
    .prepare(`SELECT COALESCE(SUM(amount),0) AS total, COUNT(*) AS cnt FROM orders WHERE status='paid'`)
    .first<{ total: number; cnt: number }>();
  // 近 7 天收益
  const since7 = new Date(Date.now() - 7 * 86400000).toISOString();
  const rev7 = await db
    .prepare(`SELECT COALESCE(SUM(amount),0) AS total, COUNT(*) AS cnt FROM orders WHERE status='paid' AND paid_at >= ?`)
    .bind(since7)
    .first<{ total: number; cnt: number }>();
  // 待处理/失败订单数
  const pend = await db
    .prepare(`SELECT COUNT(*) AS cnt FROM orders WHERE status='pending'`)
    .first<{ cnt: number }>();

  // 存储：文件总大小 + 数量
  const stor = await db
    .prepare(`SELECT COALESCE(SUM(size),0) AS total, COUNT(*) AS cnt, COALESCE(SUM(downloads),0) AS dl FROM files`)
    .first<{ total: number; cnt: number; dl: number }>();

  // 用户 / 分享 / 购买计数
  const users = await db.prepare(`SELECT COUNT(*) AS cnt FROM users`).first<{ cnt: number }>();
  const shares = await db.prepare(`SELECT COUNT(*) AS cnt FROM shares WHERE revoked_at IS NULL`).first<{ cnt: number }>();
  const purchases = await db.prepare(`SELECT COUNT(*) AS cnt FROM purchases`).first<{ cnt: number }>();

  return c.json({
    revenue: {
      total: rev?.total ?? 0,
      orders: rev?.cnt ?? 0,
      last7d: { total: rev7?.total ?? 0, orders: rev7?.cnt ?? 0 },
      pending: pend?.cnt ?? 0,
    },
    storage: {
      bytes: stor?.total ?? 0,
      files: stor?.cnt ?? 0,
      downloads: stor?.dl ?? 0,
    },
    users: users?.cnt ?? 0,
    shares: shares?.cnt ?? 0,
    purchases: purchases?.cnt ?? 0,
  });
});
