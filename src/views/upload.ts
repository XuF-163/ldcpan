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

        <label>分类</label>
        <input class="input" name="category" list="catlist" placeholder="可选">
        <datalist id="catlist">${catOpts}</datalist>

        <label>描述</label>
        <textarea class="input" name="description" rows="2" placeholder="可选"></textarea>

        <label>价格（积分，0=免费）</label>
        <input class="input" type="number" name="price" min="0" step="1" value="0">

        <div style="margin-top:16px">
          <button class="btn btn-primary" type="submit">上传</button>
        </div>
      </form>
    </div>`;

  return layout(rctx, "上传", body, { current: "/upload" });
}
