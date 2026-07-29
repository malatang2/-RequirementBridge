/**
 * 服务端 Supabase 客户端（携带用户 session，受 RLS 保护）。
 * 用于 Server Component / Route Handler 中读取当前用户数据。
 */

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { publicEnv } from "@/lib/env";

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    publicEnv.supabaseUrl,
    publicEnv.supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options as never)
            );
          } catch {
            // Server Component 中无法 set cookie，忽略（由 middleware 处理刷新）
          }
        },
      },
    }
  );
}
