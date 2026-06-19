/**
 * 管理员上传视图。
 */
import type { RenderCtx } from "../lib/render";
import { layout } from "../lib/render";

export function renderUpload(rctx: RenderCtx, categories: string[]): string {
  const catOpts = categories
    .map((c) => `<option value="${c}">${c}</option>`)
    .join("");

  const body = `
    <div class="panel">
      <h2 style="margin-top:0">上传文件</h2>
      <form method="post" action="/upload" enctype="multipart/form-data">
        <label>选择文件</label>
        <input class="input" type="file" name="file" required>

        <label>分类（可选）</label>
        <input class="input" name="category" list="catlist" placeholder="如：电子书、软件、教程">
        <datalist id="catlist">${catOpts}</datalist>

        <label>描述（可选）</label>
        <textarea class="input" name="description" rows="3" placeholder="文件说明"></textarea>

        <label>定价（积分）</label>
        <input class="input" type="number" name="price" min="0" step="1" placeholder="留空=默认价，0=免费">
        <div class="muted" style="font-size:12px;margin-top:4px">留空使用站点默认价；填 0 为免费下载；填正数为该文件单价。</div>

        <div style="margin-top:16px">
          <button class="btn btn-primary" type="submit">上传</button>
        </div>
      </form>
    </div>`;

  return layout(rctx, "上传", body, { current: "/upload" });
}
