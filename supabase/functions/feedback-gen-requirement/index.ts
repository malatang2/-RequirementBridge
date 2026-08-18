/**
 * 需求草稿生成 Edge Function（M3 衍生）。
 * 对应《前后端接口契约 §3.3》：勾选主题 → Qwen-Plus 生成需求草稿。
 *
 * 输入：{ projectId, userId, topicIds }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { dashscopeChat, corsHeaders } from "../_shared/supabase.ts";

const DRAFT_SYSTEM_PROMPT = `你是产品需求文档撰写专家。根据用户反馈主题，生成结构化的需求草稿。

输出 Markdown 格式，包含：
## 背景（反馈现象与影响）
## 目标
## 验收标准

直接输出 Markdown，不要代码块包裹。`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const { projectId, userId, topicIds } = await req.json();
  if (!projectId || !userId || !Array.isArray(topicIds) || topicIds.length === 0) {
    return json({ success: false, error: { code: "VALIDATION_ERROR", message: "参数缺失" } }, 422);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } }
  );

  try {
    // 1. 取主题内容
    const { data: topics } = await supabase
      .from("feedback_topics")
      .select("name, summary, frequency, sentiment, priority, sample_feedback")
      .in("id", topicIds);
    if (!topics || topics.length === 0) {
      return json({ success: false, error: { code: "NOT_FOUND", message: "主题不存在" } }, 404);
    }

    // 2. 拼 Prompt
    const topicDesc = topics.map((t: any) =>
      `【${t.name}】频次${t.frequency}，情感${t.sentiment}，优先级${t.priority}\n摘要：${t.summary ?? "无"}\n样本：${(t.sample_feedback ?? []).join(" / ")}`
    ).join("\n\n");

    const { content, tokens } = await dashscopeChat({
      purpose: "draft",
      messages: [
        { role: "system", content: DRAFT_SYSTEM_PROMPT },
        { role: "user", content: `基于以下反馈主题生成需求草稿：\n\n${topicDesc}` },
      ],
    });

    // 3. 取首个主题名作为标题
    const title = topics.length === 1 ? topics[0].name + "优化" : "反馈聚合需求";

    // 4. 写 requirement_drafts
    // lifecycle 显式 'draft'：AI 生成的草稿需 PM 人工确认（04 工单 Confirm 关卡）才进 backlog，
    // 对应 ADR-0002 信号降噪——不依赖 DB 默认值，让业务意图在代码里可见。
    const { data: draft, error } = await supabase.from("requirement_drafts").insert({
      user_id: userId,
      project_id: projectId,
      source_type: "feedback_topic",
      source_topic_id: topicIds[0],
      title,
      content: content.trim(),
      status: "completed",
      lifecycle: "draft",
    }).select().single();

    if (error || !draft) {
      return json({ success: false, error: { code: "INTERNAL_ERROR", message: "保存草稿失败" } }, 500);
    }

    return json({ success: true, data: { requirementId: draft.id, title } });
  } catch (e) {
    const msg = (e as Error).message;
    return json({ success: false, error: { code: mapErrorCode(msg), message: msg } }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function mapErrorCode(msg: string): string {
  if (msg.includes("RATE_LIMIT")) return "LLM_RATE_LIMIT";
  if (msg.includes("empty") || msg.includes("GENERATION")) return "GENERATION_FAILED";
  return "INTERNAL_ERROR";
}
