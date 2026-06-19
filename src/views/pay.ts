/**
 * 支付相关视图：跳转等待页、结果页。
 */
import type { RenderCtx } from "../lib/render";
import { layout } from "../lib/render";

/** 即将跳转到 credit 平台的提示页（含 meta refresh 兜底） */
export function renderRedirecting(rctx: RenderCtx, target: string): string {
  const body = `
    <div class="panel center">
      <h2>正在跳转到 LINUX DO Credit…</h2>
      <p class="muted">即将转至积分认证页完成扣分，请稍候。</p>
      <p><a class="btn btn-primary" href="${target}">如未自动跳转，点这里</a></p>
    </div>
    <meta http-equiv="refresh" content="2;url=${target}">`;
  return layout(rctx, "跳转中", body, { current: "" });
}

interface ResultInfo {
  ok: boolean;
  orderId?: string;
  message?: string;
  /** 支付成功的文件名（用于在结果页展示） */
  fileName?: string;
  /** 下载令牌；存在则结果页展示下载按钮并自动触发下载 */
  downloadToken?: string;
  /** "返回"链接：登录用户回文件列表，访客回分享提取页 */
  backHref?: string;
}

export function renderResult(rctx: RenderCtx, info: ResultInfo): string {
  const cls = info.ok ? "ok" : "err";
  const icon = info.ok ? "✅" : "❌";
  const title = info.ok ? "支付成功" : "支付未完成";
  const backHref = info.backHref || "/";
  const downloadUrl = info.downloadToken ? `/dl/${info.downloadToken}` : null;

  const downloadBlock = downloadUrl
    ? `
      <div class="pay-download">
        <p class="muted" id="dlcountdown">即将开始下载…</p>
        <p>
          <a class="btn btn-primary" id="dlink" href="${downloadUrl}">⬇️ 立即下载${info.fileName ? `：${info.fileName}` : ""}</a>
        </p>
      </div>`
    : "";

  const body = `
    <div class="panel center">
      <h2>${icon} ${title}</h2>
      <div class="notice ${cls}">${info.message ?? ""}</div>
      ${info.fileName ? `<p class="muted">文件：${info.fileName}</p>` : ""}
      ${info.orderId ? `<p class="muted">订单号：${info.orderId}</p>` : ""}
      ${downloadBlock}
      <p><a class="btn" href="${backHref}">返回文件列表</a></p>
    </div>
    ${downloadUrl ? `<script>
    (function(){
      var left = 3;
      var el = document.getElementById('dlcountdown');
      var link = document.getElementById('dlink');
      var iv = setInterval(function(){
        left--;
        if (left <= 0){
          clearInterval(iv);
          if (el) el.textContent = '正在下载…';
          if (link) location.href = link.href;
        } else if (el) {
          el.textContent = left + ' 秒后开始下载，点上方按钮可立即下载。';
        }
      }, 1000);
    })();
    </script>` : ""}`;
  return layout(rctx, title, body, { current: "" });
}

/** 等待回调的轮询页 */
export function renderWaiting(rctx: RenderCtx, orderId: string): string {
  const body = `
    <div class="panel center">
      <h2>⏳ 等待支付结果…</h2>
      <p class="muted">订单 ${orderId}：正在确认积分扣减结果。</p>
      <p class="muted" id="status">查询中…</p>
    </div>
    <script>
    (function(){
      const oid = ${JSON.stringify(orderId)};
      const el = document.getElementById('status');
      let n = 0;
      const iv = setInterval(async ()=>{
        n++;
        try{
          const r = await fetch('/pay/status?id='+encodeURIComponent(oid));
          const j = await r.json();
          if(j.status==='paid'){ clearInterval(iv); location.href = '/pay/done?id='+encodeURIComponent(oid)+'&ok=1'; return; }
          if(j.status==='failed'){ clearInterval(iv); location.href = '/pay/done?id='+encodeURIComponent(oid)+'&ok=0'; return; }
        }catch(e){}
        if(n>40){ clearInterval(iv); el.textContent='超时，可稍后在订单页查看结果。'; }
      }, 2000);
    })();
    </script>`;
  return layout(rctx, "等待结果", body, { current: "" });
}
