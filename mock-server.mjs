/**
 * Mock 服务器：本地测试用，模拟 LINUX DO Connect + LINUX DO Credit。
 *
 * 启动：node mock-server.mjs
 * 监听：http://localhost:4000
 *
 * 模拟端点（Connect 登录，OAuth2）：
 *   GET  /oauth2/authorize (scope=openid) → 302 到 redirect_uri?code=...&state=...
 *   POST /oauth2/token                     → 返回 {access_token, token_type}
 *   GET  /api/user                         → 返回 userinfo（需 Bearer token）
 *
 * 模拟端点（Credit，EasyPay 协议）：
 *   POST /epay/pay/submit.php  → 验签 → 记订单 → 302 跳 return_url + 异步 notify
 *   GET  /epay/api.php?act=order → 返回订单查询结果
 *
 * 测试凭据（与 .dev.vars 一致）：
 *   client_id (Connect): test_client
 *   client_secret:       test_secret
 *   pid (Credit):        test_client
 *   key (Credit):        test_secret
 *
 * mock 用户：username=alice, sub=u_alice, trust_level=2
 */
import { createServer } from "node:http";
import { URL } from "node:url";
import crypto from "node:crypto";

const PORT = 4000;
const PID = "test_client";
const KEY = "test_secret";
const WORKER_BASE = "http://localhost:8787"; // wrangler dev 地址（用于异步 notify 回调）

const MOCK_USER = {
  sub: "u_alice",
  username: "alice",
  name: "Alice 测试",
  email: "alice@example.com",
  avatar_url: "https://example.com/a.png",
  trust_level: 2,
  active: true,
  silenced: false,
};

// ── EasyPay 签名（与 src/payment/epay.ts 完全一致）──────────
function epaySign(params) {
  const entries = Object.entries(params)
    .filter(
      ([k, v]) =>
        k !== "sign" &&
        k !== "sign_type" &&
        v !== undefined &&
        v !== null &&
        v !== "",
    )
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const str = entries.map(([k, v]) => `${k}=${v}`).join("&") + KEY;
  return crypto.createHash("md5").update(str, "utf8").digest("hex");
}

