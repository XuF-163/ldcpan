/**
 * 本地端到端测试：通过 mock 服务器验证完整流程。
 *
 * 前置：
 *   1. 启动 mock 服务器：npm run mock  （端口 4000）
 *   2. 启动 wrangler dev：npm run dev   （端口 8787，读取 .dev.vars）
 *
 * 运行：npm run test:local
 *
 * 测试项：
 *   T1 健康检查
 *   T3 OAuth 登录闭环（PKCE → code → token → session cookie）
 *   T4 已登录访问首页
 *   T5 管理员上传文件
 *   T6 免费文件下载（R2 流式）
 *   T7 付费订单 EasyPay 积分扣费（create→submit表单→异步notify→paid）
 *   T8-T11 分享链接（免费下载/密码/吊销/次数）
 */
const WORKER = "http://localhost:8787";
const MOCK = "http://localhost:4000";

let pass = 0;
let fail = 0;
const cookies = new Map();

function assert(cond, msg) {
  if (cond) {
    pass++;
    console.log(`  ✅ ${msg}`);
  } else {
    fail++;
    console.log(`  ❌ ${msg}`);
  }
}

function parseCookies(setCookieHeaders) {
  if (!setCookieHeaders) return;
  const list = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
  for (const c of list) {
    const eq = c.indexOf("=");
    const semi = c.indexOf(";");
    if (eq > 0) {
      const name = c.slice(0, eq);
      const val = c.slice(eq + 1, semi > 0 ? semi : undefined);
      cookies.set(name, val);
    }
  }
}

