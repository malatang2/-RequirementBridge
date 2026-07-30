"use client";

/**
 * 浏览器端读取当前项目 ID（从 cookie）。
 * 与 current-project.ts（服务端）对应。
 */

const COOKIE_KEY = "current-project-id";

export async function getCurrentProjectIdClient(): Promise<string | null> {
  if (typeof document === "undefined") return null;
  const match = document.cookie
    .split("; ")
    .find((c) => c.startsWith(`${COOKIE_KEY}=`));
  return match ? decodeURIComponent(match.split("=")[1]) : null;
}
