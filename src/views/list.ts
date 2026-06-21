/**
 * 文件列表视图：列表/网格双视图，管理员右键菜单 + 编辑/分享/删除弹窗。
 * 普通用户：右键/长按只有「详情/下载」；管理员：额外有「编辑/分享/删除」。
 */
import type { FileRow } from "../storage/files";
import { effectivePrice } from "../env";
import type { AppConfig } from "../env";
import { escapeHtml } from "../lib/crypto";
import { humanSize } from "../lib/format";
import type { RenderCtx } from "../lib/render";
import { layout } from "../lib/render";

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
          <td><a href="/f/${escapeHtml(f.id)}" onclick="event.preventDefault();window.__openDetail('${escapeHtml(f.id)}')">${icon.emoji} ${escapeHtml(f.name)}</a>${f.hidden ? ' <span class="tag" title="已隐藏">隐藏</span>' : ""}</td>
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
        <a class="file-card" href="/f/${escapeHtml(f.id)}" onclick="event.preventDefault();window.__openDetail('${escapeHtml(f.id)}')" data-ctxjson="${ctxJson(f, isAdmin)}">
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

  // openModal / escAttr / humanSize 已在 shared.js 定义（全局，页面 head 先加载）

  // ── 详情弹窗：fetch /f/:id JSON → 渲染浮层（不跳转）──
  window.__openDetail=function(id){
    var body='<div class="center muted" style="padding:30px">加载中…</div>';
    var m=openModal('文件详情', body, '');
    fetch('/f/'+encodeURIComponent(id),{headers:{'Accept':'application/json','X-Requested-With':'fetch'}})
    .then(function(r){return r.json();})
    .then(function(f){
      if(!f.ok){ m.querySelector('.modal-body').innerHTML='<div class="notice err">'+escAttr(f.error||'加载失败')+'</div>'; return; }
      var dlBtn = f.owned
        ? '<a class="btn btn-primary" href="/dl/free?file_id='+encodeURIComponent(f.id)+'">⬇️ 下载</a>'
        : '<a class="btn btn-primary" href="/pay/create?file_id='+encodeURIComponent(f.id)+'">支付 '+f.price+' 积分下载</a>';
      var priceTxt = f.price<=0 ? '<span class="free">免费</span>' : '<span class="price">'+f.price+' 积分</span>';
      // 图片：左侧自适应预览（按原比例，宽度填满左栏）；非图片无预览
      var thumb = f.isImage
        ? '<img src="/thumb/'+encodeURIComponent(f.id)+'" alt="" class="dtl-thumb" loading="lazy">'
        : '';
      var ownNote = f.owned && f.price>0 ? '<div class="notice ok">你已购买此文件，可重复下载。</div>' : '';
      // 管理操作（管理员）
      var admin = f.isAdmin ? '' +
        '<div style="border-top:1px solid var(--border);margin-top:14px;padding-top:14px">'+
          '<div class="muted" style="font-size:12px;margin-bottom:8px">🛠️ 管理操作</div>'+
          '<div class="row">'+
            '<button class="btn btn-sm" id="dtl-edit" type="button">✏️ 编辑</button>'+
            '<a class="btn btn-sm" href="/admin/shares?file_id='+encodeURIComponent(f.id)+'" target="_blank" rel="noopener">🔗 分享</a>'+
            '<button class="btn btn-sm btn-danger" id="dtl-del" type="button">🗑️ 删除</button>'+
            (f.hidden?'<span class="tag">已隐藏</span>':'')+
          '</div>'+
        '</div>' : '';
      var info=
        '<div class="row" style="align-items:baseline;margin-bottom:6px"><h2 style="margin:0;font-size:17px">'+escAttr(f.name)+'</h2></div>'+
        (f.description?'<p class="muted">'+escAttr(f.description)+'</p>':'')+
        '<div class="grid grid-2" style="margin:12px 0">'+
          '<div><label>分类</label><div>'+escAttr(f.category||'—')+'</div></div>'+
          '<div><label>大小</label><div>'+humanSize(f.size)+'</div></div>'+
          '<div><label>价格</label><div>'+priceTxt+'</div></div>'+
          '<div><label>下载次数</label><div>'+escAttr(String(f.downloads))+'</div></div>'+
          '<div><label>类型</label><div class="muted">'+escAttr(f.mime)+'</div></div>'+
          '<div><label>上传时间</label><div class="muted">'+escAttr(new Date(f.createdAt).toLocaleString('zh-CN'))+'</div></div>'+
        '</div>'+
        ownNote+
        '<div class="row">'+dlBtn+'</div>'+
        admin;
      // 图片文件：左预览 + 右信息 两栏；非图片：单栏
      if(f.isImage){
        m.querySelector('.modal-body').innerHTML = '<div class="dtl-layout"><div class="dtl-preview">'+thumb+'</div><div class="dtl-info">'+info+'</div></div>';
      } else {
        m.querySelector('.modal-body').innerHTML = info;
      }
      // 绑定管理按钮（事件而非内联，避免引号转义问题）
      var editBtn=m.querySelector('#dtl-edit');
      if(editBtn) editBtn.onclick=function(){
        fetch('/f/'+encodeURIComponent(id),{headers:{'Accept':'application/json'}})
        .then(function(r){return r.json();}).then(function(ff){
          if(!ff.ok) return;
          window.__ctxAction('edit',{id:id,name:ff.name,price:ff.priceRaw,category:ff.category,description:ff.description,hidden:ff.hidden,canManage:true});
        });
      };
      var delBtn=m.querySelector('#dtl-del');
      if(delBtn) delBtn.onclick=function(){
        // 关闭详情弹窗，再开删除确认
        document.querySelectorAll('.modal-overlay').forEach(function(el){el.remove();});
        window.__ctxAction('del',{id:id,name:f.name});
      };
    }).catch(function(e){
      m.querySelector('.modal-body').innerHTML='<div class="notice err">加载失败</div>';
    });
  };

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
    if(act==='open'){ window.__openDetail(ctx.id); return; }
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
    var foot='<button class="btn" type="button">取消</button><button class="btn btn-danger" type="button" data-confirm>确认删除</button>';
    var m=openModal('删除文件', body, foot);
    var cancelBtn=m.querySelector('.modal-foot .btn:not([data-confirm])');
    if(cancelBtn) cancelBtn.onclick=function(){ m.remove(); };
    var confirmBtn=m.querySelector('[data-confirm]');
    if(confirmBtn){
      confirmBtn.onclick=function(){
        confirmBtn.disabled=true; confirmBtn.textContent='删除中…';
        fetch('/f/'+encodeURIComponent(ctx.id)+'/delete',{method:'POST',headers:{'Accept':'application/json','X-Requested-With':'fetch'}})
        .then(function(r){return r.json().then(function(j){return {status:r.status,json:j};}).catch(function(){return {status:r.status,json:{ok:false,error:'HTTP '+r.status}};});})
        .then(function(res){
          confirmBtn.disabled=false; confirmBtn.textContent='确认删除';
          if(res.json && res.json.ok){
            // 关闭确认弹窗
            m.remove();
            // 找到该文件的所有 DOM 行/卡片，播放淡出动画后移除
            var rows=document.querySelectorAll('[data-ctxjson]');
            rows.forEach(function(el){
              try{
                var d=JSON.parse(el.getAttribute('data-ctxjson')||'{}');
                if(d.id===ctx.id){
                  el.style.transition='opacity .4s ease, transform .4s ease, height .4s ease, padding .4s ease, margin .4s ease';
                  el.style.opacity='0'; el.style.transform='translateX(-40px) scale(.95)';
                  // 表格行需收起高度
                  if(el.tagName==='TR'){ el.style.height=el.offsetHeight+'px'; requestAnimationFrame(function(){ el.style.height='0'; el.style.overflow='hidden'; }); }
                  setTimeout(function(){ el.remove(); }, 420);
                }
              }catch(e){}
            });
            if(window.showToast) window.showToast('🗑️ '+ctx.name+' 已删除','ok');
          } else {
            confirmBtn.disabled=false;
            if(window.showToast) window.showToast('删除失败：'+((res.json&&res.json.error)||''),'err');
          }
        }).catch(function(e){
          confirmBtn.disabled=false; confirmBtn.textContent='确认删除';
          if(window.showToast) window.showToast('删除出错','err');
        });
      };
    }
  }
})();
`;
