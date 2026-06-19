/**
 * Worker 入口：组装 Hono app，挂载中间件与路由。
 */

import { Hono } from "hono";
import type { Bindings } from "./env";
import { sessionMiddleware } from "./auth/session";
import { authRoutes } from "./routes/auth";
import { fileRoutes } from "./routes/files";
import { payRoutes } from "./routes/pay";
import { downloadRoutes } from "./routes/download";
import { shareRoutes } from "./routes/share";

const app = new Hono<{ Bindings: Bindings }>();

// 全局会话解析（无强制）
app.use("*", sessionMiddleware);

// 路由挂载
app.route("/auth", authRoutes);
app.route("/", fileRoutes);
app.route("/pay", payRoutes);
app.route("/", downloadRoutes);
app.route("/s", shareRoutes); // 公开分享链路（不挂 requireAuth）

// 健康检查
app.get("/health", (c) => c.text("ok"));

// 404
app.notFound((c) => {
  const cfg = c.get("config");
  const session = c.get("session");
  void cfg;
  void session;
  return c.text("Not Found", 404);
});

// 全局错误处理
app.onError((err, c) => {
  console.error("unhandled error", err);
  const msg = err instanceof Error ? err.message : "internal error";
  return c.text(`服务器错误：${msg}`, 500);
});

export default app;
