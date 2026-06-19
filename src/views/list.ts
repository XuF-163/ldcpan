/**
 * 文件列表视图：列表/网格双视图，管理员右键菜单 + 编辑/分享/删除弹窗。
 * 普通用户：右键/长按只有「详情/下载」；管理员：额外有「编辑/分享/删除」。
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

/** 根据扩展名/类型给出图标 emoji + 颜色类 */
function fileIcon(file: FileRow): { emoji: string; cls: string } {
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  const m = file.mime || "";
  if (/(zip|rar|7z|tar|gz|bz2)$/.test(ext) || m.includes("compressed"))
    return { emoji: "🗜️", cls: "zip" };
  if (/(mp4|avi|mov|mkv|flv|webm|wmv)$/.test(ext) || m.startsWith("video/"))
    return { emoji: "🎬", cls: "vid" };
  if (/(mp3|wav|flac|aac|ogg|m4a)$/.test(ext) || m.startsWith("audio/"))
    return { emoji: "🎵", cls: "audio" };
  if (/(pdf|docx?|xlsx?|pptx?|txt|md|epub)$/.test(ext) || m.includes("document") || m.includes("pdf") || m.startsWith("text/"))
    return { emoji: "📄", cls: "doc" };
  if (/(js|ts|py|java|go|rs|c|cpp|html|css|json|xml|sh|sql)$/.test(ext) || m.includes("code") || m.includes("script"))
    return { emoji: "💻", cls: "code" };
  return { emoji: "📦", cls: "" };
}

/** 是否为图片文件（用于缩略图） */
function isImage(file: FileRow): boolean {
  return !!file.mime && file.mime.startsWith("image/");
}

/** 右键菜单 JSON（data-ctxjson）：每个可管理项的数据 */
function ctxJson(file: FileRow, isAdmin: boolean): string {
  return escapeHtml(
    JSON.stringify({
      id: file.id,
      name: file.name,
      price: file.price,
      category: file.category,
      description: file.description,
      hidden: file.hidden,
      canManage: isAdmin,
    }),
  );
}

/** 文件列表（表格视图）的行 */
function tableRows(
  rctx: RenderCtx,
  files: FileRow[],
  isAdmin: boolean,
): string {
  return files
    .map((f) => {
      const icon = fileIcon(f);
      return `
        <tr data-ctxjson="${ctxJson(f, isAdmin)}">
          <td><a href="/f/${escapeHtml(f.id)}" onclick="event.stopPropagation()">${icon.emoji} ${escapeHtml(f.name)}</a>${f.hidden ? ' <span class="tag" title="已隐藏">隐藏</span>' : ""}</td>
          <td class="muted">${escapeHtml(f.category || "—")}</td>
          <td class="muted">${humanSize(f.size)}</td>
          <td>${priceTag(f, rctx.config)}</td>
          <td class="muted">${escapeHtml(String(f.downloads))}</td>
          <td class="muted">${new Date(f.created_at).toLocaleDateString("zh-CN")}</td>
        </tr>`;
    })
    .join("");
}

/** 网格视图卡片 */
function gridCards(
  rctx: RenderCtx,
  files: FileRow[],
  isAdmin: boolean,
): string {
  return files
    .map((f) => {
      const icon = fileIcon(f);
      // 图片：渲染真实缩略图，加载失败回退到 🖼️ 图标
      const iconArea = isImage(f)
        ? `<img class="fthumb" src="/thumb/${escapeHtml(f.id)}" alt="${escapeHtml(f.name)}" loading="lazy" onerror="this.outerHTML='<div class=\\'ficon img\\'>🖼️</div>'">`
        : `<div class="ficon ${icon.cls}">${icon.emoji}</div>`;
      return `
        <a class="file-card" href="/f/${escapeHtml(f.id)}" data-ctxjson="${ctxJson(f, isAdmin)}">
          ${iconArea}
          <div class="fname" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</div>
          <div class="fprice">${priceTag(f, rctx.config)}</div>
          <div class="fmeta">${humanSize(f.size)} · ${escapeHtml(String(f.downloads))} 下载</div>
          ${f.hidden ? '<span class="tag" style="position:absolute;top:8px;right:8px">隐藏</span>' : ""}
        </a>`;
    })
    .join("");
}

