"use server";

/**
 * 反馈洞察 Server Actions（M3）。
 * 对应《前后端接口契约 §3.1/§3.2》：创建分析、合并/编辑/删除主题、生成需求草稿。
 */

import { revalidatePath } from "next/cache";
import { createSupabaseActionClient } from "@/lib/supabase/action-client";
import { validateFeedbackInput } from "@/lib/feedback";
import { publicEnv } from "@/lib/env";

export type FeedbackActionResult =
  | { ok: true; analysisId: string }
  | { ok: false; error: string };

/** 创建反馈分析（粘贴模式）并触发 Qwen 聚类 */
export async function createFeedbackAnalysis(
  projectId: string,
  input: { title?: string; rawText?: unknown }
): Promise<FeedbackActionResult> {
  const validation = validateFeedbackInput(input.rawText);
  if (!validation.ok) return { ok: false, error: validation.error };

  const supabase = await createSupabaseActionClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "未登录" };
  if (!projectId) return { ok: false, error: "请先选择项目" };

  const title = (typeof input.title === "string" && input.title.trim()) || "反馈分析";

  // 1. 建分析记录
  const { data: analysis, error: insertError } = await supabase
    .from("feedback_analyses")
    .insert({
      user_id: user.id,
      project_id: projectId,
      title,
      input_mode: "paste",
      total_count: validation.items.length,
      status: "analyzing",
    })
    .select()
    .single();

  if (insertError || !analysis) {
    return { ok: false, error: "创建分析失败，请重试" };
  }

  // 2. 批量插入 feedback_items（无 topic_id）
  const itemRows = validation.items.map((content) => ({
    analysis_id: analysis.id,
    user_id: user.id,
    content,
  }));
  const { error: itemsError } = await supabase.from("feedback_items").insert(itemRows);
  if (itemsError) {
    return { ok: false, error: "保存反馈条目失败" };
  }

  // 3. 调 Edge Function 聚类（异步，前端轮询 status）
  try {
    const res = await fetch(`${publicEnv.supabaseUrl}/functions/v1/feedback-analyze`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token ?? ""}`,
      },
      body: JSON.stringify({
        analysisId: analysis.id,
        items: validation.items,
      }),
    });
    if (!res.ok) {
      await supabase
        .from("feedback_analyses")
        .update({ status: "failed", error_message: "AI 聚类服务暂不可用" })
        .eq("id", analysis.id);
    }
  } catch {
    await supabase
      .from("feedback_analyses")
      .update({ status: "failed", error_message: "网络异常，请重试" })
      .eq("id", analysis.id);
  }

  // PostHog track 已移至 feedback/new 客户端组件（server runtime 无 window，原调用静默失效）

  revalidatePath("/dashboard/feedback");
  return { ok: true, analysisId: analysis.id };
}

/** 合并主题：把 sourceTopic 下所有 feedback_items 的 topic_id 改为 targetTopic */
export async function mergeTopics(
  analysisId: string,
  sourceTopicId: string,
  targetTopicId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createSupabaseActionClient();
  // 把 source 主题下所有 items 改归 target（频次触发器自动同步）
  const { error } = await supabase
    .from("feedback_items")
    .update({ topic_id: targetTopicId })
    .eq("topic_id", sourceTopicId);

  if (error) return { ok: false, error: "合并失败" };

  // 删除 source 主题
  await supabase.from("feedback_topics").delete().eq("id", sourceTopicId);

  revalidatePath("/dashboard/feedback");
  return { ok: true };
}

/** 删除主题（feedback_items.topic_id 置 null） */
export async function deleteTopic(topicId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createSupabaseActionClient();
  const { error } = await supabase.from("feedback_topics").delete().eq("id", topicId);
  if (error) return { ok: false, error: "删除失败" };
  revalidatePath("/dashboard/feedback");
  return { ok: true };
}

/** 编辑主题（名称/摘要/优先级/情感） */
export async function updateTopic(
  topicId: string,
  patch: { name?: string; summary?: string; priority?: "high" | "medium" | "low"; sentiment?: "positive" | "negative" | "neutral" }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createSupabaseActionClient();
  const update: Record<string, unknown> = { is_edited: true };
  if (patch.name !== undefined) update.name = patch.name.trim();
  if (patch.summary !== undefined) update.summary = patch.summary;
  if (patch.priority !== undefined) update.priority = patch.priority;
  if (patch.sentiment !== undefined) update.sentiment = patch.sentiment;

  const { error } = await supabase.from("feedback_topics").update(update).eq("id", topicId);
  if (error) return { ok: false, error: "更新失败" };
  revalidatePath("/dashboard/feedback");
  return { ok: true };
}

/** 由选中主题生成需求草稿（调 Edge Function） */
export async function generateRequirementFromTopics(
  projectId: string,
  topicIds: string[]
): Promise<{ ok: true; requirementId: string } | { ok: false; error: string }> {
  const supabase = await createSupabaseActionClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "未登录" };
  if (!projectId) return { ok: false, error: "请先选择项目" };
  if (topicIds.length === 0) return { ok: false, error: "请至少选择一个主题" };

  try {
    const res = await fetch(`${publicEnv.supabaseUrl}/functions/v1/feedback-gen-requirement`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token ?? ""}`,
      },
      body: JSON.stringify({ projectId, userId: user.id, topicIds }),
    });
    const data = await res.json();
    if (!data.success) return { ok: false, error: data.error?.message ?? "生成失败" };

    revalidatePath("/dashboard/requirements");
    return { ok: true, requirementId: data.data.requirementId };
  } catch {
    return { ok: false, error: "网络异常，请重试" };
  }
}
