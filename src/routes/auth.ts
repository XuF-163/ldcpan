/**
 * /auth 路由：login / callback / logout
 */

import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { Bindings } from "../env";
import { readConfig } from "../env";
import {
  buildAuthRequest,
  exchangeCodeForToken,
  fetchUserInfo,
  signAuthState,
  verifyAuthState,
} from "../auth/oauth";
import { createSession, destroySession } from "../auth/session";
import { nowIso } from "../lib/crypto";

const STATE_COOKIE = "ldcpan_oauth_state";
const STATE_COOKIE_TTL = 600; // 10 分钟

export const authRoutes = new Hono<{ Bindings: Bindings }>();

authRoutes.get("/login", async (c) => {
  const next = c.req.query("next") || "/";
  const { url, authState } = await buildAuthRequest(c.env);
  // 把 next 编码进 state 的 nonce（避免另开 cookie）
  const stamped = { ...authState, nonce: `${authState.nonce}|${next}` };
  const signed = await signAuthState(c.env.SESSION_SECRET, stamped);
  setCookie(c, STATE_COOKIE, signed, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: STATE_COOKIE_TTL,
  });
  return c.redirect(url);
});

authRoutes.get("/callback", async (c) => {
  const code = c.req.query("code");
  const stateParam = c.req.query("state");
  const error = c.req.query("error");

  if (error) {
    return c.text(`登录被拒绝：${error}`, 400);
  }
  if (!code || !stateParam) {
    return c.text("缺少 code / state 参数", 400);
  }

  const cookie = getCookie(c, STATE_COOKIE);
  const authState = await verifyAuthState(c.env.SESSION_SECRET, cookie);
  if (!authState || authState.state !== stateParam) {
    return c.text("state 校验失败（可能是会话过期或 CSRF），请重试登录。", 400);
  }

  // 解析 next
  const next = authState.nonce.includes("|")
    ? authState.nonce.slice(authState.nonce.indexOf("|") + 1)
    : "/";
  const safeNext = next.startsWith("/") ? next : "/";

  try {
    const tokens = await exchangeCodeForToken(c.env, code, authState.verifier);
    const info = await fetchUserInfo(c.env, tokens.access_token);

    const cfg = readConfig(c.env);
    const isAdmin = cfg.adminUsernames.has((info.username || "").toLowerCase());
    const uid = info.sub;

    // upsert 用户表
    await c.env.DB.prepare(
      `INSERT INTO users (uid, username, name, email, avatar_url, trust_level, is_admin, created_at, last_login)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(uid) DO UPDATE SET
         username=excluded.username,
         name=excluded.name,
         email=excluded.email,
         avatar_url=excluded.avatar_url,
         trust_level=excluded.trust_level,
         is_admin=excluded.is_admin,
         last_login=excluded.last_login`,
    )
      .bind(
        uid,
        info.username || `user_${uid}`,
        info.name ?? null,
        info.email ?? null,
        info.avatar_url ?? null,
        info.trust_level ?? 0,
        isAdmin ? 1 : 0,
        nowIso(),
        nowIso(),
      )
      .run();

    await createSession(c, {
      uid,
      username: info.username || `user_${uid}`,
      name: info.name,
      avatarUrl: info.avatar_url,
      trustLevel: info.trust_level ?? 0,
      isAdmin,
    });

    return c.redirect(safeNext);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.text(`登录失败：${msg}`, 500);
  }
});

authRoutes.post("/logout", async (c) => {
  await destroySession(c);
  return c.redirect("/");
});

authRoutes.get("/logout", async (c) => {
  // 兼容 GET
  await destroySession(c);
  return c.redirect("/");
});
