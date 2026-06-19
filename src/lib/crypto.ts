/**
 * 加密/编码原语：PKCE、签名、随机 token、HMAC、HTML 转义。
 * 全部基于 Web Crypto，无外部依赖，edge 原生可用。
 */

// ── base64url ──────────────────────────────────────────────
export function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const view =
    bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (let i = 0; i < view.length; i++) bin += String.fromCharCode(view[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomBase64url(byteLength: number): string {
  return base64url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

// ── 哈希 ───────────────────────────────────────────────────
export async function sha256(data: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
}

/** MD5 —— Web Crypto 不提供，用紧凑的 RFC 1321 实现（hex 小写） */
export function md5Hex(input: string): string {
  // 实现：标准 RFC 1321，输入为 UTF-8 字节
  const bytes = new TextEncoder().encode(input);
  return md5Bytes(bytes);
}

function md5Bytes(input: Uint8Array): string {
  const s = new Uint8Array(input.length + 1 + 8 + ((64 - ((input.length + 9) % 64)) % 64));
  s.set(input, 0);
  s[input.length] = 0x80;
  const bitLen = input.length * 8;
  // little-endian 64-bit length
  const dv = new DataView(s.buffer);
  dv.setUint32(s.length - 8, bitLen >>> 0, true);
  dv.setUint32(s.length - 4, Math.floor(bitLen / 0x100000000), true);

  const K = new Int32Array([
    -680876936, -389564586, 606105819, -1044525330, -176418897, 1200080426,
    -1473231341, -45705983, 1770035416, -1958414417, -42063, -1990404162,
    1804603682, -40341101, -1502002290, 1236535329, -165796510, -1069501632,
    643717713, -373897302, -701558691, 38016083, -660478335, -405537848,
    568446438, -1019803690, -187363961, 1163531501, -1444681467, -51403784,
    1735328473, -1926607734, -378558, -2022574463, 1839030562, -35309556,
    -1530992060, 1272893353, -155497632, -1094730640, 681279174, -358537222,
    -722521979, 76029189, -640364487, -421815835, 530742520, -995338651,
    -198630844, 1126891415, -1416354905, -57434055, 1700485571, -1894986606,
    -1051523, -2054922799, 1873313359, -30611744, -1560198380, 1309151649,
    -145523070, -1120210379, 718787259, -343485551,
  ]);
  const S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];

  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;

  for (let off = 0; off < s.length; off += 64) {
    const M = new Int32Array(16);
    for (let i = 0; i < 16; i++) {
      M[i] = dv.getInt32(off + i * 4, true);
    }
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F: number;
      let g: number;
      if (i < 16) {
        F = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        F = (D & B) | (~D & C);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        F = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = (7 * i) % 16;
      }
      F = (F + A + K[i] + M[g]) | 0;
      A = D;
      D = C;
      C = B;
      const shift = S[i];
      B = (B + ((F << shift) | (F >>> (32 - shift)))) | 0;
    }
    a0 = (a0 + A) | 0;
    b0 = (b0 + B) | 0;
    c0 = (c0 + C) | 0;
    d0 = (d0 + D) | 0;
  }

  const out = new DataView(new ArrayBuffer(16));
  out.setInt32(0, a0, true);
  out.setInt32(4, b0, true);
  out.setInt32(8, c0, true);
  out.setInt32(12, d0, true);
  return Array.from(new Uint8Array(out.buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── HMAC-SHA256 ────────────────────────────────────────────
async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

export async function hmacSign(secret: string, data: string): Promise<string> {
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return base64url(sig);
}

/** 时间安全字符串比较 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ── PKCE ───────────────────────────────────────────────────
export interface PkcePair {
  verifier: string;  // 43-128 字符
  challenge: string; // S256 = base64url(sha256(verifier))
}

export async function generatePkce(): Promise<PkcePair> {
  const verifier = randomBase64url(32); // 43 字符，满足长度要求
  const challenge = base64url(await sha256(verifier));
  return { verifier, challenge };
}

// ── HTML 转义 ────────────────────────────────────────────────
export function escapeHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ── 时间 ───────────────────────────────────────────────────
export function nowIso(): string {
  return new Date().toISOString();
}

/** 当前 epoch 秒 */
export function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

// ── 密码哈希（分享密码，非账号级）────────────────────────────
// Workers 无 bcrypt/argon2，用 sha256(salt+password)。
// 分享密码是"防随手转发"的轻量门槛，足够。
export interface PasswordHash {
  salt: string; // base64url
  hash: string; // hex
}

export async function hashPassword(password: string): Promise<PasswordHash> {
  const salt = randomBase64url(16);
  const hash = bytesToHex(await sha256(salt + password));
  return { salt, hash };
}

export async function verifyPassword(
  password: string,
  salt: string,
  expectedHash: string,
): Promise<boolean> {
  const hash = bytesToHex(await sha256(salt + password));
  return timingSafeEqual(hash, expectedHash);
}

function bytesToHex(buf: ArrayBuffer): string {
  const view = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < view.length; i++) s += view[i].toString(16).padStart(2, "0");
  return s;
}

