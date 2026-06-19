/**
 * HTML 渲染外壳：layout、转义、导航栏（含登录态）。
 * 视图函数返回 HTML 片段，由 layout() 包裹。
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

  const userArea = session
    ? `<span class="user">
         ${session.avatarUrl ? `<img src="${escapeHtml(session.avatarUrl)}" alt="" class="avatar">` : ""}
         <span class="uname">${escapeHtml(session.name || session.username)}</span>
         ${session.isAdmin ? '<span class="badge">管理员</span>' : ""}
         <form method="post" action="/auth/logout" style="display:inline">
           <button type="submit" class="btn btn-sm">退出</button>
         </form>
       </span>`
    : `<a class="btn btn-sm" href="/auth/login">使用 LINUX DO 登录</a>`;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(fullTitle)}</title>
<style>${STYLES}</style>
${opts.extraHead ?? ""}
</head>
<body>
<header class="topbar">
  <div class="wrap nav">
    <a href="/" class="brand">📁 ${escapeHtml(config.siteName)}</a>
    <nav class="links">
      ${navItem("/", "文件", opts.current ?? "")}
      ${session?.isAdmin ? navItem("/upload", "上传", opts.current ?? "") : ""}
    </nav>
    <div class="spacer"></div>
    ${userArea}
  </div>
</header>
<main class="wrap content">
${body}
</main>
<footer class="wrap footer">
  <span>基于 Cloudflare Workers · LINUX DO Connect · LINUX DO Credit</span>
</footer>
</body>
</html>`;
}

const STYLES = `
:root{
  --bg:#0d1117; --panel:#161b22; --border:#30363d; --text:#e6edf3; --muted:#8b949e;
  --accent:#2f81f7; --accent2:#1f6feb; --ok:#3fb950; --warn:#d29922; --err:#f85149;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
.wrap{max-width:1080px;margin:0 auto;padding:0 16px}
.topbar{background:var(--panel);border-bottom:1px solid var(--border);position:sticky;top:0;z-index:10}
.nav{display:flex;align-items:center;gap:16px;height:56px}
.brand{font-weight:600;font-size:16px;color:var(--text)}
.nav .links{display:flex;gap:12px}
.nav .links a{color:var(--muted);padding:6px 10px;border-radius:6px}
.nav .links a.active,.nav .links a:hover{background:#21262d;color:var(--text);text-decoration:none}
.nav .spacer{flex:1}
.user{display:flex;align-items:center;gap:8px}
.avatar{width:24px;height:24px;border-radius:50%;vertical-align:middle}
.uname{color:var(--text)}
.badge{background:var(--accent);color:#fff;font-size:11px;padding:1px 6px;border-radius:10px}
.content{padding:24px 16px 64px}
.footer{color:var(--muted);font-size:12px;padding:24px 16px;border-top:1px solid var(--border);margin-top:32px}
.btn{display:inline-block;background:var(--panel);color:var(--text);border:1px solid var(--border);padding:8px 16px;border-radius:6px;cursor:pointer;font-size:14px}
.btn:hover{border-color:var(--accent);text-decoration:none}
.btn-primary{background:var(--accent2);border-color:var(--accent2);color:#fff}
.btn-primary:hover{background:var(--accent)}
.btn-sm{padding:4px 10px;font-size:13px}
.panel{background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:20px;margin-bottom:16px}
table.files{width:100%;border-collapse:collapse}
table.files th,table.files td{padding:10px 12px;text-align:left;border-bottom:1px solid var(--border)}
table.files th{color:var(--muted);font-weight:500;font-size:13px}
.muted{color:var(--muted)}
.row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.input,select,textarea{background:#0d1117;border:1px solid var(--border);color:var(--text);padding:8px 12px;border-radius:6px;font:inherit;width:100%}
label{display:block;margin:10px 0 4px;color:var(--muted)}
.grid{display:grid;gap:16px}
@media(min-width:700px){.grid-2{grid-template-columns:1fr 1fr}}
.price{color:var(--warn);font-weight:600}
.free{color:var(--ok);font-weight:600}
.tag{display:inline-block;background:#21262d;border:1px solid var(--border);padding:2px 8px;border-radius:10px;font-size:12px;color:var(--muted)}
.center{text-align:center}
.notice{padding:12px 16px;border-radius:6px;margin:12px 0}
.notice.err{background:rgba(248,81,73,.12);border:1px solid var(--err);color:var(--err)}
.notice.ok{background:rgba(63,185,80,.12);border:1px solid var(--ok);color:var(--ok)}
`;
