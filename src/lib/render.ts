/**
 * HTML 渲染外壳：layout、转义、导航栏（含登录态）。
 * 视图函数返回 HTML 片段，由 layout() 包裹。
 *
 * 主题：蓝白亮色为主，UTC+8 22:00-06:00 自动切暗色；
 * 右上角提供手动切换（跟随/亮/暗），记忆在 localStorage。
 */

import type { AppConfig } from "../env";
import type { SessionData } from "../auth/session";
import { escapeHtml } from "./crypto";

export interface RenderCtx {
  config: AppConfig;
  session?: SessionData;
}

function navItem(href: string, label: string, current: string): string {
  const active = current === href ? ' class="active"' : "";
  return `<a href="${escapeHtml(href)}"${active}>${escapeHtml(label)}</a>`;
}

export function layout(
  rctx: RenderCtx,
  title: string,
  body: string,
  opts: { current?: string; extraHead?: string } = {},
): string {
  const { config, session } = rctx;
  const fullTitle = title ? `${title} · ${config.siteName}` : config.siteName;

  const avatarImg = session?.avatarUrl
    ? `<img src="${escapeHtml(session.avatarUrl)}" alt="" class="avatar">`
    : `<span class="avatar avatar-ph">${escapeHtml((session?.name || session?.username || "?").slice(0, 1))}</span>`;

  const userArea = session
    ? session.isAdmin
      ? // 管理员：头像可点击，展开统计/管理下拉菜单
        `<div class="user-menu" id="userMenu">
           <button class="user-trigger" type="button" onclick="window.__toggleUserMenu(event)" aria-haspopup="true">
             ${avatarImg}
             <span class="uname">${escapeHtml(session.name || session.username)}</span>
             <span class="badge">管理员</span>
             <span class="caret">▾</span>
           </button>
           <div class="user-dropdown" id="userDropdown" hidden>
             <div class="ud-head">
               <div class="ud-title">📊 站点概览</div>
               <div class="ud-sub muted">实时统计</div>
             </div>
             <div class="ud-stats" id="udStats">
               <div class="ud-loading muted">加载中…</div>
             </div>
             <div class="ud-links">
               <a class="ud-link" href="/admin/shares">🔗 分享管理</a>
             </div>
             <div class="ud-foot">
               <form method="post" action="/auth/logout">
                 <button class="btn btn-sm ud-logout" type="submit">退出登录</button>
               </form>
             </div>
           </div>
         </div>`
      : // 普通用户：仅显示信息 + 退出
        `<span class="user">
           ${avatarImg}
           <span class="uname">${escapeHtml(session.name || session.username)}</span>
           <form method="post" action="/auth/logout" style="display:inline">
             <button type="submit" class="btn btn-sm">退出</button>
           </form>
         </span>`
    : `<a class="btn btn-sm" href="/auth/login">使用 LINUX DO 登录</a>`;

  // 主题切换按钮：跟随/亮/暗 三态，循环切换
  const themeBtn = `<button class="theme-toggle btn btn-sm" type="button" title="切换主题" aria-label="切换主题">
    <span class="theme-ico theme-ico-auto">🌗</span>
    <span class="theme-ico theme-ico-light">☀️</span>
    <span class="theme-ico theme-ico-dark">🌙</span>
  </button>`;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(fullTitle)}</title>
<link rel="icon" type="image/svg+xml" href="${FAVICON}">
<style>${STYLES}</style>
<script>${THEME_INIT}</script>
${opts.extraHead ?? ""}
</head>
<body>
<header class="topbar">
  <div class="wrap nav">
    <a href="/" class="brand">📁 ${escapeHtml(config.siteName)}</a>
    <nav class="links">
      ${navItem("/", "文件", opts.current ?? "")}
    </nav>
    <div class="spacer"></div>
    ${themeBtn}
    ${userArea}
  </div>
</header>
<main class="wrap content">
${body}
</main>
<footer class="footer-bar">
  <div class="wrap footer-inner">
    <span>基于 Cloudflare Workers · LINUX DO Connect · LINUX DO Credit</span>
    <a class="gh-link" href="https://github.com/XuF-163/ldcpan" target="_blank" rel="noopener" title="GitHub 开源仓库">
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
      GitHub
    </a>
  </div>
