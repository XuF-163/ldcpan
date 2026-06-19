/**
 * 文件相关路由：列表、详情、上传、改价/隐藏/删除（管理员）。
 */

import { Hono } from "hono";
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
  const file = await getFile(c.env.DB, c.req.param("id"));
  if (!file || (file.hidden && !(session?.isAdmin))) {
    return c.html(layout({ config: cfg, session }, "未找到", `<div class="panel center"><h2>文件不存在或已隐藏</h2><p><a class="btn" href="/">返回</a></p></div>`), 404);
  }

  const price = effectivePrice(file.price, cfg.defaultPrice);
  const owned = price <= 0 || (session ? await isOwned(c.env.DB, file.id, session.uid) : false);
  // 若曾购买（或免费），尝试补记 purchase（便于已购列表）
  if (owned && session && price > 0) {
    await recordPurchaseIfPaid(c.env.DB, file.id, session.uid, null);
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
fileRoutes.post("/upload", requireAdmin, async (c) => {
  const cfg = c.get("config");
  const session = getSession(c)!;

  const form = await c.req.formData();
  const upload = form.get("file") as unknown as File | string | null;
  if (!upload || typeof upload === "string") {
    return c.html(layout({ config: cfg, session }, "上传失败", `<div class="panel"><div class="notice err">未收到文件</div><p><a class="btn" href="/upload">返回</a></p></div>`), 400);
  }
  if (upload.size === 0) {
    return c.html(layout({ config: cfg, session }, "上传失败", `<div class="panel"><div class="notice err">文件为空</div><p><a class="btn" href="/upload">返回</a></p></div>`), 400);
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
      return c.html(layout({ config: cfg, session }, "上传失败", `<div class="panel"><div class="notice err">价格必须是非负整数</div><p><a class="btn" href="/upload">返回</a></p></div>`), 400);
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
    return c.html(layout({ config: cfg, session }, "上传失败", `<div class="panel"><div class="notice err">上传失败：${escapeHtml(msg)}</div><p><a class="btn" href="/upload">返回</a></p></div>`), 500);
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
  const file = await getFile(c.env.DB, id);
  if (file) {
    await deleteObject(c.env.BUCKET, file.key).catch(() => {});
    await deleteFile(c.env.DB, id);
  }
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
