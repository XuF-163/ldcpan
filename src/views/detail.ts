/**
 * 文件详情视图：信息 + 下载/购买按钮。
 */
import type { FileRow } from "../storage/files";
import { escapeHtml } from "../lib/crypto";
import { humanSize } from "../lib/format";
import type { RenderCtx } from "../lib/render";
import { layout } from "../lib/render";

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
    ? `<a class="btn" href="/admin/shares?file_id=${escapeHtml(file.id)}" target="_blank" rel="noopener">🔗 生成分享链接</a>`
    : "";

  // 管理员管理区：编辑/分享/删除（保持与列表页右键菜单一致的能力）
  const isAdmin = !!session?.isAdmin;
  const adminArea = isAdmin
    ? `
    <div class="panel" style="margin-top:16px">
      <div class="row between" style="margin-bottom:6px">
        <h2 style="margin:0;font-size:15px">🛠️ 管理操作</h2>
        <span class="muted" style="font-size:12px">列表页右键文件可快速操作</span>
      </div>
      <div class="row" style="margin-top:6px">
        <button class="btn" type="button" onclick="window.__detailEdit()">✏️ 编辑信息</button>
        <a class="btn" href="/admin/shares?file_id=${escapeHtml(file.id)}" target="_blank" rel="noopener">🔗 分享</a>
        <button class="btn btn-danger" type="button" onclick="window.__detailDel()">🗑️ 删除</button>
        ${file.hidden ? '<span class="tag">当前对普通用户隐藏</span>' : ""}
      </div>
    </div>
    <script>${detailAdminJs(file)}</script>`
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
    </div>
    ${adminArea}`;

  return layout(rctx, file.name, body, { current: "" });
}

/** 详情页管理员弹窗逻辑（编辑/删除，复用列表页的弹窗样式） */
function detailAdminJs(file: FileRow): string {
  const ctx = JSON.stringify({
    id: file.id,
    name: file.name,
    price: file.price,
    category: file.category,
    description: file.description,
    hidden: file.hidden,
  });
  return `
(function(){
  var ctx = ${ctx};
  // openModal / escAttr / showToast 已在 shared.js 定义（全局，页面 head 先加载）
  window.__detailEdit=function(){
    var body='<form id="editForm" method="post" action="/f/'+encodeURIComponent(ctx.id)+'/edit">'+
      '<label>价格（留空=默认价，0=免费）</label>'+
      '<input class="input" name="price" value="'+(ctx.price==null?'':ctx.price)+'" placeholder="积分">'+
      '<label>分类</label>'+
      '<input class="input" name="category" value="'+escAttr(ctx.category)+'" placeholder="如：电子书">'+
      '<label>描述</label>'+
      '<textarea class="input" name="description" rows="3" placeholder="可选">'+escAttr(ctx.description)+'</textarea>'+
      '<label class="row" style="align-items:center;gap:8px;margin-top:14px;cursor:pointer">'+
        '<input type="checkbox" name="hidden" value="1" '+(ctx.hidden?'checked':'')+' style="width:auto">'+
        '<span style="margin:0">对普通用户隐藏此文件</span>'+
      '</label></form>';
    var foot='<button class="btn" type="button">取消</button><button class="btn btn-primary" type="button" data-submit>保存</button>';
    var m=openModal('编辑：'+ctx.name,body,foot);
    m.querySelectorAll('.modal-foot .btn').forEach(function(b){
      if(b.hasAttribute('data-submit')) b.onclick=function(){document.getElementById('editForm').submit();};
      else b.onclick=function(){m.remove();};
    });
  };
  window.__detailDel=function(){
    var body='<div class="notice err">⚠️ 确认删除文件「'+ctx.name+'」？</div><p class="muted">删除后文件和 R2 存储将一并移除，无法恢复。</p>';
    var foot='<button class="btn" type="button">取消</button><button class="btn btn-danger" type="button" data-confirm>确认删除</button>';
    var m=openModal('删除文件',body,foot);
    var cancelBtn=m.querySelector('.modal-foot .btn:not([data-confirm])'); if(cancelBtn) cancelBtn.onclick=function(){m.remove();};
    var confirmBtn=m.querySelector('[data-confirm]');
    if(confirmBtn) confirmBtn.onclick=function(){
      confirmBtn.disabled=true; confirmBtn.textContent='删除中…';
      fetch('/f/'+encodeURIComponent(ctx.id)+'/delete',{method:'POST',headers:{'Accept':'application/json','X-Requested-With':'fetch'}})
      .then(function(r){return r.json().then(function(j){return {status:r.status,json:j};}).catch(function(){return {status:r.status,json:{ok:false,error:'HTTP '+r.status}};});})
      .then(function(res){
        if(res.json && res.json.ok){
          m.remove();
          // 详情页内容整体淡出后跳回列表
          var main=document.querySelector('.content');
          if(main){ main.style.transition='opacity .4s ease'; main.style.opacity='0'; }
          setTimeout(function(){ location.href='/'; }, 420);
        } else {
          confirmBtn.disabled=false; confirmBtn.textContent='确认删除';
          if(window.showToast) window.showToast('删除失败：'+((res.json&&res.json.error)||''),'err');
        }
      }).catch(function(e){
        confirmBtn.disabled=false; confirmBtn.textContent='确认删除';
        if(window.showToast) window.showToast('删除出错','err');
      });
    };
  };
})();
`;
}