</footer>
<!-- 全局右键菜单（管理员） -->
<div id="ctxmenu" class="ctxmenu" hidden></div>
<script>${CTXMENU_INIT}</script>
${session?.isAdmin ? `<script>${USERMENU_INIT}</script>` : ""}
${session?.isAdmin && opts.current !== "/upload" ? `
<!-- 管理员：右下角上传悬浮按钮 + 拖拽上传 -->
<button class="fab" id="uploadFab" type="button" title="上传文件" aria-label="上传文件">+</button>
<div class="drop-overlay" id="dropOverlay" hidden><div class="drop-hint">📥 松开以上传文件</div></div>
<script>${UPLOAD_INIT}</script>` : ""}
</body>
</html>`;
}

/**
 * 主题初始化脚本（内联，渲染前执行避免闪烁）。
 * - localStorage 主题模式：'auto' | 'light' | 'dark'
 * - auto 模式按 UTC+8 时段（22:00-06:00）自动判定夜间
 */
const THEME_INIT = `
(function(){
  try{
    var KEY='ldcpan_theme';
    var mode = localStorage.getItem(KEY) || 'auto';
    function isNight(){
      // UTC+8 当前小时
      var now = new Date();
      var utc8 = new Date(now.getTime() + (now.getTimezoneOffset() + 480) * 60000);
      var h = utc8.getHours();
      return h >= 22 || h < 6;
    }
    function apply(m){
      var dark = (m === 'dark') || (m === 'auto' && isNight());
      document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    }
    window.__setTheme = function(m){
      try{ localStorage.setItem(KEY, m); }catch(e){}
      apply(m);
      var btn = document.querySelector('.theme-toggle');
      if(btn){ btn.setAttribute('data-mode', m); }
    };
    window.__getTheme = function(){ return mode; };
    apply(mode);
    document.addEventListener('DOMContentLoaded', function(){
      var btn = document.querySelector('.theme-toggle');
      if(!btn) return;
      btn.setAttribute('data-mode', mode);
      btn.addEventListener('click', function(){
        var cur = (localStorage.getItem(KEY) || 'auto');
        var next = cur === 'auto' ? 'light' : (cur === 'light' ? 'dark' : 'auto');
        window.__setTheme(next);
      });
    });
  }catch(e){}
})();
`;

/**
 * 全局右键菜单初始化：把 data-ctxjson 属性的元素绑定 contextmenu/long-press。
 * 每个可管理项把菜单数据写在 data-ctxjson（JSON：{id,name,canManage}）。
 */
const CTXMENU_INIT = `
(function(){
  var menu = document.getElementById('ctxmenu');
  if(!menu) return;
  function build(items){
    return items.map(function(it){
      if(it.sep) return '<div class="ctx-sep"></div>';
      if(it.href) return '<a class="ctx-item" href="'+it.href+'">'+it.icon+it.label+'</a>';
      return '<button class="ctx-item" data-act="'+it.act+'">'+it.icon+it.label+'</button>';
    }).join('');
  }
  function show(items, x, y, ctx){
    menu.innerHTML = build(items);
    menu.hidden = false;
    // 定位（防止溢出）
    menu.style.left = '0px'; menu.style.top = '0px';
    var rect = menu.getBoundingClientRect();
    var px = Math.min(x, window.innerWidth - rect.width - 8);
    var py = Math.min(y, window.innerHeight - rect.height - 8);
    menu.style.left = px + 'px'; menu.style.top = py + 'px';
    menu._ctx = ctx;
  }
  function hide(){ menu.hidden = true; menu._ctx = null; }
  document.addEventListener('click', function(e){
    if(!menu.hidden && !menu.contains(e.target)) hide();
  });
  document.addEventListener('scroll', hide, true);
  window.addEventListener('blur', hide);

  // 触发：对带 [data-ctxjson] 的元素
  document.addEventListener('contextmenu', function(e){
    var el = e.target.closest('[data-ctxjson]');
    if(!el) return;
    e.preventDefault();
    var ctx = JSON.parse(el.getAttribute('data-ctxjson'));
    var items = window.__buildCtxMenu ? window.__buildCtxMenu(ctx) : [];
    if(!items.length) return;
    show(items, e.clientX, e.clientY, ctx);
  });
  // 长按（移动端）
  var lpTimer = null, lpEl = null, lpXY = null;
  document.addEventListener('touchstart', function(e){
    var el = e.target.closest('[data-ctxjson]');
    if(!el) return;
    lpEl = el;
    var t = e.touches[0]; lpXY = {x:t.clientX, y:t.clientY};
    lpTimer = setTimeout(function(){
      if(!lpEl) return;
      var ctx = JSON.parse(lpEl.getAttribute('data-ctxjson'));
      var items = window.__buildCtxMenu ? window.__buildCtxMenu(ctx) : [];
      if(items.length) show(items, lpXY.x, lpXY.y, ctx);
    }, 550);
  }, {passive:true});
  document.addEventListener('touchmove', function(){ clearTimeout(lpTimer); lpEl=null; }, {passive:true});
  document.addEventListener('touchend', function(){ clearTimeout(lpTimer); lpEl=null; }, {passive:true});

  // 菜单项点击（事件委托）
  menu.addEventListener('click', function(e){
    var item = e.target.closest('.ctx-item');
    if(!item || !menu._ctx) return;
    var act = item.getAttribute('data-act');
    if(act && window.__ctxAction) window.__ctxAction(act, menu._ctx);
    hide();
  });
  // Esc 关闭
  document.addEventListener('keydown', function(e){ if(e.key==='Escape') hide(); });
})();
`;

/**
 * 管理员头像下拉菜单：点击展开统计面板，点外部/Esc 关闭，展开时拉取 /admin/stats。
 */
const USERMENU_INIT = `
(function(){
  var menu=document.getElementById('userMenu');
  var dd=document.getElementById('userDropdown');
  if(!menu||!dd) return;
  var loaded=false;
  window.__toggleUserMenu=function(e){
    e.stopPropagation();
    var willOpen=dd.hidden;
    dd.hidden=!willOpen;
    if(willOpen && !loaded){ loaded=true; loadStats(); }
  };
  // 点外部关闭
  document.addEventListener('click',function(e){
    if(!dd.hidden && !menu.contains(e.target)) dd.hidden=true;
  });
  document.addEventListener('keydown',function(e){ if(e.key==='Escape') dd.hidden=true; });

  function humanSize(b){
    if(b<1024) return b+' B';
    var u=['KB','MB','GB','TB'],v=b/1024,i=0;
    while(v>=1024&&i<u.length-1){v/=1024;i++;}
    return v.toFixed(v>=100?0:1)+' '+u[i];
  }
  function loadStats(){
    var box=document.getElementById('udStats');
    fetch('/admin/stats').then(function(r){return r.json();}).then(function(s){
      box.innerHTML=
        '<div class="ud-grid ud-grid-2">'+
          '<div class="ud-stat"><div class="ud-k">💰 总收益</div><div class="ud-v">'+s.revenue.total+'<small>积分</small></div><div class="ud-sub2 muted">'+s.revenue.orders+' 笔 · 近7天 '+s.revenue.last7d.total+'</div></div>'+
          '<div class="ud-stat"><div class="ud-k">💾 存储占用</div><div class="ud-v">'+humanSize(s.storage.bytes)+'</div><div class="ud-sub2 muted">'+s.storage.files+' 文件 · '+s.storage.downloads+' 下载</div></div>'+
        '</div>'+
        '<div class="ud-grid ud-grid-3">'+
          '<div class="ud-mini c-user"><div class="ud-mk">👤 用户</div><div class="ud-mv">'+s.users+'</div></div>'+
          '<div class="ud-mini c-share"><div class="ud-mk">🔗 分享</div><div class="ud-mv">'+s.shares+'</div></div>'+
          '<div class="ud-mini c-buy"><div class="ud-mk">🛒 购买</div><div class="ud-mv">'+s.purchases+'</div></div>'+
        '</div>';
    }).catch(function(){
      box.innerHTML='<div class="ud-loading muted">统计加载失败</div>';
    });
  }
})();
`;

/**
 * 管理员上传：右下角圆形 + 按钮 + 全局拖拽上传。
 * 点击 + 或拖文件到页面，弹出上传表单（复用 /upload 的字段：文件/分类/描述/价格），
 * 提交到 POST /upload。分类列表从 GET /upload 解析 datalist（懒加载一次）。
 */
const UPLOAD_INIT = `
(function(){
  var fab=document.getElementById('uploadFab');
  var overlay=document.getElementById('dropOverlay');
  if(!fab) return;
  var catList=null; // 分类 datalist HTML（懒加载）

  function fetchCats(cb){
    if(catList!=null){ cb(catList); return; }
    fetch('/upload').then(function(r){return r.text();}).then(function(html){
      var m=/id="catlist"[^>]*>([\\s\\S]*?)<\\/datalist>/.exec(html);
      catList = m ? m[1] : '';
      cb(catList);
    }).catch(function(){ catList=''; cb(''); });
  }

  function openUploadModal(presetFile){
    fetchCats(function(cats){
      var fn = presetFile ? '<div class="muted">📎 '+escapeText(presetFile.name)+' <small>('+humanS(presetFile.size)+')</small></div>' : '';
      var body=
        '<form id="upForm" method="post" action="/upload" enctype="multipart/form-data">'+
          fn+
          '<label>选择文件</label>'+
          '<input class="input" type="file" name="file" id="upFile" required>'+
          '<label>分类</label>'+
          '<input class="input" name="category" list="upCatlist" placeholder="可选">'+
          '<datalist id="upCatlist">'+cats+'</datalist>'+
          '<label>描述</label>'+
          '<textarea class="input" name="description" rows="2" placeholder="可选"></textarea>'+
          '<label>价格（积分，0=免费）</label>'+
          '<input class="input" type="number" name="price" min="0" step="1" value="0">'+
        '</form>';
      var foot='<button class="btn" type="button">取消</button><button class="btn btn-primary" type="button" data-submit>上传</button>';
      var m=openModalX('上传文件', body, foot);
      var input=document.getElementById('upFile');
      // 预填拖入的文件（通过 DataTransfer）
      if(presetFile && input){
        var dt=new DataTransfer(); dt.items.add(presetFile); input.files=dt.files; input.hidden=true;
      }
      m.querySelectorAll('.modal-foot .btn').forEach(function(b){
        if(b.hasAttribute('data-submit')) b.onclick=function(){ document.getElementById('upForm').submit(); };
        else b.onclick=function(){ m.remove(); };
      });
    });
  }

  function escapeText(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;');}
  function humanS(b){if(b<1024)return b+' B';var u=['KB','MB','GB','TB'],v=b/1024,i=0;while(v>=1024&&i<u.length-1){v/=1024;i++;}return v.toFixed(v>=100?0:1)+' '+u[i];}
  // 复用 render.ts 的弹窗 helper（若该页未注入 list.ts 的 __openModal，则自带一份）
  function openModalX(title, bodyHtml, footHtml){
    var ov=document.createElement('div');ov.className='modal-overlay';
    ov.innerHTML='<div class="modal"><div class="modal-head"><h3>'+title+'</h3><button class="modal-x" type="button">×</button></div><div class="modal-body">'+bodyHtml+'</div>'+(footHtml?'<div class="modal-foot">'+footHtml+'</div>':'')+'</div>';
    var inner=ov.querySelector('.modal');
    var closed=false;
    function close(){
      if(closed) return; closed=true;
      // 播放关闭动画后再移除
      ov.classList.add('closing');
      if(inner) inner.classList.add('closing');
      setTimeout(function(){ ov.remove(); }, 200);
    }
    ov.addEventListener('click',function(e){if(e.target===ov||e.target.classList.contains('modal-x'))close();});
    document.addEventListener('keydown',function esc(e){if(e.key==='Escape'){close();document.removeEventListener('keydown',esc);}});
    document.body.appendChild(ov);return ov;
  }

  // 点击 + 按钮
  fab.addEventListener('click',function(){ openUploadModal(null); });

  // 全局拖拽上传
  var dragDepth=0;
  window.addEventListener('dragenter',function(e){
    if(!e.dataTransfer||!Array.from(e.dataTransfer.types||[]).includes('Files')) return;
    e.preventDefault(); dragDepth++; overlay.hidden=false;
  });
  window.addEventListener('dragover',function(e){
    if(!e.dataTransfer||!Array.from(e.dataTransfer.types||[]).includes('Files')) return;
    e.preventDefault(); e.dataTransfer.dropEffect='copy';
  });
  window.addEventListener('dragleave',function(e){
    dragDepth--; if(dragDepth<=0){ overlay.hidden=true; dragDepth=0; }
  });
  window.addEventListener('drop',function(e){
    if(!e.dataTransfer||!e.dataTransfer.files||!e.dataTransfer.files.length) return;
    e.preventDefault(); dragDepth=0; overlay.hidden=true;
    var f=e.dataTransfer.files[0];
    openUploadModal(f);
  });
})();
`;

/**
 * 站点 favicon：data-URI 内联 SVG（无需额外文件/路由）。
 * 蓝色圆角云 + 内嵌硬盘/文件夹条，契合"网盘"语义。
 */
const FAVICON =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">` +
      `<rect width="32" height="32" rx="7" fill="#2563eb"/>` +
      // 云朵主体（白色）
      `<path fill="#fff" d="M9 21a4 4 0 01-.5-7.97 5.5 5.5 0 0110.6-1.4A4.2 4.2 0 0123 21H9z"/>` +
      // 硬盘/文件夹横条（蓝色，象征存储）
      `<rect x="10" y="19.5" width="12" height="3" rx="1.2" fill="#2563eb"/>` +
      `<circle cx="12" cy="21" r=".8" fill="#fff"/>` +
      `</svg>`,
  );

