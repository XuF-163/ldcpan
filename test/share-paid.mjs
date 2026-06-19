/**
 * 专项测试：分享付费订单的完整闭环（EasyPay 积分扣费）。
 * 前置：mock server :4000 + wrangler dev :8787 已启动。
 * 运行：node test/share-paid.mjs
 */
const WORKER = "http://localhost:8787";

const cookies = [];
function grab(h) {
  const list = h.getSetCookie ? h.getSetCookie() : [h.headers.get("set-cookie")];
  for (const c of list) {
    if (c) cookies.push(c.split(";")[0]);
  }
}
const ch = () => cookies.join("; ");

async function login() {
  const r1 = await fetch(`${WORKER}/auth/login`, { redirect: "manual" });
  grab(r1);
  const loc = r1.headers.get("location");
  const r2 = await fetch(loc, { redirect: "manual" });
  const cb = new URL(r2.headers.get("location"));
  const code = cb.searchParams.get("code");
  const state = new URL(loc).searchParams.get("state");
  const r3 = await fetch(`${WORKER}/auth/callback?code=${code}&state=${state}`, {
    redirect: "manual",
    headers: { Cookie: ch() },
  });
  grab(r3);
}

async function uploadPaid(name, price) {
  const b = "--bd" + Math.random().toString(36).slice(2);
  const up = await fetch(`${WORKER}/upload`, {
    method: "POST",
    headers: { "Content-Type": `multipart/form-data; boundary=${b}`, Cookie: ch() },
    body:
      `--${b}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${name}"\r\n\r\n` +
      `ZIP_CONTENT_${name}\r\n` +
      `--${b}\r\n` +
      `Content-Disposition: form-data; name="price"\r\n\r\n` +
      `${price}\r\n` +
      `--${b}--\r\n`,
    redirect: "manual",
  });
  return /\/f\/(\w+)/.exec(up.headers.get("location"))[1];
}

async function createShare(fileId) {
  const sh = await fetch(`${WORKER}/admin/shares`, {
    method: "POST",
    headers: { Cookie: ch(), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ file_id: fileId }),
    redirect: "manual",
  });
  return /\/s\/(\w+)/.exec(sh.headers.get("location"))[1];
}

/** 从 HTML 表单中提取 action 和所有 hidden 字段 */
function parseForm(html) {
  const actionM = /action="([^"]+)"/.exec(html);
  const action = actionM ? actionM[1] : "";
  const fields = {};
  const re = /<input type="hidden" name="([^"]+)" value="([^"]*)">/g;
  let m;
  while ((m = re.exec(html)) !== null) fields[m[1]] = m[2];
  return { action, fields };
}

async function main() {
  console.log("\n=== 分享付费订单闭环测试（EasyPay）===\n");
  await login();

  // 上传付费文件（5 积分）
  const fid = await uploadPaid("sharepaid.zip", 5);
  console.log(`付费文件: ${fid}`);

  // 创建分享（无密码）
  const sid = await createShare(fid);
  console.log(`分享: ${sid}`);

  // 访客走分享付费（不带 cookie，模拟访客）
  cookies.length = 0;

  // 1. /s/:id/pay → 返回 EasyPay 自动提交表单（200 HTML）
  const r1 = await fetch(`${WORKER}/s/${sid}/pay`, { redirect: "manual" });
  const ok1a = r1.status === 200;
  const formHtml = await r1.text();
  const { action, fields } = parseForm(formHtml);
  const ok1 =
    ok1a &&
    action.includes("/pay/submit.php") &&
    fields.pid === "test_client" &&
    fields.money === "5.00" &&
    fields.type === "epay" &&
    !!fields.sign;
  console.log(`  ${ok1 ? "✅" : "❌"} /s/:id/pay 返回 EasyPay 表单（submit.php, money=5.00, sign 存在）`);

  // 2. POST 到 mock submit.php → 验签 → 异步 notify + 302 跳 return_url
  const r2 = await fetch(action, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
    redirect: "manual",
  });
  const returnUrl = r2.headers.get("location") || "";
  const ok2 = r2.status === 302 && returnUrl.includes("/pay/return");
  console.log(`  ${ok2 ? "✅" : "❌"} mock submit.php 验签通过 → 302 跳 return（${r2.status}）`);

  // 等待 mock 异步 notify 到 Worker（markPaid 完成）
  await new Promise((res) => setTimeout(res, 600));

  // 3. 访问 /pay/return → 订单已 paid → 跳结果页（不再直接跳下载）
  let ok3 = false;
  let dlToken = null;
  if (ok2) {
    const r3 = await fetch(returnUrl, { redirect: "manual" });
    const doneLoc = r3.headers.get("location") || "";
    ok3 = r3.status === 302 && doneLoc.includes("/pay/done");
    console.log(`  ${ok3 ? "✅" : "❌"} /pay/return 已支付 → 跳结果页（${r3.status} ${doneLoc.slice(0, 25)}）`);

    // 结果页应展示下载按钮（含 /dl/ 令牌链接）
    if (ok3) {
      const dr = await fetch(`${WORKER}${doneLoc.replace(/^https?:\/\/[^/]+/, "")}`);
      const dh = await dr.text();
      const tokMatch = /\/dl\/([A-Za-z0-9_-]+)/.exec(dh);
      dlToken = tokMatch ? tokMatch[1] : null;
      const okPage = dr.status === 200 && dh.includes("立即下载") && !!dlToken;
      console.log(`  ${okPage ? "✅" : "❌"} 结果页展示文件名 + 下载按钮（令牌）`);
      ok3 = ok3 && okPage;
    }
  }

  // 4. 实际下载验证内容（用结果页提取的令牌）
  let ok4 = false;
  if (ok3 && dlToken) {
    const dl = await fetch(`${WORKER}/dl/${dlToken}`);
    const content = await dl.text();
    ok4 = dl.status === 200 && content.includes("ZIP_CONTENT");
    console.log(`  ${ok4 ? "✅" : "❌"} 访客匿名下载成功（${dl.status}）`);
  }

  console.log(`\n=== 结果：${ok1 && ok2 && ok3 && ok4 ? "全部通过" : "有失败"} ===\n`);
  process.exit(ok1 && ok2 && ok3 && ok4 ? 0 : 1);
}

main().catch((e) => {
  console.error("异常：", e);
  process.exit(1);
});
