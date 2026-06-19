/**
 * 管理员分享管理视图：创建表单 + 列表 + 吊销。
 */
import type { ShareRow } from "../storage/shares";
import type { FileRow } from "../storage/files";
import { shareStatus } from "../storage/shares";
import type { RenderCtx } from "../lib/render";
import { layout } from "../lib/render";
import { escapeHtml } from "../lib/crypto";

export function renderSharesAdmin(
  rctx: RenderCtx,
  shares: ShareRow[],
  files: Map<string, FileRow>,
  focusFileId: string | undefined,
): string {
  const rows = shares.length
    ? shares
        .map((s) => {
          const f = files.get(s.file_id);
          const st = shareStatus(s);
          const statusBadge = st.active
            ? '<span class="free">有效</span>'
            : `<span class="muted">${escapeHtml(st.reason || "失效")}</span>`;
          const expiry = s.expires_at
            ? escapeHtml(new Date(s.expires_at).toLocaleDateString("zh-CN"))
            : '<span class="muted">永久</span>';
          const claims = s.max_claims == null
            ? `${s.claims} / ∞`
            : `${s.claims} / ${s.max_claims}`;
          const pw = s.password_hash
            ? '<span class="tag">🔒 密码</span>'
            : '<span class="muted">无</span>';
          const link = `${rctx.config.siteBaseUrl}/s/${escapeHtml(s.id)}`;
          const revokeForm = st.active
            ? `<form method="post" action="/admin/shares/${escapeHtml(s.id)}/revoke" style="display:inline" onsubmit="return confirm('确定吊销该分享？')"><button class="btn btn-sm" type="submit">吊销</button></form>`
            : '<span class="muted">已结束</span>';
          return `
          <tr>
            <td><a href="/s/${escapeHtml(s.id)}" target="_blank">${escapeHtml(s.id)}</a><br><span class="muted" style="font-size:11px">${escapeHtml(link)}</span></td>
            <td>${escapeHtml(f?.name || s.file_id)}</td>
            <td>${pw}</td>
            <td class="muted">${expiry}</td>
            <td class="muted">${escapeHtml(claims)}</td>
            <td class="muted">${escapeHtml(String(s.downloads))}</td>
            <td>${statusBadge}</td>
            <td>${revokeForm}</td>
          </tr>`;
        })
        .join("")
    : `<tr><td colspan="8" class="center muted" style="padding:40px">暂无分享链接</td></tr>`;

  const focusPrefill = focusFileId
    ? `<div class="notice ok">已选中文件，填写选项后生成分享链接。</div>`
    : "";

  const body = `
    <div class="panel">
      <h2 style="margin-top:0">生成分享链接</h2>
      ${focusPrefill}
      <form method="post" action="/admin/shares">
        <label>文件 ID</label>
        <input class="input" name="file_id" value="${escapeHtml(focusFileId || "")}" placeholder="文件 id（如 abc123）" required>

        <label>提取密码（可选，留空则无密码）</label>
        <input class="input" name="password" placeholder="无密码则任何人凭链接可访问">

        <label>有效期（可选，留空=永久）</label>
        <select class="input" name="expires">
          <option value="">永久</option>
          <option value="1d">1 天</option>
          <option value="7d">7 天</option>
          <option value="30d">30 天</option>
          <option value="90d">90 天</option>
        </select>

        <label>可用次数（可选，留空=不限；指"授权人数"而非下载次数）</label>
        <input class="input" type="number" name="max_claims" min="1" placeholder="留空=不限">

        <div style="margin-top:16px">
          <button class="btn btn-primary" type="submit">生成分享链接</button>
          <a class="btn" href="/">取消</a>
        </div>
      </form>
    </div>

    <div class="panel">
      <h2 style="margin-top:0">分享链接列表</h2>
      <table class="files">
        <thead><tr><th>链接 ID</th><th>文件</th><th>密码</th><th>有效期</th><th>次数</th><th>下载量</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;

  return layout(rctx, "分享管理", body, { current: "" });
}
