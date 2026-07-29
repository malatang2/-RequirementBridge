"use server";

/**
 * Server Action 专用 Supabase 客户端。
 * 与 server.ts 的区别：本客户端用于执行写操作（登录/登出/OAuth），
 * 必须能 set cookie；server.ts 用于 Server Component 只读。
 */

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { publicEnv } from "@/lib/env";
import type { CookieEntry } from "@/lib/supabase/cookies";

export async function createSupabaseActionClient() {
  const cookieStore = await cookies();

  return createServerClient(
    publicEnv.supabaseUrl,
    publicEnv.supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookieEntry[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options as never)
            );
          } catch {
            // 在 Server Component 中调用会抛（只能读），忽略
          }
        },
      },
    }
  );
}