function cookieHeader() {
  return Array.from(cookies.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

async function main() {
  console.log("\n=== 开始本地测试 ===\n");

  // ── T1 健康检查 ────────────────────────────────────────
  console.log("[T1] 健康检查");
  try {
    const r = await fetch(`${WORKER}/health`);
    const t = await r.text();
    assert(r.status === 200 && t === "ok", `GET /health 返回 ok（实际 ${r.status} ${t}）`);
  } catch (e) {
    assert(false, `无法连接 ${WORKER}，请先启动 npm run dev：${e.message}`);
    return finish();
  }

  // ── T3 OAuth 登录闭环 ──────────────────────────────────
  console.log("\n[T3] OAuth 登录闭环（PKCE）");
  let sessionOk = false;
  {
    // 1. 访问 /auth/login，拿到 302 和 state cookie
    const r1 = await fetch(`${WORKER}/auth/login`, { redirect: "manual" });
    parseCookies(r1.headers.getSetCookie?.() ?? r1.headers.get("set-cookie"));
    assert(r1.status === 302, `/auth/login 返回 302（实际 ${r1.status}）`);
    const location = r1.headers.get("location") || "";
    const authUrl = new URL(location);
    const state = authUrl.searchParams.get("state");
    const challenge = authUrl.searchParams.get("code_challenge");
    const method = authUrl.searchParams.get("code_challenge_method");
    assert(location.startsWith(MOCK), `跳转到 mock authorize`);
    assert(!!state, `携带 state 参数`);
    assert(!!challenge && method === "S256", `携带 PKCE challenge (S256)`);

    // 2. 直接请求 mock 的 authorize 拿 code（模拟用户授权）
    const r2 = await fetch(location, { redirect: "manual" });
    assert(r2.status === 302, `mock authorize 返回 302（实际 ${r2.status}）`);
    const callbackUrl = new URL(r2.headers.get("location") || "");
    const code = callbackUrl.searchParams.get("code");
    const cbState = callbackUrl.searchParams.get("state");
    assert(!!code, `mock 颁发 code`);
    assert(cbState === state, `回调 state 与发起一致（防 CSRF）`);

    // 3. 回调 Worker 换 token + 建 session
    const r3 = await fetch(`${WORKER}/auth/callback?code=${code}&state=${state}`, {
      redirect: "manual",
      headers: { Cookie: cookieHeader() },
    });
    parseCookies(r3.headers.getSetCookie?.() ?? r3.headers.get("set-cookie"));
    assert(r3.status === 302, `/auth/callback 返回 302（实际 ${r3.status}）`);
    assert(cookies.has("ldcpan_session"), `设置会话 cookie ldcpan_session`);
    sessionOk = cookies.has("ldcpan_session");
  }

  if (!sessionOk) {
    console.log("\n⚠️  登录失败，后续测试跳过");
    return finish();
  }

  // ── T4 已登录访问首页 ──────────────────────────────────
  console.log("\n[T4] 已登录访问首页");
  {
    const r = await fetch(`${WORKER}/`, { headers: { Cookie: cookieHeader() } });
    const html = await r.text();
    assert(r.status === 200, `首页返回 200（实际 ${r.status}）`);
    assert(html.includes("Alice"), `首页显示登录用户名 Alice`);
    assert(html.includes("管理员"), `首页显示管理员标识`);
  }

  // ── T5 管理员上传文件 ──────────────────────────────────
  console.log("\n[T5] 管理员上传文件（multipart）");
  let fileId = null;
  {
    const boundary = "----testboundary" + Math.random().toString(36).slice(2);
    const fileContent = "Hello, this is test file content. 测试内容。";
    const body =
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="test.txt"\r\n` +
      `Content-Type: text/plain\r\n\r\n` +
      `${fileContent}\r\n` +
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="price"\r\n\r\n` +
      `0\r\n` +
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="description"\r\n\r\n` +
      `测试文件\r\n` +
      `--${boundary}--\r\n`;

    const r = await fetch(`${WORKER}/upload`, {
      method: "POST",
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        Cookie: cookieHeader(),
      },
      body,
      redirect: "manual",
    });
    assert(r.status === 302, `上传返回 302（实际 ${r.status}）`);
    const loc = r.headers.get("location") || "";
    const m = /\/f\/([a-z0-9]+)/.exec(loc);
    if (m) {
      fileId = m[1];
      assert(true, `上传成功，文件 id=${fileId}`);
    } else {
      assert(false, `无法从跳转解析文件 id：${loc}`);
    }
  }

  // ── T6 免费文件下载 ────────────────────────────────────
  if (fileId) {
    console.log("\n[T6] 免费文件下载（R2 流式）");
    // 6a. 详情页
    {
      const r = await fetch(`${WORKER}/f/${fileId}`, { headers: { Cookie: cookieHeader() } });
      const html = await r.text();
      assert(r.status === 200, `详情页返回 200`);
      assert(html.includes("test.txt"), `详情页显示文件名`);
      assert(html.includes("免费"), `详情页显示免费标识`);
    }
    // 6b. 下载（/dl/free → 302 到 /dl/:token → 文件内容）
    {
      const r1 = await fetch(`${WORKER}/dl/free?file_id=${fileId}`, {
        redirect: "manual",
        headers: { Cookie: cookieHeader() },
      });
      assert(r1.status === 302, `/dl/free 返回 302 签发令牌`);
      const tokenUrl = r1.headers.get("location") || "";
      const r2 = await fetch(`${WORKER}${tokenUrl}`, { headers: { Cookie: cookieHeader() } });
      const content = await r2.text();
      assert(r2.status === 200, `令牌下载返回 200`);
      assert(content.includes("test file content"), `下载内容正确`);
    }
    // 6c. 令牌一次性：再次下载同一令牌应 410
    {
      const r1 = await fetch(`${WORKER}/dl/free?file_id=${fileId}`, {
        redirect: "manual",
        headers: { Cookie: cookieHeader() },
      });
      const tokenUrl = r1.headers.get("location") || "";
      const r2 = await fetch(`${WORKER}${tokenUrl}`);
      assert(r2.status === 200, `首次消费令牌成功`);
      const r3 = await fetch(`${WORKER}${tokenUrl}`);
      assert(r3.status === 410, `令牌一次性：再次使用返回 410（实际 ${r3.status}）`);
    }
  }

  // ── T7 付费订单创建（验证签名）──────────────────────────
  console.log("\n[T7] 付费订单创建 + 签名验证");
  let paidFileId = null;
  {
    // 上传一个付费文件
    const boundary = "----pb" + Math.random().toString(36).slice(2);
    const body =
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="paid.zip"\r\n` +
      `Content-Type: application/zip\r\n\r\n` +
      `FAKE_ZIP_CONTENT\r\n` +
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="price"\r\n\r\n` +
      `3\r\n` +
      `--${boundary}--\r\n`;
    const up = await fetch(`${WORKER}/upload`, {
      method: "POST",
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        Cookie: cookieHeader(),
      },
      body,
      redirect: "manual",
    });
    const m = /\/f\/([a-z0-9]+)/.exec(up.headers.get("location") || "");
    if (m) {
      paidFileId = m[1];
      // 详情页应显示价格
      const d = await fetch(`${WORKER}/f/${paidFileId}`, { headers: { Cookie: cookieHeader() } });
      const dh = await d.text();
      assert(dh.includes("3 积分"), `付费文件详情显示 3 积分`);

      // 创建订单 → 返回自动提交表单（EasyPay POST 下单）
      const r = await fetch(`${WORKER}/pay/create?file_id=${paidFileId}`, {
        redirect: "manual",
        headers: { Cookie: cookieHeader() },
      });
      assert(r.status === 200, `/pay/create 返回 200（表单页）（实际 ${r.status}）`);
      const formHtml = await r.text();
      // 提取表单 action（submit.php URL）和所有 hidden 参数
      const actionM = /action="([^"]+)"/.exec(formHtml);
      assert(!!actionM, `表单含 action（submit.php）`);
      const actionUrl = actionM[1];
      assert(actionUrl.includes("/pay/submit.php"), `action 指向 submit.php（${actionUrl}）`);

      // 提取表单字段（含 sign / money / out_trade_no / pid 等）
      const fields = {};
      const fieldRe = /<input type="hidden" name="([^"]+)" value="([^"]*)">/g;
      let fm;
      while ((fm = fieldRe.exec(formHtml)) !== null) fields[fm[1]] = fm[2];

      assert(fields.pid === "test_client", `pid=test_client`);
      assert(fields.money === "3.00", `money 格式化=3.00（实际 ${fields.money}）`);
      assert(fields.type === "epay", `type=epay`);
      assert(!!fields.sign && fields.sign.length === 32, `sign 为 32 位 MD5`);
      const orderId = fields.out_trade_no;
      assert(!!orderId, `out_trade_no 存在`);

      // POST 到 mock submit.php → 验签 → 记订单 → 异步 notify + 302 跳 return_url
      const submitBody = new URLSearchParams(fields).toString();
      const r2 = await fetch(actionUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: submitBody,
        redirect: "manual",
      });
      assert(r2.status === 302, `mock submit.php 返回 302（跳 return_url）（实际 ${r2.status}）`);
      const returnUrl = r2.headers.get("location") || "";
      assert(returnUrl.includes("/pay/return"), `跳转到 /pay/return（${returnUrl.slice(0, 30)}）`);

      // 等待 mock 异步 notify 到达 Worker（markPaid 在 notify 里完成）
      await new Promise((res) => setTimeout(res, 600));

      // 访问 /pay/return?order=... → 订单已 paid → 跳结果页
      const r3 = await fetch(returnUrl, { redirect: "manual", headers: { Cookie: cookieHeader() } });
      assert(
        r3.status === 302 && (r3.headers.get("location") || "").includes("/pay/done"),
        `/pay/return 订单已支付 → 跳结果页（实际 ${r3.status} ${(r3.headers.get("location") || "").slice(0, 30)}）`,
      );

      // 结果页应展示文件名 + 下载按钮（含 /dl/ 令牌），而非直接 302 跳下载
      const doneUrl = (r3.headers.get("location") || "").startsWith("http")
        ? new URL(r3.headers.get("location")).pathname + "?id=" + orderId
        : `/pay/done?id=${orderId}`;
      const dr = await fetch(`${WORKER}${doneUrl}`, { headers: { Cookie: cookieHeader() } });
      const doneHtml = await dr.text();
      assert(dr.status === 200, `/pay/done 结果页返回 200（实际 ${dr.status}）`);
      assert(doneHtml.includes("立即下载"), `结果页展示下载按钮`);
      assert(/\/dl\/[A-Za-z0-9_-]+/.test(doneHtml), `结果页含下载令牌链接`);

      // 查订单状态
      const st = await fetch(`${WORKER}/pay/status?id=${orderId}`, {
        headers: { Cookie: cookieHeader() },
      });
      const sj = await st.json();
      assert(sj.status === "paid", `订单最终状态=paid（实际 ${sj.status}）`);
      console.log(`  ℹ️  订单 ${orderId} 经 EasyPay 异步通知扣分成功`);
    } else {
      assert(false, `付费文件上传失败`);
    }
  }

  // ── T8 分享链接：管理员创建免费分享，访客匿名下载 ──────────
  console.log("\n[T8] 分享链接（免费，匿名访客）");
  let freeShareId = null;
  if (fileId) {
    // 用之前 T5 上传的免费文件创建分享（无密码）
    const r = await fetch(`${WORKER}/admin/shares`, {
      method: "POST",
      headers: { Cookie: cookieHeader(), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ file_id: fileId }),
      redirect: "manual",
    });
    assert(r.status === 302, `创建分享返回 302（实际 ${r.status}）`);
    const loc = r.headers.get("location") || "";
    const m = /\/s\/([a-z0-9]+)/.exec(loc);
    if (m) {
      freeShareId = m[1];
      assert(true, `分享创建成功 id=${freeShareId}`);
    } else {
      assert(false, `无法解析分享 id：${loc}`);
    }

    if (freeShareId) {
      // 访客（不带 cookie）访问提取页
      const pg = await fetch(`${WORKER}/s/${freeShareId}`);
      const html = await pg.text();
      assert(pg.status === 200, `访客访问分享页 200（实际 ${pg.status}）`);
      assert(html.includes("test.txt"), `提取页显示文件名`);

      // 访客下载（不带 cookie）→ 302 到 /dl/:token
      const dl = await fetch(`${WORKER}/s/${freeShareId}/dl`, { redirect: "manual" });
      assert(dl.status === 302, `访客下载签发令牌 302（实际 ${dl.status}）`);
      const tokenUrl = dl.headers.get("location") || "";
      const dlReal = await fetch(`${WORKER}${tokenUrl}`); // 无 cookie
      const content = await dlReal.text();
      assert(dlReal.status === 200, `访客匿名下载 200（实际 ${dlReal.status}）`);
      assert(content.includes("test file content"), `访客下载内容正确`);
    }
  }

  // ── T9 分享链接：密码保护 ────────────────────────────────
  console.log("\n[T9] 分享链接（密码保护）");
  {
    // 为付费文件创建带密码的分享
    const r = await fetch(`${WORKER}/admin/shares`, {
      method: "POST",
      headers: { Cookie: cookieHeader(), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ file_id: paidFileId || fileId || "", password: "secret123" }),
      redirect: "manual",
    });
    const loc = r.headers.get("location") || "";
    const m = /\/s\/([a-z0-9]+)/.exec(loc);
    const pwShareId = m ? m[1] : null;

    if (pwShareId) {
      // 访客直接下载应被重定向回提取页（需先输密码）
      const dlNoPw = await fetch(`${WORKER}/s/${pwShareId}/dl`, { redirect: "manual" });
      assert(dlNoPw.status === 302, `未输密码付费分享 dl → 302 回提取页`);

      // 错误密码
      const bad = await fetch(`${WORKER}/s/${pwShareId}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ password: "wrong" }),
        redirect: "manual",
      });
      const badHtml = await bad.text();
      assert(badHtml.includes("密码错误"), `错误密码提示`);

      // 正确密码 → 302 到 ?authed=1
      const ok = await fetch(`${WORKER}/s/${pwShareId}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ password: "secret123" }),
        redirect: "manual",
      });
      assert(ok.status === 302 && (ok.headers.get("location") || "").includes("authed=1"), `正确密码 → 放行`);
    } else {
      assert(false, `密码分享创建失败`);
    }
  }

  // ── T10 分享链接：吊销后失效 ─────────────────────────────
  console.log("\n[T10] 分享链接（吊销失效）");
  if (freeShareId) {
    // 管理员吊销
    const rv = await fetch(`${WORKER}/admin/shares/${freeShareId}/revoke`, {
      method: "POST",
      headers: { Cookie: cookieHeader() },
      redirect: "manual",
    });
    assert(rv.status === 302, `吊销操作 302`);

    // 访客再访问 → 410
    const after = await fetch(`${WORKER}/s/${freeShareId}`);
    assert(after.status === 410, `吊销后访客访问 410（实际 ${after.status}）`);
  }

  // ── T11 分享链接：次数耗尽 ───────────────────────────────
  console.log("\n[T11] 分享链接（次数限制）");
  {
    const r = await fetch(`${WORKER}/admin/shares`, {
      method: "POST",
      headers: { Cookie: cookieHeader(), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ file_id: fileId || "", max_claims: "1" }),
      redirect: "manual",
    });
    const m = /\/s\/([a-z0-9]+)/.exec(r.headers.get("location") || "");
    const limShareId = m ? m[1] : null;
    if (limShareId) {
      // 第一次下载（消耗唯一一次 claim）
      const dl1 = await fetch(`${WORKER}/s/${limShareId}/dl`, { redirect: "manual" });
      await fetch(`${WORKER}${dl1.headers.get("location") || ""}`);
      // 第二次应失效
      const dl2 = await fetch(`${WORKER}/s/${limShareId}`);
      assert(dl2.status === 410, `次数耗尽后访问 410（实际 ${dl2.status}）`);
    } else {
      assert(false, `限次分享创建失败`);
    }
  }

  // ── T13 静态资源 HTTP 可访问性（重构后 CSS/JS 从内联抽成静态文件）──
  console.log("\n--- T13 静态资源 HTTP 可访问性 ---");
  {
    const assets = [
      { path: "/assets/app.css", typeIncludes: "text/css", contains: ".fab" },
      { path: "/assets/theme-init.js", typeIncludes: "javascript", contains: "__setTheme" },
      { path: "/assets/shared.js", typeIncludes: "javascript", contains: "window.openModal" },
      { path: "/assets/ctxmenu.js", typeIncludes: "javascript", contains: "__buildCtxMenu" },
      { path: "/assets/usermenu.js", typeIncludes: "javascript", contains: "__toggleUserMenu" },
      { path: "/assets/upload.js", typeIncludes: "javascript", contains: "buildZip" },
    ];
    for (const a of assets) {
      const r = await fetch(`${WORKER}${a.path}`);
      assert(r.status === 200, `${a.path} 返回 200（实际 ${r.status}）`);
      const ct = r.headers.get("content-type") || "";
      assert(ct.includes(a.typeIncludes), `${a.path} Content-Type 含 ${a.typeIncludes}（实际 ${ct}）`);
      const body = await r.text();
      assert(body.includes(a.contains), `${a.path} 含关键标记 "${a.contains}"`);
    }
    // 主页 HTML 应引用外链资源、不再内联 <style> 大块 CSS
    const home = await (await fetch(`${WORKER}/`)).text();
    assert(home.includes('href="/assets/app.css"'), `主页引用外链 app.css`);
    assert(home.includes('src="/assets/theme-init.js"'), `主页引用外链 theme-init.js`);
    assert(home.includes('src="/assets/shared.js"'), `主页引用外链 shared.js（先于其它脚本加载）`);
    assert(!/<style>[\s\S]{500,}<\/style>/.test(home), `主页无超大内联 <style>（>500字符）`);
    assert(home.includes('src="/assets/ctxmenu.js"'), `主页引用外链 ctxmenu.js`);
    console.log(`  ℹ️  5 个静态资源均 200 + 正确 MIME + 主页改用外链`);
  }

  return finish();
}

function finish() {
  console.log(`\n=== 测试结束：${pass} 通过，${fail} 失败 ===\n`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("测试异常：", e);
  process.exit(1);
});
