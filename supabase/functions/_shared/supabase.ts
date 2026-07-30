/**
 * Edge Function 共享工具（Deno 运行时）。
 * - createSupabaseClient：用调用者 JWT 创建受 RLS 保护的客户端
 * - DashScope chat 调用封装
 */

export function createSupabaseClient(req: Request) {
  const authHeader = req.headers.get("Authorization") ?? "";
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  // Edge Function 环境里 SUPABASE_URL / SUPABASE_ANON_KEY 由平台注入
  return {
    url,
    anonKey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    authHeader,
  };
}

/** DashScope chat 调用（OpenAI 兼容接口） */
export async function dashscopeChat(opts: {
  purpose: "extract" | "openapi" | "cluster" | "draft";
  messages: { role: string; content: string }[];
  jsonMode?: boolean;
}): Promise<{ content: string; tokens: number }> {
  const baseUrl =
    Deno.env.get("DASHSCOPE_BASE_URL") ??
    "https://dashscope.aliyuncs.com/compatible-mode/v1";
  const apiKey = Deno.env.get("DASHSCOPE_API_KEY") ?? "";

  const modelByPurpose: Record<string, string> = {
    extract: "qwen-max",
    openapi: "qwen-max",
    cluster: "qwen-plus",
    draft: "qwen-plus",
  };

  const body: Record<string, unknown> = {
    model: modelByPurpose[opts.purpose],
    messages: opts.messages,
    temperature: 0.2,
  };
  if (opts.jsonMode) {
    body.response_format = { type: "json_object" };
  }

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (res.status === 429) {
    throw new Error("LLM_RATE_LIMIT");
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error("LLM_ERROR:auth");
  }
  if (!res.ok) {
    throw new Error(`LLM_ERROR:${res.status}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("GENERATION_FAILED:empty");

  return { content, tokens: data?.usage?.total_tokens ?? 0 };
}

/** CORS 头 */
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};
