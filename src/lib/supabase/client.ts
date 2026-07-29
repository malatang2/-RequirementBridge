/**
 * Supabase 客户端封装。
 * 对应《前后端接口契约 §0.1》：CRUD 走 SDK + RLS。
 *
 * - client.ts：浏览器端客户端（携带用户 session，受 RLS 保护）
 * - server.ts：服务端客户端（Route Handler / Server Component）
 */

import { createBrowserClient } from "@supabase/ssr";
import { publicEnv } from "@/lib/env";

export function createSupabaseClient() {
  return createBrowserClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey);
}