export function renderList(
  rctx: RenderCtx,
  files: FileRow[],
  categories: string[],
  currentCat: string | undefined,
  q: string | undefined,
): string {
  const isAdmin = !!rctx.session?.isAdmin;

  const catChips = categories
    .map(
      (c) =>
        `<a class="tag${c === currentCat ? " active" : ""}" href="/?category=${encodeURIComponent(c)}">${escapeHtml(c)}</a>`,
    )
    .join(" ");

  const emptyRow = `<tr><td colspan="6" class="center muted" style="padding:48px">📭 暂无文件${
    isAdmin ? '，去 <a href="/upload">上传</a> 第一个吧' : ""
  }</td></tr>`;

  const body = `
    <div class="panel">
      <div class="row between" style="margin-bottom:14px">
        <h2 style="margin:0">📁 文件列表 <span class="muted" style="font-size:13px;font-weight:400">共 ${files.length} 个</span></h2>
        <div class="row" style="gap:8px">
          <form method="get" action="/" class="row" style="gap:6px">
            <input class="input" name="q" placeholder="搜索文件名/描述" value="${escapeHtml(q || "")}" style="width:200px">
            <button class="btn btn-sm" type="submit">🔍 搜索</button>
          </form>
          <div class="view-switch" id="viewSwitch">
            <button type="button" data-view="list" class="active" title="列表视图">☰</button>
            <button type="button" data-view="grid" title="网格视图">▦</button>
          </div>
        </div>
      </div>
      ${categories.length ? `<div class="row" style="margin-bottom:12px"><a class="tag${!currentCat ? " active" : ""}" href="/">全部</a> ${catChips}</div>` : ""}
      <div id="view-list">
        <table class="files">
          <thead><tr><th>文件名</th><th>分类</th><th>大小</th><th>价格</th><th>下载</th><th>上传时间</th></tr></thead>
          <tbody>${files.length ? tableRows(rctx, files, isAdmin) : emptyRow}</tbody>
        </table>
      </div>
      <div id="view-grid" class="file-grid" hidden>${files.length ? gridCards(rctx, files, isAdmin) : ""}</div>
    </div>
    <script>${VIEW_JS}</script>`;

  return layout(rctx, "", body, { current: "/" });
}

