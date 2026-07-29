/**
 * Supabase cookies 适配器类型（避免 @supabase/ssr 的 setAll 隐式 any）。
 * 集中定义，供 server.ts / action-client.ts / middleware.ts 复用。
 */

export type CookieEntry = {
  name: string;
  value: string;
  options?: Record<string, unknown>;
};

export type SupabaseCookiesAdapter = {
  getAll(): CookieEntry[];
  setAll(cookiesToSet: CookieEntry[]): void;
};
