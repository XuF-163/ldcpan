/**
 * LINUX DO Connect OAuth2 客户端。
 * 端点（来自 https://connect.linux.do/.well-known/openid-configuration）：
 *   authorize: https://connect.linux.do/oauth2/authorize
 *   token:     https://connect.linux.do/oauth2/token
 *   userinfo:  https://connect.linux.do/api/user
 * 强制 PKCE (S256)，scope: openid profile email
 */

import type { Bindings } from "../env";
import { base64url, generatePkce, randomBase64url } from "../lib/crypto";

/** Connect 基址，默认官方；可用 LDC_CONNECT_BASE 覆盖以指向 mock */
function connectBase(env: Bindings): string {
  const base = (env as unknown as { LDC_CONNECT_BASE?: string }).LDC_CONNECT_BASE;
  return (base || "https://connect.linux.do").replace(/\/+$/, "");
}
const AUTHORIZE_PATH = "/oauth2/authorize";
const TOKEN_PATH = "/oauth2/token";
const USERINFO_PATH = "/api/user";

export interface UserInfo {
  sub: string;
  username?: string;
  name?: string;
  email?: string;
  avatar_url?: string;
  trust_level?: number;
  active?: boolean;
  silenced?: boolean;
}

/** 在 /auth/login 时生成的、需经签名 cookie 透传到 /auth/callback 的状态 */
export interface AuthState {
  verifier: string;
  state: string;
  nonce: string;
}

export async function buildAuthRequest(env: Bindings): Promise<{
  url: string;
  authState: AuthState;
}> {
  const pkce = await generatePkce();
  const state = randomBase64url(16);
  const nonce = randomBase64url(16);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: env.LDC_CLIENT_ID,
    redirect_uri: env.LDC_REDIRECT_URI,
    scope: "openid profile email",
    state,
    nonce,
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
  });

  return {
    url: `${connectBase(env)}${AUTHORIZE_PATH}?${params.toString()}`,
    authState: { verifier: pkce.verifier, state, nonce },
  };
}

/** 用 authorization_code 换 access_token（带 PKCE verifier） */
export async function exchangeCodeForToken(
  env: Bindings,
  code: string,
  verifier: string,
): Promise<{ access_token: string; token_type: string; refresh_token?: string }> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: env.LDC_REDIRECT_URI,
    client_id: env.LDC_CLIENT_ID,
    client_secret: env.LDC_CLIENT_SECRET,
    code_verifier: verifier,
  });

  const res = await fetch(`${connectBase(env)}${TOKEN_PATH}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`token exchange failed (${res.status}): ${text}`);
  }
  return (await res.json()) as {
    access_token: string;
    token_type: string;
    refresh_token?: string;
  };
}

export async function fetchUserInfo(env: Bindings, accessToken: string): Promise<UserInfo> {
  const res = await fetch(`${connectBase(env)}${USERINFO_PATH}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`userinfo fetch failed (${res.status}): ${await res.text()}`);
  }
  return (await res.json()) as UserInfo;
}

// ── AuthState 的签名 cookie 编解码 ─────────────────────────
// 用 HMAC-SHA256(SESSION_SECRET) 签名 + base64url(payload).sig
import { hmacSign, timingSafeEqual } from "../lib/crypto";

export async function signAuthState(
  secret: string,
  st: AuthState,
): Promise<string> {
  const payload = base64url(new TextEncoder().encode(JSON.stringify(st)));
  const sig = await hmacSign(secret, payload);
  return `${payload}.${sig}`;
}

export async function verifyAuthState(
  secret: string,
  raw: string | undefined,
): Promise<AuthState | null> {
  if (!raw) return null;
  const dot = raw.lastIndexOf(".");
  if (dot < 1) return null;
  const payload = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expected = await hmacSign(secret, payload);
  if (!timingSafeEqual(sig, expected)) return null;
  try {
    const json = new TextDecoder().decode(
      (() => {
        const bin = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return bytes;
      })(),
    );
    return JSON.parse(json) as AuthState;
  } catch {
    return null;
  }
}
