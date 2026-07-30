/**
 * B5 网络验证用 Edge Function（临时，验证后可保留为健康检查或删除）。
 *
 * 验证目标（CP0 B5）：Supabase Edge Function（境外 Deno）↔ DashScope（国内）连通性。
 * - 测 1：DashScope OpenAI 兼容 chat 接口（Qwen-Max）
 * - 测 2：DashScope 文本生成能力（验证 key 有效性 + 网络 + JSON 输出）
 * 返回：每项的 success / latencyMs / statusCode / error
 */

const DASHSCOPE_BASE_URL =
  Deno.env.get("DASHSCOPE_BASE_URL") ??
  "https://dashscope.aliyuncs.com/compatible-mode/v1";
const DASHSCOPE_API_KEY = Deno.env.get("DASHSCOPE_API_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface TestResult {
  name: string;
  success: boolean;
  statusCode?: number;
  latencyMs: number;
  detail?: string;
  sample?: string;
}

async function testChat(): Promise<TestResult> {
  const start = Date.now();
  try {
    const res = await fetch(`${DASHSCOPE_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${DASHSCOPE_API_KEY}`,
      },
      body: JSON.stringify({
        model: "qwen-plus", // 用 plus 做连通测试，更快更便宜
        messages: [
          { role: "system", content: "你只输出 JSON。" },
          { role: "user", content: '返回 {"ok":true,"echo":"b5-test"}' },
        ],
        response_format: { type: "json_object" },
        temperature: 0,
      }),
    });
    const latencyMs = Date.now() - start;

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        name: "qwen-plus chat",
        success: false,
        statusCode: res.status,
        latencyMs,
        detail: text.slice(0, 200),
      };
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content ?? "";
    return {
      name: "qwen-plus chat",
      success: true,
      statusCode: 200,
      latencyMs,
      sample: content.slice(0, 120),
    };
  } catch (e) {
    return {
      name: "qwen-plus chat",
      success: false,
      latencyMs: Date.now() - start,
      detail: `网络异常: ${(e as Error).message}`,
    };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const tests: TestResult[] = [];
  tests.push(await testChat());

  const allSuccess = tests.every((t) => t.success);
  const verdict = allSuccess
    ? "PASS: Edge Function 可连通 DashScope，B5 验证通过"
    : "FAIL: 存在连通性问题，详见各项 detail";

  return new Response(
    JSON.stringify({
      success: allSuccess,
      verdict,
      baseUrl: DASHSCOPE_BASE_URL,
      keyConfigured: DASHSCOPE_API_KEY.length > 0,
      tests,
      note: "B5 验证：若 PASS 则 AI 链路可在 Edge Function 部署；若网络异常，则按 CP0 B5 降级方案迁阿里云 FC。",
    }),
    {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
});
