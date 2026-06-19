/**
 * LINUX DO Credit — EasyPay / CodePay / VPay 兼容协议客户端。
 *
 * 文档：https://credit.linux.do/docs/api
 * 网关：https://credit.linux.do/epay
 *
 * 签名规则（核实自官方）：
 *   1. 取所有非空参数（排除 sign 与 sign_type）
 *   2. 按 key 的 ASCII 升序排序
 *   3. 拼成 k1=v1&k2=v2&...（不 URL 编码）
 *   4. 末尾直接拼接商户密钥 key（无 &key= 连接符）
 *   5. 整体做 MD5，取 32 位小写 hex
 *
 * 下单：POST /pay/submit.php（x-www-form-urlencoded）
 *   必填：pid, type=epay, name, money, sign
 *   选填：out_trade_no, notify_url, return_url, device, sign_type, param
 *
 * 异步通知（GET 到 notify_url）：
 *   pid, trade_no, out_trade_no, type, name, money, trade_status=TRADE_SUCCESS, sign_type, sign
 *   响应体必须返回 "success"（不区分大小写），否则平台会重试。
 *
 * 同步跳转（GET 到 return_url）：参数与 notify 一致。
 *
 * 查单：GET /api.php?act=order&pid=&key=&out_trade_no=
 */

import type { Bindings } from "../env";
import { md5Hex } from "../lib/crypto";

/** Credit 网关基址，默认官方；可用 CREDIT_BASE 覆盖以指向 mock */
function gatewayBase(env: Bindings): string {
  const base = (env as unknown as { CREDIT_BASE?: string }).CREDIT_BASE;
  return (base || "https://credit.linux.do/epay").replace(/\/+$/, "");
}
const SUBMIT_PATH = "/pay/submit.php";
const API_PATH = "/api.php";

/** 参与签名的参数类型（值为字符串或数字；null/undefined/空串被剔除） */
type ParamMap = Record<string, string | number | undefined | null>;

/**
 * 计算签名。
 * 注意：所有值在签名时以其字符串形式参与；调用方需保证签名所用的
 * 字符串与实际提交/回调中的字段一致（尤其金额 money）。
 */
export function sign(params: ParamMap, key: string): string {
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

  const str =
    entries.map(([k, v]) => `${k}=${v}`).join("&") + key;
  return md5Hex(str);
}

/**
 * 将积分数（整数）规范化为提交/签名用的金额字符串。
 * 平台要求最多 2 位小数；积分为整数时输出 "N.00" 形式，
 * 以便签名串与提交表单、回调返回值保持完全一致。
 */
export function formatMoney(credits: number): string {
  const n = Math.max(0, Math.trunc(Number(credits) || 0));
  return n.toFixed(2);
}

/** 验证回调签名：用回调原始参数（含 sign）重算并比较 */
export function verifySign(params: ParamMap, key: string, expectedSign: string): boolean {
  const computed = sign(params, key);
  if (computed.length !== expectedSign.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) {
    diff |= computed.charCodeAt(i) ^ expectedSign.charCodeAt(i);
  }
  return diff === 0;
}

export interface CreateOrderInput {
  outTradeNo: string;
  name: string;       // 商品名（显示在认证页，平台限制最多 64 字符）
  money: number;      // 积分（整数；提交与签名时统一用 formatMoney 规范化）
  notifyUrl: string;
  returnUrl: string;
  param?: string;     // 透传参数（可选）
}

export interface CreateOrderResult {
  /** 完整提交 URL（form action，需浏览器 POST 跳转） */
  submitUrl: string;
  /** 提交参数（含 sign），可直接构造表单自动提交 */
  params: Record<string, string>;
}

/** 构造下单请求参数（含签名） */
export function buildOrderParams(env: Bindings, input: CreateOrderInput): CreateOrderResult {
  const moneyStr = formatMoney(input.money);
  const params: ParamMap = {
    pid: env.CREDIT_PID,
    type: "epay",
    out_trade_no: input.outTradeNo,
    notify_url: input.notifyUrl,
    return_url: input.returnUrl,
    name: input.name.slice(0, 64),
    money: moneyStr,
    device: "pc",
    ...(input.param ? { param: input.param } : {}),
  };
  const sig = sign(params, env.CREDIT_KEY);
  const finalParams: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(params).filter(([, v]) => v != null && v !== "") as [string, string][],
    ),
    sign: sig,
    sign_type: "MD5",
  };
  return { submitUrl: `${gatewayBase(env)}${SUBMIT_PATH}`, params: finalParams };
}

export interface OrderQueryResult {
  code: number;   // 1=成功
  msg?: string;
  trade_no?: string;
  out_trade_no?: string;
  type?: string;
  pid?: string;
  name?: string;
  money?: string;
  trade_status?: string;  // TRADE_SUCCESS
}

/** 主动查单：GET /api.php?act=order */
export async function queryOrder(
  env: Bindings,
  outTradeNo: string,
): Promise<OrderQueryResult> {
  const url = `${gatewayBase(env)}${API_PATH}?act=order&pid=${encodeURIComponent(env.CREDIT_PID)}&key=${encodeURIComponent(env.CREDIT_KEY)}&out_trade_no=${encodeURIComponent(outTradeNo)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`queryOrder http ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as OrderQueryResult;
}

/**
 * 生成自动提交的 HTML 表单（POST 跳转到 submitUrl）。
 * EasyPay 下单要求 POST 提交；浏览器 GET 302 无法携带表单 body，
 * 故返回一个 onload 自动 submit 的页面。
 */
export function buildSubmitFormHtml(result: CreateOrderResult): string {
  const fields = Object.entries(result.params)
    .map(
      ([k, v]) =>
        `    <input type="hidden" name="${k}" value="${v.replace(/"/g, "&quot;")}">`,
    )
    .join("\n");
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>正在跳转到支付平台…</title></head>
<body onload="document.forms[0].submit()">
  <form action="${result.submitUrl}" method="post">
${fields}
    <noscript><button type="submit">点击继续</button></noscript>
  </form>
</body>
</html>`;
}
