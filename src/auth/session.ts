/**
 * 会话管理：
 *  - session token 存 KV（带 TTL）
 *  - 通过 HttpOnly Cookie 传递
 *  - Hono 中间件：requireAuth / requireAdmin
 */

import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Bindings, AppConfig } from "../env";
import { readConfig } from "../env";
import { nowSec, randomBase64url } from "../lib/crypto";

const SESSION_COOKIE = "ldcpan_session";
const SESSION_TTL_SEC = 7 * 24 * 3600; // 7 天

export interface SessionData {
  uid: string;
  username: string;
  name?: string;
  avatarUrl?: string;
  trustLevel: number;
  isAdmin: boolean;
  exp: number; // epoch 秒
}

declare module "hono" {
  interface ContextVariableMap {
    session: SessionData;
    config: AppConfig;
  }
}

export async function createSession(
  c: Context,
  data: Omit<SessionData, "exp">,
): Promise<void> {
  const token = randomBase64url(32);
  const exp = nowSec() + SESSION_TTL_SEC;
  const payload: SessionData = { ...data, exp };

  // 等一下：data 里若含 exp 会被覆盖，确保调用方不传 exp
  await c.env.SESSIONS.put(token, JSON.stringify(payload), {
    expirationTtl: SESSION_TTL_SEC,
  });

  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL_SEC,
  });
}

export async function destroySession(c: Context): Promise<void> {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    await c.env.SESSIONS.delete(token);
  }
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

/** 读取当前会话；不强制登录。注入 c.var.session 与 c.var.config。 */
export const sessionMiddleware: MiddlewareHandler<{
  Bindings: Bindings;
}> = async (c, next) => {
  c.set("config", readConfig(c.env));
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    const raw = await c.env.SESSIONS.get(token);
    if (raw) {
      try {
        const data = JSON.parse(raw) as SessionData;
        if (data.exp > nowSec()) {
          c.set("session", data);
        }
      } catch {
        /* 损坏的会话：忽略 */
      }
    }
  }
  await next();
};

/** 要求登录 */
export const requireAuth: MiddlewareHandler<{
  Bindings: Bindings;
}> = async (c, next) => {
  const session = c.get("session");
  if (!session) {
    const next = encodeURIComponent(c.req.url);
    return c.redirect(`/auth/login?next=${next}`);
  }
  await next();
};

/** 要求管理员 */
export const requireAdmin: MiddlewareHandler<{
  Bindings: Bindings;
}> = async (c, next) => {
  const session = c.get("session");
  if (!session) {
    const next = encodeURIComponent(c.req.url);
    return c.redirect(`/auth/login?next=${next}`);
  }
  if (!session.isAdmin) {
    return c.text("Forbidden：仅管理员可访问该页面", 403);
  }
  await next();
};

export function getSession(c: Context): SessionData | undefined {
  return c.get("session");
}
