/**
 * 会议结构化提取 Edge Function（M1 / T1.3）。
 * 对应《前后端接口契约 §1.5》：Qwen-Max 提取 决策/待办/需求/问题 + 摘要。
 *
 * 输入：{ meetingId, text }
 * 流程：1) 取会议记录 2) 调 Qwen-Max 提取 3) 写 meeting_items + summary 4) status=completed
 *
 * 注意：本函数运行在 Supabase Edge Function（Deno），通过服务端访问 Supabase DB。
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { dashscopeChat, corsHeaders } from "../_shared/supabase.ts";

const EXTRACTION_SYSTEM_PROMPT = `你是会议纪要结构化助手。从会议文本中提取四类条目，并输出严格 JSON。

提取类别：
- decision：明确达成的决策/结论
- todo：需执行的待办任务
- requirement：提出的产品/技术需求
- issue：未解决的遗留问题/风险

每条条目字段：
- category：decision | todo | requirement | issue
- content：简洁陈述（一句话）
- assignee：负责人姓名，无明确负责人则为 null
- priority：high | medium | low
- quote：原文中支撑该条目的原话，必须逐字来自输入文本（用于可追溯校验）

另输出 summary：2-4 句会议整体摘要。

仅输出 JSON，格式：{"summary":"...","items":[{"category":"...","content":"...","assignee":"...或null","priority":"...","quote":"..."}]}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const { meetingId, text } = await req.json();

  if (!meetingId || !text) {
    return new Response(JSON.stringify({ success: false, error: { code: "VALIDATION_ERROR", message: "缺少 meetingId 或 text" } }), {
      status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } }
  );

  try {
    // 1. 调 Qwen-Max 提取
    const { content, tokens } = await dashscopeChat({
      purpose: "extract",
      messages: [
        { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
        { role: "user", content: text },
      ],
      jsonMode: true,
    });

    // 2. 解析（容错：剥离可能的 markdown 包裹）
    let parsed: { summary?: string; items?: any[] };
    try {
      const cleaned = content.replace(/^```json\s*|\s*```$/g, "").trim();
      parsed = JSON.parse(cleaned);
    } catch {
      // JSON 解析失败 → 重试一次或落 failed
      await supabase.from("meetings").update({
        status: "failed",
        error_message: "AI 输出解析失败",
      }).eq("id", meetingId);
      return new Response(JSON.stringify({ success: false, error: { code: "GENERATION_FAILED", message: "AI 输出 JSON 解析失败" } }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. 后处理：计算 quote_offset + 规范化，批量写 meeting_items
    const { data: meeting } = await supabase
      .from("meetings")
      .select("user_id")
      .eq("id", meetingId)
      .single();
    const userId = meeting?.user_id;

    const items = (parsed.items ?? [])
      .filter((it: any) => typeof it.content === "string" && it.content.trim())
      .map((it: any) => {
        const quote = (typeof it.quote === "string" ? it.quote.trim() : "") || null;
        const quoteOffset = quote ? text.indexOf(quote) : null;
        return {
          meeting_id: meetingId,
          user_id: userId,
          category: normalizeCategory(it.category),
          content: it.content.trim(),
          assignee: (typeof it.assignee === "string" && it.assignee.trim()) ? it.assignee.trim() : null,
          priority: normalizePriority(it.priority),
          quote,
          quote_offset: quoteOffset >= 0 ? quoteOffset : null,
          is_edited: false,
          is_manual: false,
        };
      });

    if (items.length > 0) {
      const { error: insertError } = await supabase.from("meeting_items").insert(items);
      if (insertError) {
        console.error("insert meeting_items failed:", insertError);
      }
    }

    // 4. 更新会议状态
    await supabase.from("meetings").update({
      status: "completed",
      summary: (parsed.summary ?? "").trim() || "（未生成摘要）",
      llm_usage: { llm: { model: "qwen-max", tokens } },
      completed_at: new Date().toISOString(),
    }).eq("id", meetingId);

    return new Response(JSON.stringify({ success: true, data: { meetingId, itemCount: items.length } }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = (e as Error).message;
    await supabase.from("meetings").update({
      status: "failed",
      error_message: msg,
    }).eq("id", meetingId);
    return new Response(JSON.stringify({ success: false, error: { code: mapErrorCode(msg), message: msg } }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function normalizeCategory(raw?: string): string {
  const c = (raw ?? "").toLowerCase().trim();
  const map: Record<string, string> = {
    decision: "decision", 决策: "decision",
    todo: "todo", 待办: "todo", 任务: "todo",
    requirement: "requirement", 需求: "requirement",
    issue: "issue", 问题: "issue", 遗留问题: "issue",
  };
  return map[c] ?? "issue";
}

function normalizePriority(raw?: string): string {
  const p = (raw ?? "").toLowerCase().trim();
  if (p.startsWith("high") || p === "高" || p === "高优") return "high";
  if (p.startsWith("low") || p === "低") return "low";
  return "medium";
}

function mapErrorCode(msg: string): string {
  if (msg.includes("RATE_LIMIT")) return "LLM_RATE_LIMIT";
  if (msg.includes("auth")) return "LLM_ERROR";
  if (msg.includes("empty") || msg.includes("GENERATION")) return "GENERATION_FAILED";
  return "INTERNAL_ERROR";
}
