/**
 * 文件列表视图。
 */
import type { FileRow } from "../storage/files";
import { effectivePrice } from "../env";
import type { AppConfig } from "../env";
import { escapeHtml } from "../lib/crypto";
import type { RenderCtx } from "../lib/render";
import { layout } from "../lib/render";

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

function priceTag(file: FileRow, config: AppConfig): string {
  const price = effectivePrice(file.price, config.defaultPrice);
  if (price <= 0) return `<span class="free">免费</span>`;
  return `<span class="price">${price} 积分</span>`;
}

export function renderList(
  rctx: RenderCtx,
  files: FileRow[],
  categories: string[],
  currentCat: string | undefined,
  q: string | undefined,
): string {
  const { config } = rctx;
  void currentCat;

  const catChips = categories
    .map(
      (c) =>
        `<a class="tag" href="/?category=${encodeURIComponent(c)}">${escapeHtml(c)}</a>`,
    )
    .join(" ");

  const rows = files.length
    ? files
        .map(
          (f) => `
        <tr>
          <td><a href="/f/${escapeHtml(f.id)}">${escapeHtml(f.name)}</a></td>
          <td class="muted">${escapeHtml(f.category || "—")}</td>
          <td class="muted">${humanSize(f.size)}</td>
          <td>${priceTag(f, config)}</td>
          <td class="muted">${escapeHtml(f.downloads)}</td>
          <td class="muted">${new Date(f.created_at).toLocaleDateString("zh-CN")}</td>
        </tr>`,
        )
        .join("")
    : `<tr><td colspan="6" class="center muted" style="padding:40px">暂无文件${
        rctx.session?.isAdmin ? '，去 <a href="/upload">上传</a> 第一个吧' : ""
      }</td></tr>`;

  const body = `
    <div class="panel">
      <div class="row" style="margin-bottom:12px">
        <h2 style="margin:0">文件列表</h2>
        <div class="spacer"></div>
        <form method="get" action="/" class="row" style="gap:4px">
          <input class="input" name="q" placeholder="搜索文件名/描述" value="${escapeHtml(q || "")}" style="width:220px">
          <button class="btn btn-sm" type="submit">搜索</button>
        </form>
      </div>
      ${categories.length ? `<div class="row" style="margin-bottom:8px"><a class="tag" href="/">全部</a> ${catChips}</div>` : ""}
      <table class="files">
        <thead><tr><th>文件名</th><th>分类</th><th>大小</th><th>价格</th><th>下载</th><th>上传时间</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;

  return layout(rctx, "", body, { current: "/" });
}
