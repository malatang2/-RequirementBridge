"use server";

/**
 * 反馈洞察 Server Actions（M3）。
 * 对应《前后端接口契约 §3.1/§3.2》：创建分析、合并/编辑/删除主题、生成需求草稿。
 */

import { revalidatePath } from "next/cache";
import { createSupabaseActionClient } from "@/lib/supabase/action-client";
import { validateFeedbackInput, filterTransferableItems } from "@/lib/feedback";
import { loadFeatureFlags, FEATURE_UNAVAILABLE_ERROR } from "@/lib/feature-flags";
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

/**
 * 会议 issue 条目转入反馈聚类池（06 工单）。
 *
 * ADR-0002 三条硬约束：
 *  1) 只转 category='issue'（filterTransferableItems 强制）
 *  2) Copy 快照单向不可逆——本次写入后双方独立编辑，不在此处建立同步
 *  3) Phase 1 每次新建独立 feedback_analysis，不合并既有 analysis（defer Phase 2）
 *
 * 流程：鉴权 → 拉取选中的 meeting_items → 纯函数过滤可转条目
 *      → 取会议标题 → 新建 analysis（source_label="来自会议《X》"）
 *      → 批量写 feedback_items（source_type='meeting', source_meta 含 meeting_id/meeting_item_id）
 *      → 回写 meeting_items.transferred_to_feedback=true（防重复转入 + 角标依据）
 *      → 触发 feedback-analyze EF（传 sourceItems，顺序与插入一致便于按位置回填）
 *      → revalidatePath
 *
 * 灰度（09）：requirement_hub flag off 时整个 action 拒绝（会议转入是
 * Phase 1 新能力；本文件其余 action 为 v1 原有功能，不 gate）。
 */
export async function transferMeetingItemsToFeedback(
  projectId: string,
  meetingId: string,
  itemIds: string[]
): Promise<FeedbackActionResult> {
  const supabase = await createSupabaseActionClient();
  const featureFlags = await loadFeatureFlags(supabase);
  if (!featureFlags.requirementHub) {
    return { ok: false, error: FEATURE_UNAVAILABLE_ERROR };
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "未登录" };
  if (!projectId) return { ok: false, error: "请先选择项目" };
  if (!meetingId) return { ok: false, error: "缺少会议 ID" };
  if (!Array.isArray(itemIds) || itemIds.length === 0) {
    return { ok: false, error: "请至少选择一条 issue 条目" };
  }

  // 1. 拉取选中条目（按 id 集合，单次查询）
  const { data: rawItems, error: queryError } = await supabase
    .from("meeting_items")
    .select("id, meeting_id, category, content, transferred_to_feedback")
    .in("id", itemIds);
  if (queryError) return { ok: false, error: "拉取会议条目失败" };

  // 2. 纯函数过滤可转条目（强制 issue-only + 未转入 + 本会议 + 非空）
  //    注意：即便前端传了非 issue 条目或已转条目，这里也会过滤掉——服务端是唯一真相源
  const valid = filterTransferableItems(rawItems ?? [], meetingId);
  if (valid.length === 0) {
    return { ok: false, error: "选中的条目无可转入反馈的 issue（可能已转入或非 issue 类）" };
  }

  // 3. 取会议标题，用于 source_label 溯源标注
  const { data: meeting } = await supabase
    .from("meetings")
    .select("title")
    .eq("id", meetingId)
    .single();
  const meetingTitle = (meeting?.title ?? "").trim() || "未命名会议";
  const sourceLabel = `来自会议《${meetingTitle}》`;

  // 4. 新建独立 feedback_analysis（Phase 1 不合并既有 analysis）
  //    input_mode='paste' 是聚类管线唯一支持的入口（EF 按 created_at 顺序回填 topic_id）
  const { data: analysis, error: insertAnalysisError } = await supabase
    .from("feedback_analyses")
    .insert({
      user_id: user.id,
      project_id: projectId,
      title: `${sourceLabel}的反馈`,
      source_label: sourceLabel,
      input_mode: "paste",
      total_count: valid.length,
      status: "analyzing",
    })
    .select()
    .single();
  if (insertAnalysisError || !analysis) {
    return { ok: false, error: "创建反馈分析失败，请重试" };
  }

  // 5. 批量写 feedback_items（带 source_type/source_meta 溯源）
  //    顺序与 valid 一致——EF 按 created_at asc 重新查询并按位置回填 topic_id
  const itemRows = valid.map((it) => ({
    analysis_id: analysis.id,
    user_id: user.id,
    content: it.content,
    source_type: "meeting",
    source_meta: { meeting_id: meetingId, meeting_item_id: it.id },
  }));
  const { error: insertItemsError } = await supabase.from("feedback_items").insert(itemRows);
  if (insertItemsError) {
    // 写 items 失败时把刚建的 analysis 标记为 failed，避免留下空壳
    await supabase
      .from("feedback_analyses")
      .update({ status: "failed", error_message: "写入会议条目快照失败" })
      .eq("id", analysis.id);
    return { ok: false, error: "保存反馈条目失败" };
  }

  // 6. 回写 meeting_items.transferred_to_feedback=true
  //    防重复转入 + MeetingItemCard 显示"已转入反馈 →"角标的依据
  const validIds = valid.map((it) => it.id);
  const { error: updateFlagError } = await supabase
    .from("meeting_items")
    .update({ transferred_to_feedback: true })
    .in("id", validIds);
  if (updateFlagError) {
    // 非致命：分析已建、聚类会跑，仅角标可能不显示。记日志即可，不回滚。
    console.warn("[transferMeetingItemsToFeedback] 回写 transferred_to_feedback 失败", {
      meetingId,
      itemIds: validIds,
      error: updateFlagError.message,
    });
  }

  // 7. 触发聚类 EF（传 sourceItems，顺序与插入一致）
  try {
    const res = await fetch(`${publicEnv.supabaseUrl}/functions/v1/feedback-analyze`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token ?? ""}`,
      },
      body: JSON.stringify({
        analysisId: analysis.id,
        sourceItems: valid.map((it) => ({
          content: it.content,
          source_type: "meeting",
          source_meta: { meeting_id: meetingId, meeting_item_id: it.id },
        })),
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

  // meeting_feedback_transferred 埋点由调用方客户端组件触发（server runtime 无 window，track 静默失效）

  revalidatePath(`/dashboard/meetings/${meetingId}`);
  revalidatePath("/dashboard/feedback");
  return { ok: true, analysisId: analysis.id };
}
