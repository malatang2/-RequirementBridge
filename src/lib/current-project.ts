"use server";

/**
 * 当前项目上下文（T0.4）。
 * 用 cookie 持久化选中的项目 ID，切换项目后各模块数据按此隔离。
 */

import { cookies } from "next/headers";

const COOKIE_KEY = "current-project-id";

/** 读取当前选中的项目 ID（服务端） */
export async function getCurrentProjectId(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(COOKIE_KEY)?.value ?? null;
}

/** 设置当前选中的项目 ID（服务端） */
export async function setCurrentProjectId(id: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_KEY, id, {
    path: "/",
    // 项目 ID 非敏感，关闭 httpOnly 以便客户端（current-project-client.ts）读取。
    // 否则 document.cookie 读不到，导致新建页"选了项目仍提示请先选择"。
    httpOnly: false,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365, // 1 年
  });
}
