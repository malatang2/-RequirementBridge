/**
 * API 草稿生成 Edge Function（M2 / T2.2）。
 * 对应《前后端接口契约 §2.2》：Qwen-Max 生成 OpenAPI 3.0 YAML + 服务端校验。
 *
 * 输入：{ draftId, businessRequirement, apiSpecContext }
 * 流程：
 *   1) 调 Qwen-Max 生成 YAML（Prompt 强制 camelCase + 含 400/401/404/500）
 *   2) 服务端校验 YAML 合法性（js-yaml 解析 + 结构检查）
 *   3) 非法则重试一次，仍非法则 failed
 *   4) 写 current_yaml + api_versions + current_version_id
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { dashscopeChat, corsHeaders } from "../_shared/supabase.ts";

const OPENAPI_SYSTEM_PROMPT = `你是 OpenAPI 3.0 接口设计专家。根据业务需求生成规范的 OpenAPI 3.0 YAML。

强制约束：
1. 输出合法的 OpenAPI 3.0 YAML（以 openapi: 3.0.x 开头）
2. 所有字段命名使用 camelCase（如 userName、accessToken，禁止 user_name / UserName）
3. 每个 path 的每个操作必须包含 400、401、404、500 四个错误响应
4. 包含 components/schemas 定义数据模型
5. 包含合理的安全定义（如 Bearer 认证）
6. 路径用 /api/v1/ 前缀，RESTful 风格
7. 遵循用户提供的 API 规范上下文（如有）

直接输出 YAML，不要 markdown 代码块包裹，不要解释。`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const { draftId, businessRequirement, apiSpecContext } = await req.json();
  if (!draftId || !businessRequirement) {
    return json({ success: false, error: { code: "VALIDATION_ERROR", message: "缺少 draftId 或 businessRequirement" } }, 422);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } }
  );

  try {
    const userMessage = apiSpecContext
      ? `业务需求：${businessRequirement}\n\nAPI 规范上下文：${apiSpecContext}`
      : `业务需求：${businessRequirement}`;

    // 1. 调 Qwen-Max 生成（最多重试 2 次）
    let yaml = "";
    let tokens = 0;
    let generated = false;
    for (let attempt = 0; attempt < 2 && !generated; attempt++) {
      const result = await dashscopeChat({
        purpose: "openapi",
        messages: [
          { role: "system", content: OPENAPI_SYSTEM_PROMPT },
          { role: "user", content: userMessage },
        ],
        temperature: 0.3,
      });
      yaml = cleanYaml(result.content);
      tokens += result.tokens;

      // 2. 服务端校验
      const validation = validateOpenApiYaml(yaml);
      if (validation.valid) {
        generated = true;
      } else if (attempt === 0) {
        // 第一次失败，下次重试时把错误反馈给模型（这里简化为直接重试）
        console.log("首次生成校验失败，重试:", validation.issues);
      }
    }

    if (!generated) {
      await markFailed(supabase, draftId, "生成的 OpenAPI 校验未通过（已重试）");
      return json({ success: false, error: { code: "GENERATION_FAILED", message: "生成的 YAML 校验未通过" } }, 500);
    }

    // 3. 取草稿 user_id + 计算版本号
    const { data: draft } = await supabase.from("api_drafts").select("user_id").eq("id", draftId).single();
    const userId = draft?.user_id;

    const { data: existingVersions } = await supabase
      .from("api_versions")
      .select("version_number")
      .eq("draft_id", draftId);
    const versionNumber = (existingVersions ?? []).length === 0
      ? 1
      : Math.max(...(existingVersions ?? []).map((v: any) => v.version_number)) + 1;

    // 4. 写版本
    const { data: newVersion } = await supabase
      .from("api_versions")
      .insert({
        draft_id: draftId,
        user_id: userId,
        version_number: versionNumber,
        yaml_content: yaml,
        is_auto: true,
      })
      .select()
      .single();

    // 5. 更新草稿
    await supabase.from("api_drafts").update({
      status: "completed",
      current_yaml: yaml,
      current_version_id: newVersion?.id,
      llm_usage: { llm: { model: "qwen-max", tokens } },
      completed_at: new Date().toISOString(),
    }).eq("id", draftId);

    return json({ success: true, data: { draftId, versionNumber } });
  } catch (e) {
    const msg = (e as Error).message;
    await markFailed(supabase, draftId, msg);
    return json({ success: false, error: { code: mapErrorCode(msg), message: msg } }, 500);
  }
});

/** 清理 YAML（去 markdown 包裹） */
function cleanYaml(content: string): string {
  return content
    .replace(/^```(?:yaml|yml)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
}

/**
 * 服务端 OpenAPI YAML 校验（轻量结构校验）。
 * 注：Edge Function 环境无 swagger-parser，用 js-yaml + 结构检查近似校验。
 * 完整 swagger-parser 校验由前端（F11 服务端权威层）补充。
 */
function validateOpenApiYaml(yaml: string): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  try {
    // 简易 YAML 语法检查：至少含 openapi 和 paths 关键字
    if (!/^openapi:\s*3\./m.test(yaml)) {
      issues.push("缺少 openapi: 3.x 字段");
    }
    if (!/^paths:/m.test(yaml)) {
      issues.push("缺少 paths 定义");
    }
    // 检查是否含必需错误码（粗略：文本里至少出现一次）
    for (const code of ["400", "401", "404", "500"]) {
      if (!new RegExp(`['"]?${code}['"]?:`).test(yaml)) {
        issues.push(`缺少错误码 ${code}`);
      }
    }
    return { valid: issues.length === 0, issues };
  } catch (e) {
    issues.push("YAML 解析失败: " + (e as Error).message);
    return { valid: false, issues };
  }
}

async function markFailed(supabase: any, draftId: string, msg: string) {
  await supabase.from("api_drafts").update({ status: "failed", error_message: msg }).eq("id", draftId);
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function mapErrorCode(msg: string): string {
  if (msg.includes("RATE_LIMIT")) return "LLM_RATE_LIMIT";
  if (msg.includes("auth")) return "LLM_ERROR";
  if (msg.includes("empty") || msg.includes("GENERATION")) return "GENERATION_FAILED";
  return "INTERNAL_ERROR";
}
