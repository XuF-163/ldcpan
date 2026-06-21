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
<link rel="stylesheet" href="/assets/app.css">
<script src="/assets/theme-init.js"></script>
<script src="/assets/shared.js"></script>
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
<script src="/assets/ctxmenu.js"></script>
${session?.isAdmin ? `<script src="/assets/usermenu.js"></script>` : ""}
${session?.isAdmin && opts.current !== "/upload" ? `
<!-- 管理员：右下角上传悬浮按钮 + 拖拽上传 -->
<button class="fab" id="uploadFab" type="button" title="上传文件" aria-label="上传文件">+</button>
<div class="drop-overlay" id="dropOverlay" hidden><div class="drop-hint">📥 松开以上传文件</div></div>
<script src="/assets/upload.js"></script>` : ""}
</body>
</html>`;
}

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

