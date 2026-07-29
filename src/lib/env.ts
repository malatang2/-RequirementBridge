/**
 * 环境变量统一读取与校验。
 * 对应《开发工作流规范》：环境变量统一 .env.local，OpenAI→DashScope key 迁移（CP0）。
 */

function required(key: string, label: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `[env] 缺少必需环境变量 ${key}（${label}）。请在 .env.local 中配置。`
    );
  }
  return value;
}

/** 仅在服务端（Edge Function / Server Component / Route Handler）可用 */
export const serverEnv = {
  get supabaseUrl() {
    return required("NEXT_PUBLIC_SUPABASE_URL", "Supabase 项目 URL");
  },
  get supabaseServiceRoleKey() {
    return required("SUPABASE_SERVICE_ROLE_KEY", "Supabase 服务端密钥（仅服务端）");
  },
  get dashscopeApiKey() {
    // CP0：由 OPENAI_API_KEY 迁移为 DASHSCOPE_API_KEY（通义千问）
    return required("DASHSCOPE_API_KEY", "阿里云百炼/DashScope API Key");
  },
  get dashscopeBaseUrl() {
    // DashScope OpenAI 兼容端点
    return process.env.DASHSCOPE_BASE_URL ?? "https://dashscope.aliyuncs.com/compatible-mode/v1";
  },
};

/** 浏览器端可用（NEXT_PUBLIC_ 前缀） */
export const publicEnv = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
};
