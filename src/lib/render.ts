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

  // ── 浏览器端 ZIP 打包（STORE 不压缩），零依赖 ──
  var CRC_TAB=(function(){var t=new Uint32Array(256);for(var n=0;n<256;n++){var c=n;for(var k=0;k<8;k++){c=(c&1)?(0xedb88320^(c>>>1)):(c>>>1);}t[n]=c;}return t;})();
  function crc32(data){var crc=0xffffffff;for(var i=0;i<data.length;i++){crc=CRC_TAB[(crc^data[i])&0xff]^(crc>>>8);}return (crc^0xffffffff)>>>0;}
  function buildZip(entries){
    // entries: [{path, data, isDir}]
    var metas=[], offset=0, FLAG=0x800, DT=0x0000, DD=0x0021;
    for(var i=0;i<entries.length;i++){
      var e=entries[i];
      var p=String(e.path).replace(/\\\\\\\\/g,'/');
      var isDir=!!e.isDir||p.charAt(p.length-1)==='/';
      if(isDir&&p.charAt(p.length-1)!=='/')p+='/';
      var name=new TextEncoder().encode(p);
      var data=isDir?new Uint8Array(0):e.data;
      var crc=isDir?0:crc32(data);
      metas.push({name:name,data:data,crc:crc,isDir:isDir,off:offset});
      offset+=30+name.length+data.length;
    }
    var cdSize=0;for(var j=0;j<metas.length;j++){cdSize+=46+metas[j].name.length;}
    var buf=new Uint8Array(offset+cdSize+22), dv=new DataView(buf.buffer), pos=0;
    function w16(v){dv.setUint16(pos,v,true);pos+=2;}
    function w32(v){dv.setUint32(pos,v,true);pos+=4;}
    // local headers + data
    for(var a=0;a<metas.length;a++){var m=metas[a];
      w32(0x04034b50);w16(20);w16(FLAG);w16(0);w16(DT);w16(DD);w32(m.crc);w32(m.data.length);w32(m.data.length);w16(m.name.length);w16(0);
      buf.set(m.name,pos);pos+=m.name.length;buf.set(m.data,pos);pos+=m.data.length;
    }
    var cdStart=pos;
    for(var b=0;b<metas.length;b++){var c=metas[b];
      w32(0x02014b50);w16(20);w16(20);w16(FLAG);w16(0);w16(DT);w16(DD);w32(c.crc);w32(c.data.length);w32(c.data.length);w16(c.name.length);w16(0);w16(0);w16(0);w16(0);w32(c.isDir?0x10:0);w32(c.off);
      buf.set(c.name,pos);pos+=c.name.length;
    }
    var cdEnd=pos;
    w32(0x06054b50);w16(0);w16(0);w16(metas.length);w16(metas.length);w32(cdEnd-cdStart);w32(cdStart);w16(0);
    return buf;
  }

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
          '<label>或选择文件夹（自动打包为 .zip）</label>'+
          '<input class="input" type="file" id="upFolder" webkitdirectory directory multiple style="padding:6px;font-size:12px">'+
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
      // 选文件夹：遍历 webkitRelativePath 打包成 zip，回填到 upFile
      var folderInput=document.getElementById('upFolder');
      if(folderInput){
        folderInput.addEventListener('change',function(){
          var files=folderInput.files;
          if(!files||!files.length) return;
          var items=[];
          for(var i=0;i<files.length;i++){
            var rp=files[i].webkitRelativePath||files[i].name;
            items.push({path:rp, file:files[i]});
          }
          // 顶层文件夹名
          var top=(items[0].path.split('/')[0])||'folder';
          packAndOpen(items, top, input, m);
        });
      }
      m.querySelectorAll('.modal-foot .btn').forEach(function(b){
        if(b.hasAttribute('data-submit')) b.onclick=function(){
          submitUpload(document.getElementById('upForm'), b, m);
        };
        else b.onclick=function(){ m.remove(); };
      });
    });
  }

  // 把多文件打包成 zip，回填到文件输入框，并更新提示
  function packAndOpen(items, folderName, fileInput, modal){
    var progEl=modal.querySelector('.modal-body');
    // 显示打包进度
    var prog=document.createElement('div');
    prog.className='notice ok';
    prog.textContent='正在打包 '+items.length+' 个文件…';
    progEl.insertBefore(prog, progEl.firstChild);
    // 异步读取所有文件为 Uint8Array
    var entries=[], done=0, total=items.length;
    function readNext(idx){
      if(idx>=total){
        // 全部读完，构造 zip
        try{
          var zipBytes=buildZip(entries);
          var zipFile=new File([zipBytes], folderName+'.zip', {type:'application/zip'});
          var dtx=new DataTransfer(); dtx.items.add(zipFile); fileInput.files=dtx.files; fileInput.hidden=true;
          prog.className='notice ok';
          prog.textContent='✅ 已打包 '+folderName+'.zip（'+humanS(zipBytes.size)+'，'+total+' 个文件），可设置分类/价格后上传。';
          // 更新顶部文件名提示
          var fnEl=progEl.querySelector('.muted');
          if(fnEl) fnEl.innerHTML='🗜️ '+escapeText(folderName)+'.zip <small>('+humanS(zipBytes.size)+')</small>';
        }catch(err){
          prog.className='notice err';
          prog.textContent='打包失败：'+(err&&err.message||err);
        }
        return;
      }
      var it=items[idx];
      var reader=new FileReader();
      reader.onload=function(){
        var data=new Uint8Array(reader.result);
        entries.push({path:it.path, data:data});
        done++;
        prog.textContent='正在打包 '+done+'/'+total+' 个文件…';
        readNext(idx+1);
      };
      reader.onerror=function(){
        prog.className='notice err';
        prog.textContent='读取文件失败：'+it.path;
      };
      reader.readAsArrayBuffer(it.file);
    }
    readNext(0);
  }

  // 异步上传：fetch + FormData，成功后弹 toast + 关弹窗 + 刷新列表，不整页跳转
  function submitUpload(form, btn, modal){
    if(!form) return;
    var fd=new FormData(form);
    var fileInput=form.querySelector('[name="file"]');
    if(!fileInput||!fileInput.files||!fileInput.files.length){
      showToast('请选择文件','err'); return;
    }
    var fileName=fileInput.files[0].name;
    btn.disabled=true; var origText=btn.textContent; btn.textContent='上传中…';
    fetch('/upload',{method:'POST',body:fd,headers:{'Accept':'application/json','X-Requested-With':'fetch'}}).then(function(r){
      return r.json().then(function(j){return {status:r.status, json:j};}).catch(function(){
        return {status:r.status, json:{ok:false,error:'HTTP '+r.status}};
      });
    }).then(function(res){
      btn.disabled=false; btn.textContent=origText;
      if(res.json && res.json.ok){
        if(modal){ var inner=modal.querySelector('.modal'); modal.classList.add('closing'); if(inner)inner.classList.add('closing'); setTimeout(function(){modal.remove();},200); }
        showToast('✅ '+fileName+' 上传成功','ok', res.json.url);
        // 延迟刷新列表，让 toast 先显示
        setTimeout(function(){ location.reload(); }, 1200);
      } else {
        var errMsg=(res.json&&res.json.error)||('上传失败 HTTP '+res.status);
        if(/auth|登录|login/i.test(errMsg)){ errMsg='登录已过期，请重新登录'; }
        showToast('上传失败：'+(errMsg||'').slice(0,60),'err');
      }
    }).catch(function(e){
      btn.disabled=false; btn.textContent=origText;
      showToast('上传出错：'+(e&&e.message||e),'err');
    });
  }

  // 悬浮通知（toast）：右上角滑入，自动消失
  // 暴露 toast 给其它脚本（list/detail 删除用）
  window.showToast=function(msg,type,link){ showToast(msg,type,link); };
  function showToast(msg, type, link){
    var box=document.getElementById('toastBox');
    if(!box){
      box=document.createElement('div'); box.id='toastBox'; box.className='toast-box';
      document.body.appendChild(box);
    }
    var t=document.createElement('div'); t.className='toast toast-'+(type||'ok');
    var html='<span class="toast-msg">'+escapeText(msg)+'</span>';
    if(link){ html+='<a class="toast-link" href="'+escapeText(link)+'">查看</a>'; }
    t.innerHTML=html;
    box.appendChild(t);
    // 触发滑入动画：双重 rAF 确保浏览器先以初始态（translateX(120%)）渲染一帧，
    // 再加 show 类，transition 才会真正播放（单次 rAF 在同帧 append 时会失效）
    requestAnimationFrame(function(){
      requestAnimationFrame(function(){ t.classList.add('show'); });
    });
    var timer=setTimeout(function(){ dismiss(t); }, type==='err'?6000:3500);
    function dismiss(el){
      el.classList.remove('show'); el.classList.add('hide');
      // transition transform/opacity 均 .4s，等动画播完再移除 DOM
      setTimeout(function(){ el.remove(); }, 420);
    }
    t.addEventListener('click',function(){ clearTimeout(timer); dismiss(t); });
  }

  function escapeText(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;');}
  function humanS(b){if(b<1024)return b+' B';var u=['KB','MB','GB','TB'],v=b/1024,i=0;while(v>=1024&&i<u.length-1){v/=1024;i++;}return v.toFixed(v>=100?0:1)+' '+u[i];}
  function openModalX(title, bodyHtml, footHtml){
    var ov=document.createElement('div');ov.className='modal-overlay';
    ov.innerHTML='<div class="modal"><div class="modal-head"><h3>'+title+'</h3><button class="modal-x" type="button">×</button></div><div class="modal-body">'+bodyHtml+'</div>'+(footHtml?'<div class="modal-foot">'+footHtml+'</div>':'')+'</div>';
    var inner=ov.querySelector('.modal');
    var closed=false;
    function close(){
      if(closed) return; closed=true;
      ov.classList.add('closing');
      if(inner) inner.classList.add('closing');
      setTimeout(function(){ ov.remove(); }, 200);
    }
    ov.addEventListener('click',function(e){if(e.target===ov||e.target.classList.contains('modal-x'))close();});
    document.addEventListener('keydown',function esc(e){if(e.key==='Escape'){close();document.removeEventListener('keydown',esc);}});
    document.body.appendChild(ov);return ov;
  }

  // ── webkitGetAsEntry 递归：把拖入的 DataTransfer 转成 [{path,file}] 列表 ──
  function readEntry(entry, path, out, cb){
    if(entry.isFile){
      entry.file(function(f){ out.push({path:path+entry.name, file:f}); cb(); },
        function(){ cb(); });
    } else if(entry.isDirectory){
      var reader=entry.createReader();
      var allEntries=[];
      var readBatch=function(){
        reader.readEntries(function(batch){
          if(!batch.length){
            // 子目录读完，递归每个子项
            var i=0;
            (function next(){
              if(i>=allEntries.length){ cb(); return; }
              readEntry(allEntries[i], path+entry.name+'/', out, function(){ i++; next(); });
            })();
            return;
          }
          allEntries=allEntries.concat(Array.prototype.slice.call(batch));
          readBatch();
        }, function(){ cb(); });
      };
      readBatch();
    } else { cb(); }
  }
  function readDroppedItems(dataTransfer, cb){
    var items=dataTransfer.items;
    if(items&&items.length&&items[0].webkitGetAsEntry){
      var entries=[], got=0, total=items.length;
      for(var i=0;i<items.length;i++){
        var entry=items[i].webkitGetAsEntry();
        if(entry){ entries.push(entry); }
        else { total--; }
      }
      if(!entries.length){ cb(null); return; }
      var out=[], done=0;
      for(var j=0;j<entries.length;j++){
        readEntry(entries[j], '', out, function(){
          done++;
          if(done>=entries.length){ cb({items:out, isFolder:entries.length===1&&entries[0].isDirectory, topName:entries[0].isDirectory?entries[0].name:(entries.length>1?'files':null)}); }
        });
      }
    } else {
      // 降级：无 webkitGetAsEntry，直接用 files
      var fs=dataTransfer.files, arr=[];
      for(var k=0;k<fs.length;k++) arr.push({path:fs[k].name, file:fs[k]});
      cb(arr.length?{items:arr, isFolder:false, topName:null}:null);
    }
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
    if(!e.dataTransfer) return;
    e.preventDefault(); dragDepth=0; overlay.hidden=true;
    readDroppedItems(e.dataTransfer, function(res){
      if(!res){ return; }
      // 单个文件（非文件夹）→ 直接上传
      if(res.items.length===1 && !res.isFolder){
        openUploadModal(res.items[0].file);
        return;
      }
      // 文件夹或多文件 → 打包成 zip
      fetchCats(function(cats){
        var folderName=res.topName||(res.items[0].path.split('/')[0])||'files';
        var body='<form id="upForm" method="post" action="/upload" enctype="multipart/form-data">'+
          '<div id="packStatus" class="notice ok">正在打包 '+res.items.length+' 个文件…</div>'+
          '<label>ZIP 文件名</label>'+
          '<input class="input" name="_zipname" id="zipName" value="'+escapeText(folderName)+'.zip">'+
          '<label>分类</label>'+
          '<input class="input" name="category" list="upCatlist2" placeholder="可选">'+
          '<datalist id="upCatlist2">'+cats+'</datalist>'+
          '<label>描述</label>'+
          '<textarea class="input" name="description" rows="2" placeholder="可选"></textarea>'+
          '<label>价格（积分，0=免费）</label>'+
          '<input class="input" type="number" name="price" min="0" step="1" value="0">'+
          '<input type="hidden" name="file" id="upFile">'+
        '</form>';
        var foot='<button class="btn" type="button">取消</button><button class="btn btn-primary" type="button" data-submit disabled>上传</button>';
        var m=openModalX('打包上传', body, foot);
        var fileInput=document.getElementById('upFile');
        var submitBtn=m.querySelector('[data-submit]');
        var nameInput=document.getElementById('zipName');
        // 打包
        var entries=[], done=0, total=res.items.length;
        function readNext(idx){
          if(idx>=total){
            try{
              var zipBytes=buildZip(entries);
              var finalName=(nameInput.value||folderName).replace(/\\.zip$/i,'')+'.zip';
              var zipFile=new File([zipBytes], finalName, {type:'application/zip'});
              var dtx=new DataTransfer(); dtx.items.add(zipFile); fileInput.files=dtx.files;
              var st=document.getElementById('packStatus');
              st.className='notice ok';
              st.textContent='✅ 已打包 '+finalName+'（'+humanS(zipBytes.size)+'，'+total+' 个文件）';
              submitBtn.disabled=false;
            }catch(err){
              var st2=document.getElementById('packStatus');
              st2.className='notice err';
              st2.textContent='打包失败：'+(err&&err.message||err);
            }
            return;
          }
          var it=res.items[idx];
          var reader=new FileReader();
          reader.onload=function(){
            entries.push({path:it.path, data:new Uint8Array(reader.result)});
            done++;
            var st=document.getElementById('packStatus');
            if(st) st.textContent='正在打包 '+done+'/'+total+' 个文件…';
            readNext(idx+1);
          };
          reader.readAsArrayBuffer(it.file);
        }
        readNext(0);
        m.querySelectorAll('.modal-foot .btn').forEach(function(b){
          if(b.hasAttribute('data-submit')) b.onclick=function(){ if(!b.disabled) submitUpload(document.getElementById('upForm'), b, m); };
          else b.onclick=function(){ m.remove(); };
        });
      });
    });
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

/* ===== 悬浮通知 toast ===== */
.toast-box{position:fixed;top:72px;right:max(16px,calc((100vw - 1140px)/2));z-index:3000;display:flex;flex-direction:column;gap:10px;max-width:360px;pointer-events:none}
.toast{display:flex;align-items:center;gap:10px;background:var(--panel);border:1px solid var(--border);border-left:4px solid var(--accent);border-radius:10px;padding:12px 16px;box-shadow:var(--shadow-lg);cursor:pointer;pointer-events:auto;opacity:0;transform:translateX(140%) scale(.9);transition:opacity .35s cubic-bezier(.22,1,.36,1),transform .4s cubic-bezier(.22,1,.36,1)}
.toast.show{opacity:1;transform:none}
.toast.hide{opacity:0;transform:translateX(140%) scale(.9)}
.toast-ok{border-left-color:var(--ok)}
.toast-err{border-left-color:var(--err)}
.toast-msg{flex:1;font-size:13px;color:var(--text);word-break:break-all}
.toast-link{color:var(--accent);font-size:12px;white-space:nowrap}
.toast-link:hover{text-decoration:underline}

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

/* 详情弹窗：图片左右两栏布局 */
.dtl-layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(240px,300px);gap:20px;align-items:start}
.dtl-preview{min-width:0}
/* 详情图：按原比例完整展示，宽度自适应左栏（不设固定高度，不裁剪） */
.dtl-thumb{display:block;width:100%;height:auto;max-height:70vh;object-fit:contain;border-radius:10px;background:var(--panel2);box-shadow:var(--shadow)}
.dtl-info{min-width:0}
/* 窄屏：两栏堆叠成单列 */
@media(max-width:640px){.dtl-layout{grid-template-columns:1fr}.dtl-thumb{max-height:50vh}}

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
.modal{background:var(--panel);border:1px solid var(--border);border-radius:14px;box-shadow:var(--shadow-lg);width:100%;max-width:760px;max-height:90vh;overflow:auto}
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