/** 视图切换 + 右键菜单构建 + 弹窗逻辑（注入页面） */
const VIEW_JS = `
(function(){
  // ── 视图切换 ──
  var KEY='ldcpan_view';
  var sw=document.getElementById('viewSwitch');
  var vL=document.getElementById('view-list'), vG=document.getElementById('view-grid');
  function setView(v){
    if(!vL||!vG) return;
    vL.hidden = v!=='list';
    vG.hidden = v!=='grid';
    try{localStorage.setItem(KEY,v);}catch(e){}
    var bts=sw.querySelectorAll('button');
    bts.forEach(function(b){b.classList.toggle('active', b.getAttribute('data-view')===v);});
  }
  if(sw){
    var saved='list'; try{saved=localStorage.getItem(KEY)||'list';}catch(e){}
    setView(saved);
    sw.addEventListener('click',function(e){
      var b=e.target.closest('button[data-view]'); if(b) setView(b.getAttribute('data-view'));
    });
  }

  // ── 简易弹窗 helper ──
  function openModal(title, bodyHtml, footHtml){
    var ov=document.createElement('div');
    ov.className='modal-overlay';
    ov.innerHTML='<div class="modal"><div class="modal-head"><h3>'+title+'</h3><button class="modal-x" type="button">×</button></div><div class="modal-body">'+bodyHtml+'</div>'+(footHtml?'<div class="modal-foot">'+footHtml+'</div>':'')+'</div>';
    var inner=ov.querySelector('.modal');
    var closed=false;
    function close(){ if(closed) return; closed=true; ov.classList.add('closing'); if(inner) inner.classList.add('closing'); setTimeout(function(){ ov.remove(); }, 200); }
    ov.addEventListener('click',function(e){ if(e.target===ov||e.target.classList.contains('modal-x')) close(); });
    document.addEventListener('keydown',function esc(e){ if(e.key==='Escape'){close();document.removeEventListener('keydown',esc);} });
    document.body.appendChild(ov);
    return ov;
  }

  function escAttr(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }

  // ── 右键菜单内容（供 render.ts CTXMENU_INIT 调用）──
  window.__buildCtxMenu = function(ctx){
    var items=[{act:'open',icon:'<span class="ico">📄</span>',label:'查看详情'}];
    items.push({act:'dl',icon:'<span class="ico">⬇️</span>',label:'下载'});
    if(ctx.canManage){
      items.push({sep:true});
      items.push({act:'edit',icon:'<span class="ico">✏️</span>',label:'编辑信息'});
      items.push({act:'share',icon:'<span class="ico">🔗</span>',label:'生成分享链接'});
      items.push({sep:true});
      items.push({act:'del',icon:'<span class="ico">🗑️</span>',label:'删除文件'});
    }
    return items;
  };

  // ── 菜单动作 ──
  window.__ctxAction = function(act, ctx){
    if(act==='open'){ location.href='/f/'+encodeURIComponent(ctx.id); return; }
    if(act==='dl'){
      location.href='/pay/create?file_id='+encodeURIComponent(ctx.id); return;
    }
    if(act==='edit'){ openEdit(ctx); return; }
    if(act==='share'){ window.open('/admin/shares?file_id='+encodeURIComponent(ctx.id), '_blank'); return; }
    if(act==='del'){ openDel(ctx); return; }
  };

  // ── 编辑弹窗：表单 POST 到 /f/:id/edit ──
  function openEdit(ctx){
    var body=
      '<form id="editForm" method="post" action="/f/'+encodeURIComponent(ctx.id)+'/edit">'+
        '<label>价格（留空=默认价，0=免费）</label>'+
        '<input class="input" name="price" value="'+(ctx.price==null?'':ctx.price)+'" placeholder="积分">'+
        '<label>分类</label>'+
        '<input class="input" name="category" value="'+escAttr(ctx.category)+'" placeholder="如：电子书">'+
        '<label>描述</label>'+
        '<textarea class="input" name="description" rows="3" placeholder="可选">'+escAttr(ctx.description)+'</textarea>'+
        '<label class="row" style="align-items:center;gap:8px;margin-top:14px;cursor:pointer">'+
          '<input type="checkbox" name="hidden" value="1" '+(ctx.hidden?'checked':'')+' style="width:auto">'+
          '<span style="margin:0">对普通用户隐藏此文件</span>'+
        '</label>'+
      '</form>';
    var foot='<button class="btn" type="button">取消</button><button class="btn btn-primary" type="button" data-submit>保存</button>';
    var m=openModal('编辑：'+ctx.name, body, foot);
    m.querySelectorAll('.modal-foot .btn').forEach(function(b){
      if(b.hasAttribute('data-submit')) b.onclick=function(){ document.getElementById('editForm').submit(); };
      else b.onclick=function(){ m.remove(); };
    });
  }

  // ── 删除确认弹窗 ──
  function openDel(ctx){
    var body='<div class="notice err">⚠️ 确认删除文件「'+ctx.name+'」？</div><p class="muted">删除后文件和 R2 存储将一并移除，且<strong>无法恢复</strong>。相关订单记录会保留。</p>';
    var foot='<button class="btn" type="button">取消</button>'+
      '<form method="post" action="/f/'+encodeURIComponent(ctx.id)+'/delete" style="display:inline"><button class="btn btn-danger" type="submit">确认删除</button></form>';
    var m=openModal('删除文件', body, foot);
    var cancelBtn=m.querySelector('.modal-foot .btn');
    if(cancelBtn) cancelBtn.onclick=function(){ m.remove(); };
  }
})();
`;
