/**
 * 分享提取页视图：展示文件 + 密码框（若有）+ 下载/付费按钮。
 */
import type { ShareRow } from "../storage/shares";
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

export interface ShareViewOpts {
  price: number;
  needPassword: boolean;
  showPasswordForm: boolean;
  error?: string;
}

export function renderShare(
  rctx: RenderCtx,
  share: ShareRow,
  file: FileRow,
  opts: ShareViewOpts,
): string {
  const { config } = rctx;
  void config;

  const priceLabel =
    opts.price <= 0
      ? `<span class="free">免费</span>`
      : `<span class="price">${opts.price} 积分</span>`;

  let body = "";

  if (opts.error) {
    body += `<div class="notice err">${escapeHtml(opts.error)}</div>`;
  }

  if (opts.showPasswordForm) {
    body += `
      <form method="post" action="/s/${escapeHtml(share.id)}">
        <label>请输入提取密码</label>
        <div class="row">
          <input class="input" name="password" type="password" placeholder="提取密码" required autofocus style="flex:1">
          <button class="btn btn-primary" type="submit">验证</button>
        </div>
      </form>`;
  } else {
    const action =
      opts.price <= 0
        ? `<a class="btn btn-primary" href="/s/${escapeHtml(share.id)}/dl${opts.needPassword ? "?authed=1" : ""}">⬇ 下载文件</a>`
        : `<a class="btn btn-primary" href="/s/${escapeHtml(share.id)}/pay${opts.needPassword ? "?authed=1" : ""}">支付 ${opts.price} 积分下载</a>`;
    body += `<div class="row" style="justify-content:center">${action}</div>`;
  }

  const full = `
    <div class="panel" style="max-width:520px;margin:24px auto">
      <div class="center" style="margin-bottom:16px">
        <div style="font-size:48px">📎</div>
        <h2 style="margin:8px 0 4px">${escapeHtml(file.name)}</h2>
        <div class="muted">${humanSize(file.size)} · ${escapeHtml(file.mime || "文件")}</div>
      </div>
      ${file.description ? `<p class="muted center">${escapeHtml(file.description)}</p>` : ""}
      <div class="center" style="margin:12px 0">${priceLabel}</div>
      ${body}
      ${
        share.expires_at
          ? `<div class="muted center" style="font-size:12px;margin-top:16px">有效期至 ${escapeHtml(new Date(share.expires_at).toLocaleString("zh-CN"))}</div>`
          : ""
      }
    </div>`;

  return layout(rctx, `分享 · ${file.name}`, full, { current: "" });
}
