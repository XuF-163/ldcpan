/**
 * 文件详情视图：信息 + 下载/购买按钮。
 */
import type { FileRow } from "../storage/files";
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

export interface DetailExtra {
  owned: boolean; // 用户已购买（或免费）
  price: number;  // 有效价
}

export function renderDetail(
  rctx: RenderCtx,
  file: FileRow,
  extra: DetailExtra,
): string {
  const { config, session } = rctx;
  void config;
  const price = extra.price;

  const actionArea = (() => {
    if (!session) {
      return `<a class="btn btn-primary" href="/auth/login?next=${encodeURIComponent(`/f/${file.id}`)}">登录后下载</a>`;
    }
    if (price <= 0 || extra.owned) {
      return `<a class="btn btn-primary" href="/pay/create?file_id=${escapeHtml(file.id)}">⬇ 下载</a>`;
    }
    return `<a class="btn btn-primary" href="/pay/create?file_id=${escapeHtml(file.id)}">支付 ${price} 积分下载</a>`;
  })();

  const priceLabel =
    price <= 0
      ? `<span class="free">免费</span>`
      : `<span class="price">${price} 积分</span>`;

  const shareBtn = session?.isAdmin
    ? `<a class="btn" href="/admin/shares?file_id=${escapeHtml(file.id)}">🔗 生成分享链接</a>`
    : "";

  const ownedNote = extra.owned && price > 0
    ? `<div class="notice ok">你已购买此文件，可重复下载。</div>`
    : "";

  const body = `
    <div class="panel">
      <div class="row" style="margin-bottom:8px">
        <h2 style="margin:0">${escapeHtml(file.name)}</h2>
      </div>
      ${file.description ? `<p class="muted">${escapeHtml(file.description)}</p>` : ""}
      <div class="grid grid-2" style="margin:16px 0">
        <div><label>分类</label><div>${escapeHtml(file.category || "—")}</div></div>
        <div><label>大小</label><div>${humanSize(file.size)}</div></div>
        <div><label>价格</label><div>${priceLabel}</div></div>
        <div><label>下载次数</label><div>${escapeHtml(String(file.downloads))}</div></div>
        <div><label>类型</label><div class="muted">${escapeHtml(file.mime)}</div></div>
        <div><label>上传时间</label><div class="muted">${escapeHtml(new Date(file.created_at).toLocaleString("zh-CN"))}</div></div>
      </div>
      ${ownedNote}
      <div class="row">${actionArea} ${shareBtn}</div>
    </div>`;

  return layout(rctx, file.name, body, { current: "" });
}
