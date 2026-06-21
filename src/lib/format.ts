/**
 * 服务端共享格式化工具。
 * 浏览器端的同名函数在 public/assets/shared.js（humanSize 暴露到 window）。
 * 两者算法一致；服务端版本用于 SSR 渲染 HTML，浏览器版本用于客户端动态 DOM。
 */

/** 字节数 → 人类可读大小（如 "1.5 MB"） */
export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}
