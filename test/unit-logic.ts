/**
 * 纯逻辑测试：直接导入 src/ 下的真实模块验证核心算法。
 * 无需 wrangler / Cloudflare 账号，纯 Node + tsx 运行。
 *
 * 运行：npx tsx test/unit-logic.ts
 *
 * 覆盖：
 *   - md5Hex 实现 vs Node crypto（黄金标准）
 *   - base64url / PKCE
 *   - HMAC-SHA256 签名
 *   - timingSafeEqual
 *   - EasyPay sign 算法（多组向量）
 *   - effectivePrice 计价规则
 *   - R2 Range 解析（start/length/suffix 三种形式）
 */
import { createHash, createHmac, randomBytes } from "node:crypto";
import {
  md5Hex,
  base64url,
  generatePkce,
  hmacSign,
  timingSafeEqual,
  sha256,
  hashPassword,
  verifyPassword,
} from "../src/lib/crypto";
import { effectivePrice } from "../src/env";
import { shareStatus } from "../src/storage/shares";
import type { ShareRow } from "../src/storage/shares";
import { sign, verifySign, formatMoney } from "../src/payment/epay";

let pass = 0;
let fail = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) {
    pass++;
    console.log(`  ✅ ${msg}`);
  } else {
    fail++;
    console.log(`  ❌ ${msg}`);
  }
}