const STYLES = `
/* ===== 主题变量：蓝白亮色 / 自动暗色 ===== */
:root{
  --bg:#f4f7fb; --bg2:#ffffff; --panel:#ffffff; --panel2:#f0f5ff;
  --border:#dde6f0; --border2:#c5d4e8;
  --text:#1a2740; --text2:#46587a; --muted:#7a8aa8;
  --accent:#2563eb; --accent2:#1d4ed8; --accent-soft:#e8f0ff;
  --ok:#16a34a; --warn:#d97706; --err:#dc2626;
  --shadow:0 1px 3px rgba(30,58,95,.08),0 1px 2px rgba(30,58,95,.06);
  --shadow-lg:0 10px 30px rgba(30,58,95,.16);
}
[data-theme="dark"]{
  --bg:#0d1521; --bg2:#0d1521; --panel:#16202e; --panel2:#1a2738;
  --border:#243248; --border2:#2f4160;
  --text:#e6edf6; --text2:#b8c5d8; --muted:#7e8ea8;
  --accent:#3b82f6; --accent2:#60a5fa; --accent-soft:#1a2740;
  --ok:#34d399; --warn:#fbbf24; --err:#f87171;
  --shadow:0 1px 3px rgba(0,0,0,.3); --shadow-lg:0 10px 30px rgba(0,0,0,.5);
}
*{box-sizing:border-box}
html,body{margin:0}
/* 关键：[hidden] 必须能覆盖类选择器（如 .file-grid 的 display:grid），否则列表/网格两视图会同时显示 */
[hidden]{display:none !important}
body{background:var(--bg);color:var(--text);font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;-webkit-font-smoothing:antialiased}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
.wrap{max-width:1140px;margin:0 auto;padding:0 16px}
.topbar{background:var(--bg2);border-bottom:1px solid var(--border);position:sticky;top:0;z-index:50;box-shadow:var(--shadow)}
.nav{display:flex;align-items:center;gap:14px;height:58px;flex-wrap:wrap}
.brand{font-weight:700;font-size:16px;color:var(--text);display:flex;align-items:center;gap:6px}
.nav .links{display:flex;gap:6px}
.nav .links a{color:var(--text2);padding:7px 12px;border-radius:8px;font-weight:500}
.nav .links a.active{background:var(--accent-soft);color:var(--accent)}
.nav .links a:hover{background:var(--panel2);text-decoration:none}
.nav .spacer{flex:1}
.user{display:flex;align-items:center;gap:8px}
.avatar{width:26px;height:26px;border-radius:50%;vertical-align:middle;object-fit:cover}
.avatar-ph{display:inline-flex;align-items:center;justify-content:center;background:var(--accent-soft);color:var(--accent);font-size:13px;font-weight:700}
.uname{color:var(--text);font-weight:500}
.badge{background:linear-gradient(135deg,var(--accent),var(--accent2));color:#fff;font-size:11px;padding:2px 8px;border-radius:10px;font-weight:600}

/* ===== 管理员头像下拉菜单 ===== */
.user-menu{position:relative}
.user-trigger{display:inline-flex;align-items:center;gap:7px;background:transparent;border:1px solid transparent;color:var(--text);padding:4px 8px;border-radius:10px;cursor:pointer;font:inherit}
.user-trigger:hover{background:var(--panel2);border-color:var(--border)}
.user-trigger .caret{font-size:10px;color:var(--muted);margin-left:-2px}
.user-dropdown{position:absolute;right:0;top:calc(100% + 8px);width:300px;background:var(--panel);border:1px solid var(--border);border-radius:14px;box-shadow:var(--shadow-lg);z-index:200;overflow:hidden;animation:pop .16s}
.ud-head{padding:14px 16px 8px;border-bottom:1px solid var(--border)}
.ud-title{font-weight:700;font-size:14px}
.ud-sub{font-size:11px;margin-top:2px}
.ud-stats{padding:8px 12px}
.ud-loading{padding:20px 0;text-align:center;font-size:13px}
.ud-stat{padding:10px;background:var(--panel2);border-radius:10px}
.ud-k{font-size:12px;color:var(--muted)}
.ud-v{font-size:18px;font-weight:700;color:var(--text);margin-top:2px}
.ud-v small{font-size:11px;font-weight:400;color:var(--muted);margin-left:3px}
.ud-sub2{font-size:11px;margin-top:3px}
.ud-grid{display:grid;gap:8px}
.ud-grid-2{grid-template-columns:1fr 1fr}
.ud-grid-3{grid-template-columns:repeat(3,1fr);margin-top:10px;padding-top:10px;border-top:1px solid var(--border)}
/* 小计数：左对齐 + 左侧彩色竖线（每项不同色） */
.ud-mini{background:transparent;border-radius:6px;padding:4px 10px;border-left:3px solid var(--accent)}
.ud-mini.c-user{border-left-color:#2563eb}
.ud-mini.c-share{border-left-color:#16a34a}
.ud-mini.c-buy{border-left-color:#d97706}
.ud-mk{font-size:11px;color:var(--muted)}
.ud-mv{font-size:17px;font-weight:700;margin-top:1px}
.ud-links{padding:6px 8px;border-top:1px solid var(--border)}
.ud-link{display:block;padding:8px 10px;border-radius:8px;color:var(--text2);font-size:13px}
.ud-link:hover{background:var(--panel2);color:var(--accent);text-decoration:none}
.ud-foot{padding:10px 12px;border-top:1px solid var(--border);display:flex;justify-content:flex-end}
.ud-logout{width:100%}
.content{padding:24px 16px 88px}
/* 固定底部状态栏：技术栈字样 + GitHub 开源链接 */
.footer-bar{position:fixed;left:0;right:0;bottom:0;background:var(--bg2);border-top:1px solid var(--border);z-index:40;backdrop-filter:saturate(1.4)}
.footer-inner{display:flex;align-items:center;justify-content:space-between;gap:12px;height:44px;flex-wrap:wrap;font-size:12px;color:var(--muted)}
.gh-link{display:inline-flex;align-items:center;gap:5px;color:var(--muted);padding:3px 10px;border-radius:8px;border:1px solid var(--border);transition:all .15s}
.gh-link:hover{color:var(--accent);border-color:var(--accent);text-decoration:none;background:var(--panel2)}
@media(max-width:600px){.footer-inner{justify-content:center;text-align:center;height:auto;padding:8px 16px}}
/* 底部状态栏样式见 .footer-bar / .footer-inner */

/* 主题切换按钮：三态图标显示 */
.theme-toggle{position:relative;width:34px;height:34px;padding:0;text-align:center;line-height:32px}
.theme-toggle .theme-ico{display:none}
.theme-toggle[data-mode="auto"] .theme-ico-auto,
.theme-toggle[data-mode="light"] .theme-ico-light,
.theme-toggle[data-mode="dark"] .theme-ico-dark{display:inline}

/* ===== 上传悬浮按钮 + 拖拽蒙层（管理员） ===== */
.fab{position:fixed;right:max(24px,calc((100vw - 1140px) / 2));bottom:64px;width:56px;height:56px;border-radius:50%;border:none;cursor:pointer;font-size:30px;line-height:1;color:#fff;background:linear-gradient(135deg,var(--accent),var(--accent2));box-shadow:0 6px 20px rgba(37,99,235,.45);z-index:60;display:flex;align-items:center;justify-content:center;transition:transform .15s,box-shadow .15s}
.fab:hover{transform:translateY(-3px) scale(1.06);box-shadow:0 10px 28px rgba(37,99,235,.6)}
.fab:active{transform:translateY(-1px) scale(1.02)}
.drop-overlay{position:fixed;inset:0;background:rgba(37,99,235,.18);backdrop-filter:blur(3px);z-index:500;display:flex;align-items:center;justify-content:center;pointer-events:none}
.drop-hint{background:var(--panel);border:2px dashed var(--accent);border-radius:16px;padding:36px 56px;font-size:18px;font-weight:600;color:var(--accent);box-shadow:var(--shadow-lg)}

/* 按钮 */
.btn{display:inline-flex;align-items:center;gap:6px;background:var(--panel);color:var(--text);border:1px solid var(--border);padding:8px 16px;border-radius:8px;cursor:pointer;font:inherit;font-weight:500;transition:all .15s;text-decoration:none}
.btn:hover{border-color:var(--accent);color:var(--accent);text-decoration:none;transform:translateY(-1px)}
.btn-primary{background:linear-gradient(135deg,var(--accent),var(--accent2));border-color:transparent;color:#fff}
.btn-primary:hover{color:#fff;filter:brightness(1.08);transform:translateY(-1px)}
.btn-danger{background:var(--err);border-color:var(--err);color:#fff}
.btn-danger:hover{color:#fff;filter:brightness(1.08)}
.btn-sm{padding:5px 11px;font-size:13px}
.btn-ghost{background:transparent;border-color:transparent;color:var(--text2)}
.btn-ghost:hover{background:var(--panel2);color:var(--accent);transform:none}

.panel{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:var(--shadow)}
.panel h2{margin:0 0 4px;font-size:18px}
table.files{width:100%;border-collapse:collapse}
table.files th,table.files td{padding:11px 12px;text-align:left;border-bottom:1px solid var(--border)}
table.files th{color:var(--muted);font-weight:500;font-size:12px;text-transform:uppercase;letter-spacing:.04em}
table.files tbody tr{transition:background .12s}
table.files tbody tr:hover{background:var(--panel2)}
table.files tbody tr{cursor:default}
.muted{color:var(--muted)}
.row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.row.between{justify-content:space-between}
.input,select,textarea{background:var(--bg2);border:1px solid var(--border);color:var(--text);padding:9px 12px;border-radius:8px;font:inherit;width:100%;transition:border .15s}
.input:focus,select:focus,textarea:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
label{display:block;margin:10px 0 4px;color:var(--muted);font-size:13px}
.grid{display:grid;gap:16px}
@media(min-width:700px){.grid-2{grid-template-columns:1fr 1fr}}
.price{color:var(--warn);font-weight:600}
.free{color:var(--ok);font-weight:600}
.tag{display:inline-block;background:var(--panel2);border:1px solid var(--border);padding:3px 10px;border-radius:14px;font-size:12px;color:var(--text2);text-decoration:none}
.tag:hover,.tag.active{background:var(--accent-soft);color:var(--accent);border-color:var(--accent-soft);text-decoration:none}
.center{text-align:center}
.notice{padding:12px 16px;border-radius:8px;margin:12px 0;font-size:13px}
.notice.err{background:rgba(220,38,38,.1);border:1px solid var(--err);color:var(--err)}
.notice.ok{background:rgba(22,163,74,.1);border:1px solid var(--ok);color:var(--ok)}

/* ===== 网格视图 ===== */
.file-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}
.file-card{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:14px;text-align:center;cursor:default;transition:all .15s;position:relative;user-select:none}
.file-card:hover{border-color:var(--accent);box-shadow:var(--shadow-lg);transform:translateY(-2px)}
.file-card .ficon{font-size:40px;line-height:1;margin-bottom:8px}
.file-card .fname{font-size:13px;font-weight:500;color:var(--text);word-break:break-all;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:38px}
.file-card .fmeta{font-size:11px;color:var(--muted);margin-top:6px}
.file-card .fprice{margin-top:6px}

/* 文件类型图标颜色 */
.ficon.zip{color:#d97706}.ficon.img{color:#16a34a}.ficon.doc{color:#2563eb}.ficon.vid{color:#dc2626}.ficon.audio{color:#9333ea}.ficon.code{color:#0891b2}
/* 图片缩略图（网格视图） */
.fthumb{display:block;width:100%;height:96px;object-fit:cover;border-radius:8px;margin-bottom:8px;background:var(--panel2)}

/* 视图切换 */
.view-switch{display:inline-flex;background:var(--panel2);border:1px solid var(--border);border-radius:8px;padding:2px}
.view-switch button{background:transparent;border:none;padding:6px 12px;border-radius:6px;cursor:pointer;color:var(--muted);font:inherit;font-size:13px}
.view-switch button.active{background:var(--panel);color:var(--accent);box-shadow:var(--shadow)}

/* ===== 右键菜单 ===== */
.ctxmenu{position:fixed;z-index:9999;background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:6px;min-width:170px;box-shadow:var(--shadow-lg)}
.ctx-item{display:flex;align-items:center;gap:8px;width:100%;padding:8px 12px;border:none;background:transparent;color:var(--text);font:inherit;font-size:13px;border-radius:6px;cursor:pointer;text-decoration:none;text-align:left}
.ctx-item:hover{background:var(--panel2);color:var(--accent);text-decoration:none}
.ctx-item.danger{color:var(--err)}
.ctx-item.danger:hover{background:rgba(220,38,38,.1);color:var(--err)}
.ctx-sep{height:1px;background:var(--border);margin:4px 0}
.ctx-item .ico{width:16px;display:inline-block;text-align:center}

/* ===== 模态弹窗 ===== */
.modal-overlay{position:fixed;inset:0;background:rgba(15,23,42,.5);backdrop-filter:blur(2px);z-index:1000;display:flex;align-items:center;justify-content:center;padding:16px;animation:fade .15s}
.modal{background:var(--panel);border:1px solid var(--border);border-radius:14px;box-shadow:var(--shadow-lg);width:100%;max-width:460px;max-height:90vh;overflow:auto}
.modal-head{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border)}
.modal-head h3{margin:0;font-size:16px}
.modal-body{padding:20px}
.modal-foot{display:flex;gap:10px;justify-content:flex-end;padding:14px 20px;border-top:1px solid var(--border)}
.modal-x{background:none;border:none;font-size:20px;color:var(--muted);cursor:pointer;padding:0 4px;line-height:1}
.modal-x:hover{color:var(--text)}
@keyframes fade{from{opacity:0}to{opacity:1}}
@keyframes pop{0%{opacity:0;transform:scale(.9) translateY(16px)}60%{opacity:1;transform:scale(1.02) translateY(-2px)}100%{opacity:1;transform:none}}
.modal{animation:pop .32s cubic-bezier(.22,1,.36,1)}
/* 关闭动画：遮罩淡出 + 弹窗缩小下移消失 */
.modal-overlay.closing{animation:fadeOut .2s forwards}
.modal.closing{animation:popOut .2s cubic-bezier(.4,0,1,1) forwards}
@keyframes fadeOut{to{opacity:0}}
@keyframes popOut{to{opacity:0;transform:scale(.94) translateY(12px)}}

@media(max-width:600px){
  .nav{height:auto;padding:10px 0;gap:8px}
  .brand{font-size:15px}
  .file-grid{grid-template-columns:repeat(auto-fill,minmax(110px,1fr))}
}
`;