function verifyEpaySign(params) {
  const expected = params.sign;
  if (!expected) return false;
  const computed = epaySign(params);
  if (computed.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) diff |= computed.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

// code → 临时存储（登录 code）
const codes = new Map();
// out_trade_no → {amount, name, trade_no, status, notify_url, return_url}
const epayOrders = new Map();

/** 异步通知商户 notify_url：GET 回调，带签名 */
async function fireNotify(order) {
  const tradeNo = order.trade_no;
  const notifyParams = {
    pid: PID,
    trade_no: tradeNo,
    out_trade_no: order.out_trade_no,
    type: "epay",
    name: order.name,
    money: order.money, // 与下单一致（"N.00"）
    trade_status: "TRADE_SUCCESS",
  };
  notifyParams.sign = epaySign(notifyParams);
  notifyParams.sign_type = "MD5";
  const u = new URL(order.notify_url);
  for (const [k, v] of Object.entries(notifyParams)) u.searchParams.set(k, v);
  try {
    const r = await fetch(u.toString());
    const txt = await r.text();
    console.log(`  [mock notify] → ${order.notify_url} → ${r.status} ${txt}`);
  } catch (e) {
    console.log(`  [mock notify] 失败: ${e.message}`);
  }
}

/** 读取请求 body（form-urlencoded）*/
function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => resolve(body));
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  console.log(`[mock] ${req.method} ${path}${url.search ? "?" + url.search.slice(1, 60) : ""}`);

  // ── Connect: authorize（登录，scope=openid 或非 integral）─────────
  if (path === "/oauth2/authorize" && req.method === "GET") {
    const redirectUri = url.searchParams.get("redirect_uri");
    const state = url.searchParams.get("state");
    const code = "mock_code_" + Math.random().toString(36).slice(2, 10);
    codes.set(code, { redirect_uri: redirectUri, used: false });
    const back = new URL(redirectUri);
    back.searchParams.set("code", code);
    back.searchParams.set("state", state || "");
    console.log(`  [mock] authorize → redirect ${back.origin}${back.pathname}`);
    res.writeHead(302, { Location: back.toString() });
    return res.end();
  }

  // ── Connect: token ─────────────────────────────────────
  if (path === "/oauth2/token" && req.method === "POST") {
    const body = await readBody(req);
    const form = new URLSearchParams(body);
    const code = form.get("code");
    if (!codes.has(code)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "invalid_code" }));
    }
    codes.delete(code);
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(
      JSON.stringify({
        access_token: "mock_access_" + Math.random().toString(36).slice(2),
        token_type: "Bearer",
        refresh_token: "mock_refresh_xxx",
        expires_in: 3600,
      }),
    );
  }

  // ── Connect: userinfo ──────────────────────────────────
  if (path === "/api/user" && req.method === "GET") {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith("Bearer ")) {
      res.writeHead(401, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ detail: "authorization required" }));
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(MOCK_USER));
  }

  // ── Credit EasyPay: 下单 POST /epay/pay/submit.php ─────
  // 表单提交：验签 → 记订单 → 302 跳 return_url（同步）+ 异步 notify
  if (path === "/epay/pay/submit.php" && (req.method === "POST" || req.method === "GET")) {
    let params;
    if (req.method === "POST") {
      const body = await readBody(req);
      params = Object.fromEntries(new URLSearchParams(body));
    } else {
      params = Object.fromEntries(url.searchParams.entries());
    }

    // pid 校验
    if (params.pid !== PID) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ code: -1, msg: "pid 不匹配" }));
    }
    // 验签
    if (!verifyEpaySign(params)) {
      console.log(`  [mock] submit 验签失败`, params);
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ code: -1, msg: "签名验证失败" }));
    }

    const outTradeNo = params.out_trade_no;
    const tradeNo = "mock_trade_" + Math.random().toString(36).slice(2, 10);
    const order = {
      out_trade_no: outTradeNo,
      money: params.money,
      name: params.name,
      trade_no: tradeNo,
      status: "TRADE_SUCCESS",
      notify_url: params.notify_url,
      return_url: params.return_url,
    };
    epayOrders.set(outTradeNo, order);
    console.log(`  [mock] submit 成功: out=${outTradeNo} money=${params.money} trade=${tradeNo}`);

    // 异步通知（不阻塞响应）
    fireNotify(order).catch((e) => console.log(`  [mock] notify err: ${e.message}`));

    // 同步跳转 return_url（模拟用户支付完返回）
    if (params.return_url) {
      const back = new URL(params.return_url);
      res.writeHead(302, { Location: back.toString() });
      return res.end();
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ code: 1, msg: "success", trade_no: tradeNo }));
  }

  // ── Credit EasyPay: 查单 GET /epay/api.php?act=order ────
  if (path === "/epay/api.php" && req.method === "GET") {
    const act = url.searchParams.get("act");
    const qPid = url.searchParams.get("pid");
    const qKey = url.searchParams.get("key");
    const outTradeNo = url.searchParams.get("out_trade_no");
    if (act !== "order" || qPid !== PID || qKey !== KEY) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ code: -1, msg: "参数错误" }));
    }
    const order = epayOrders.get(outTradeNo);
    if (!order) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ code: -1, msg: "订单不存在" }));
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(
      JSON.stringify({
        code: 1,
        msg: "success",
        trade_no: order.trade_no,
        out_trade_no: order.out_trade_no,
        type: "epay",
        pid: PID,
        name: order.name,
        money: order.money,
        trade_status: order.status,
      }),
    );
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("mock 404");
});

server.listen(PORT, () => {
  console.log(`=============================================`);
  console.log(` Mock 服务器已启动：http://localhost:${PORT}`);
  console.log(`  Connect base: http://localhost:${PORT}`);
  console.log(`  Credit  base: http://localhost:${PORT}/epay (EasyPay)`);
  console.log(`  mock 用户:    ${MOCK_USER.username} (trust_level=${MOCK_USER.trust_level})`);
  console.log(`  PID: ${PID}  KEY: ${KEY}`);
  console.log(`  notify 回调: ${WORKER_BASE}（异步 GET）`);
  console.log(`=============================================`);
  console.log(`等待请求...`);
});