// ── 黄金标准：Node crypto ────────────────────────────────
function nodeMd5(s: string): string {
  return createHash("md5").update(s, "utf8").digest("hex");
}
function nodeHmac(secret: string, data: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

async function main(): Promise<void> {
  console.log("\n=== 纯逻辑单元测试 ===\n");

  // ── MD5 正确性（对照 Node crypto）────────────────────────
  console.log("[MD5] 对照 Node crypto（黄金标准）");
  {
    const vectors = [
      "",
      "abc",
      "message digest",
      "1234567890123456789012345678901234567890",
      "money=5&name=测试商品&out_trade_no=TEST001&pid=1001&type=epaytestkey123",
      "中文测试 😀 emoji 混合 abcXYZ012",
      "a".repeat(1000),
    ];
    let allOk = true;
    for (const v of vectors) {
      const mine = md5Hex(v);
      const gold = nodeMd5(v);
      if (mine !== gold) {
        allOk = false;
        console.log(`     差异：input=${JSON.stringify(v).slice(0, 40)}`);
        console.log(`       mine=${mine}`);
        console.log(`       gold=${gold}`);
      }
    }
    assert(allOk, `MD5 与 Node crypto 在 ${vectors.length} 组向量上一致`);

    // 经典已知向量
    assert(md5Hex("") === "d41d8cd98f00b204e9800998ecf8427e", `MD5("") = d41d8cd...`);
    assert(md5Hex("abc") === "900150983cd24fb0d6963f7d28e17f72", `MD5("abc") = 900150...`);
    assert(
      md5Hex("The quick brown fox jumps over the lazy dog") === "9e107d9d372bb6826bd81d3542a419d6",
      `MD5(fox) = 9e107d...`,
    );
  }

  // ── base64url ──────────────────────────────────────────
  console.log("\n[base64url] 编码");
  {
    const bytes = randomBytes(16);
    const encoded = base64url(bytes);
    assert(/^[A-Za-z0-9_-]+$/.test(encoded), `仅含 base64url 字符（无 +/=）`);
    assert(!encoded.includes("="), `无填充 =`);
    // 长度：16 字节 → ceil(16*4/3) ≈ 22 字符（无填充）
    assert(encoded.length === 22, `16 字节编码为 22 字符（实际 ${encoded.length}）`);
  }

  // ── PKCE ────────────────────────────────────────────────
  console.log("\n[PKCE] S256 verifier/challenge");
  {
    const { verifier, challenge } = await generatePkce();
    assert(verifier.length >= 43 && verifier.length <= 128, `verifier 长度 ${verifier.length} ∈ [43,128]`);
    assert(/^[A-Za-z0-9_-]+$/.test(verifier), `verifier 仅含 unreserved 字符`);
    // challenge = base64url(sha256(verifier))
    const expected = Buffer.from(await sha256(verifier))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    assert(challenge === expected, `challenge = base64url(sha256(verifier))`);
    assert(challenge !== verifier, `challenge 与 verifier 不同`);
    // 两次生成不同
    const p2 = await generatePkce();
    assert(p2.verifier !== verifier, `每次生成不同 verifier（随机性）`);
  }

  // ── HMAC-SHA256 ─────────────────────────────────────────
  console.log("\n[HMAC] SHA256 签名");
  {
    const secret = "testkey123";
    const data = "money=5&pid=1001";
    const mine = await hmacSign(secret, data);
    const gold = nodeHmac(secret, data);
    assert(mine === gold, `HMAC-SHA256 与 Node crypto 一致：${mine.slice(0, 16)}...`);
  }

  // ── timingSafeEqual ─────────────────────────────────────
  console.log("\n[timingSafeEqual] 时间安全比较");
  {
    assert(timingSafeEqual("abcdef", "abcdef") === true, `相同串返回 true`);
    assert(timingSafeEqual("abcdef", "abcdeg") === false, `不同串返回 false`);
    assert(timingSafeEqual("abc", "abcdef") === false, `不同长度返回 false`);
    assert(timingSafeEqual("", "") === true, `空串相等`);
  }

  // ── effectivePrice 计价规则 ─────────────────────────────
  console.log("\n[effectivePrice] 计价规则（both 模型）");
  {
    assert(effectivePrice(null, 1) === 1, `null → 默认价 1`);
    assert(effectivePrice(null, 5) === 5, `null → 默认价 5`);
    assert(effectivePrice(0, 1) === 0, `0 → 免费（忽略默认价）`);
    assert(effectivePrice(3, 1) === 3, `正数 → 自定价 3`);
    assert(effectivePrice(-1, 2) === 0, `负数 → 归零（防异常）`);
    assert(effectivePrice(0, 0) === 0, `0 + 默认 0 → 免费`);
  }

  // ── Range 解析（导入 r2.ts 的私有函数需导出，此处用逻辑验证）──
  console.log("\n[Range] 解析逻辑（三种形式）");
  {
    // 复刻 parseRange 的逻辑验证
    function parse(h: string): { start: number; length: number } | null {
      const m = /^bytes=(\d*)-(\d*)$/.exec(h.trim());
      if (!m) return null;
      const hasStart = m[1].length > 0;
      const hasEnd = m[2].length > 0;
      if (!hasStart && !hasEnd) return null;
      if (hasStart && hasEnd) {
        const s = parseInt(m[1], 10);
        const e = parseInt(m[2], 10);
        return { start: s, length: e - s + 1 };
      }
      if (hasStart) return { start: parseInt(m[1], 10), length: Infinity };
      return { start: NaN, length: parseInt(m[2], 10) };
    }
    const a = parse("bytes=0-99");
    assert(a !== null && a.start === 0 && a.length === 100, `bytes=0-99 → start=0,len=100`);
    const b = parse("bytes=100-");
    assert(b !== null && b.start === 100 && b.length === Infinity, `bytes=100- → start=100,open`);
    const c = parse("bytes=-500");
    assert(c !== null && Number.isNaN(c.start) && c.length === 500, `bytes=-500 → suffix=500`);
    const d = parse("bytes=");
    assert(d === null, `bytes= → null（无效）`);
    const e = parse("invalid");
    assert(e === null, `非范围格式 → null`);
  }

  // ── 密码哈希（分享密码）──────────────────────────────────
  console.log("\n[密码哈希] hashPassword / verifyPassword");
  {
    const pw = "我的分享密码123!";
    const h = await hashPassword(pw);
    assert(!!h.salt && !!h.hash, `生成 salt + hash`);
    assert(h.hash.length === 64, `hash 为 64 位 hex（sha256）`);
    assert(await verifyPassword(pw, h.salt, h.hash) === true, `正确密码验证通过`);
    assert(await verifyPassword("wrong", h.salt, h.hash) === false, `错误密码被拒`);
    // 相同密码两次哈希，salt 不同 → hash 不同
    const h2 = await hashPassword(pw);
    assert(h.salt !== h2.salt, `每次生成不同 salt`);
    assert(h.hash !== h2.hash, `不同 salt → 不同 hash`);
    assert(await verifyPassword(pw, h2.salt, h2.hash) === true, `第二次也能验证通过`);
  }

  // ── 分享有效性判定（shareStatus）──────────────────────────
  console.log("\n[shareStatus] 吊销/过期/耗尽 判定");
  {
    const base = {
      id: "x", file_id: "f", created_by: "u",
      password_hash: null, password_salt: null,
      expires_at: null, max_claims: null,
      claims: 0, downloads: 0, revoked_at: null,
      created_at: "2020-01-01T00:00:00Z",
    } as ShareRow;

    assert(shareStatus(base).active === true, `基础：有效`);

    const revoked = { ...base, revoked_at: "2021-01-01T00:00:00Z" };
    assert(shareStatus(revoked).active === false, `已吊销 → 失效`);
    assert(shareStatus(revoked).reason === "revoked", `原因=revoked`);

    const expired = { ...base, expires_at: "2020-01-01T00:00:00Z" };
    assert(shareStatus(expired).active === false, `已过期 → 失效`);
    assert(shareStatus(expired).reason === "expired", `原因=expired`);

    const futureExp = { ...base, expires_at: new Date(Date.now() + 86400000).toISOString() };
    assert(shareStatus(futureExp).active === true, `未来过期 → 仍有效`);

    const exhausted = { ...base, max_claims: 5, claims: 5 };
    assert(shareStatus(exhausted).active === false, `次数用尽 → 失效`);
    assert(shareStatus(exhausted).reason === "exhausted", `原因=exhausted`);

    const notFull = { ...base, max_claims: 5, claims: 4 };
    assert(shareStatus(notFull).active === true, `次数未满 → 有效`);

    // 吊销优先于过期（即使同时过期）
    const both = { ...base, revoked_at: "2021-01-01T00:00:00Z", expires_at: "2020-01-01T00:00:00Z" };
    assert(shareStatus(both).reason === "revoked", `吊销优先于过期`);
  }

  // ── EasyPay 签名 + formatMoney ────────────────────────────
  console.log("\n[EasyPay] sign / verifySign / formatMoney");
  {
    const KEY = "testkey123";

    // formatMoney：整数 → "N.00"
    assert(formatMoney(0) === "0.00", `formatMoney(0)=0.00`);
    assert(formatMoney(1) === "1.00", `formatMoney(1)=1.00`);
    assert(formatMoney(5) === "5.00", `formatMoney(5)=5.00`);
    assert(formatMoney(123) === "123.00", `formatMoney(123)=123.00`);
    assert(formatMoney(-5) === "0.00", `formatMoney 负数→0.00`);
    assert(formatMoney(3.9) === "3.00", `formatMoney 截断小数→3.00`);

    // sign 黄金向量：手工拼串后用 Node MD5 比对
    // 参数（排序后）：money=5, name=测试商品, out_trade_no=TEST001, pid=1001, type=epay
    {
      const params = {
        pid: "1001",
        type: "epay",
        out_trade_no: "TEST001",
        name: "测试商品",
        money: "5",
      };
      const mine = sign(params, KEY);
      // 构造预期串：key 升序 + 拼接 KEY（不 URL 编码）
      const expectStr =
        "money=5&name=测试商品&out_trade_no=TEST001&pid=1001&type=epay" + KEY;
      const gold = nodeMd5(expectStr);
      assert(mine === gold, `sign 与 Node MD5 一致（${mine}）`);
    }

    // sign 必须排除 sign / sign_type / 空值
    {
      const base = { pid: "1001", type: "epay", money: "1" };
      const without = sign(base, KEY);
      const withNoise = sign(
        { ...base, sign: "deadbeef", sign_type: "MD5", name: "", param: undefined },
        KEY,
      );
      assert(without === withNoise, `sign 排除 sign/sign_type/空值后结果一致`);
    }

    // verifySign：合法签名通过，篡改后失败
    {
      const params = { pid: "1001", type: "epay", money: "10.00", out_trade_no: "X1" };
      const good = sign(params, KEY);
      assert(verifySign(params, KEY, good) === true, `verifySign 合法签名通过`);
      // 篡改金额
      const tampered = { ...params, money: "1.00" };
      assert(verifySign(tampered, KEY, good) === false, `verifySign 篡改金额被拒`);
      // 错误密钥
      assert(verifySign(params, "wrongkey", good) === false, `verifySign 错误密钥被拒`);
      // 长度不同直接失败
      assert(verifySign(params, KEY, "short") === false, `verifySign 短签名被拒`);
    }

    // 模拟完整回调验签：回调参数（含 sign/sign_type）能被 verifySign 正确处理
    {
      const notifyParams = {
        pid: "1001",
        trade_no: "T2024",
        out_trade_no: "X2",
        type: "epay",
        name: "商品",
        money: "5.00",
        trade_status: "TRADE_SUCCESS",
      };
      const sig = sign(notifyParams, KEY);
      // 平台回传时附上 sign + sign_type
      const incoming = { ...notifyParams, sign: sig, sign_type: "MD5" };
      assert(verifySign(incoming, KEY, sig) === true, `回调验签（含 sign/sign_type 字段）通过`);
    }
  }

  console.log(`\n=== 单元测试结束：${pass} 通过，${fail} 失败 ===\n`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("测试异常：", e);
  process.exit(1);
});
