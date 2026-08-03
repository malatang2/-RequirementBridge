"use server";

/**
 * Requirement CRUD Server Actions（v2 Phase 1 / 工单 03）。
 * DB 薄封装，靠 RLS 隔离（user_id = auth.uid()），仿 projects/actions.ts。
 *
 * 对应 DoD：Requirement 可创建/读取（含筛选）/更新/软删除。
 * 注意：lifecycle 流转（Confirm 关卡）属 04 工单，本层 create 仅固定写 'draft'。
 */

import { revalidatePath } from "next/cache";
import { createSupabaseActionClient } from "@/lib/supabase/action-client";
import { validateRequirementInput, describeTransition } from "@/lib/requirements";
import type {
  PriorityLevel,
  RequirementDraft,
  RequirementLifecycle,
} from "@/types/database";

export type RequirementActionResult =
  | { ok: true; requirement: RequirementDraft }
  | { ok: false; error: string };

/** 列表筛选条件（任一可为 null/undefined 表示不筛该维度） */
export interface RequirementFilters {
  lifecycle?: RequirementLifecycle | null;
  priority?: PriorityLevel | null;
  source_type?: string | null;
}

/**
 * 获取当前项目下的 Requirement 列表（排除软删）。
 * 排序：lifecycle asc（draft 在前）→ priority asc（high 在前，枚举序 high<medium<low）→ updated_at desc。
 */
export async function listRequirements(
  projectId: string,
  filters?: RequirementFilters
): Promise<RequirementDraft[]> {
  const supabase = await createSupabaseActionClient();
  let query = supabase
    .from("requirement_drafts")
    .select("*")
    .eq("project_id", projectId)
    .is("deleted_at", null);

  if (filters?.lifecycle) {
    query = query.eq("lifecycle", filters.lifecycle);
  }
  if (filters?.priority) {
    query = query.eq("priority", filters.priority);
  }
  if (filters?.source_type) {
    query = query.eq("source_type", filters.source_type);
  }

  // priority ascending=true → high(序1) < medium(序2) < low(序3)，即 high 在前
  query = query
    .order("lifecycle", { ascending: true })
    .order("priority", { ascending: true })
    .order("updated_at", { ascending: false });

  const { data, error } = await query;
  if (error) return [];
  return (data as RequirementDraft[]) ?? [];
}

/** 手动创建 Requirement（source_type='manual'，lifecycle='draft'，status='completed' 非 AI 生成） */
export async function createRequirement(
  projectId: string,
  input: Parameters<typeof validateRequirementInput>[0]
): Promise<RequirementActionResult> {
  const validation = validateRequirementInput(input);
  if (!validation.ok) {
    return { ok: false, error: validation.error ?? "输入无效" };
  }

  const supabase = await createSupabaseActionClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "未登录" };

  const { data, error } = await supabase
    .from("requirement_drafts")
    .insert({
      user_id: user.id,
      project_id: projectId,
      source_type: "manual",
      title: validation.value!.title,
      content: validation.value!.content,
      priority: validation.value!.priority,
      lifecycle: "draft", // 固定：手动创建一律从草稿开始，Confirm 关卡（04 工单）才推进
      status: "completed", // 非 AI 生成，无任务态
      is_edited: false,
    })
    .select()
    .single();

  if (error) {
    return { ok: false, error: "创建需求失败，请重试" };
  }

  revalidatePath("/dashboard/requirements");
  return { ok: true, requirement: data as RequirementDraft };
}

/** 更新 Requirement（标题/内容/优先级，is_edited=true） */
export async function updateRequirement(
  id: string,
  input: Parameters<typeof validateRequirementInput>[0]
): Promise<RequirementActionResult> {
  const validation = validateRequirementInput(input);
  if (!validation.ok) {
    return { ok: false, error: validation.error ?? "输入无效" };
  }

  const supabase = await createSupabaseActionClient();
  const { data, error } = await supabase
    .from("requirement_drafts")
    .update({
      title: validation.value!.title,
      content: validation.value!.content,
      priority: validation.value!.priority,
      is_edited: true,
    })
    .eq("id", id)
    .select()
    .single();

  if (error || !data) {
    return { ok: false, error: "更新需求失败" };
  }

  revalidatePath("/dashboard/requirements");
  revalidatePath(`/dashboard/requirements/${id}`);
  return { ok: true, requirement: data as RequirementDraft };
}

/** 软删除 Requirement（标记 deleted_at，不是 delete 行，数据保留） */
export async function deleteRequirement(id: string): Promise<RequirementActionResult> {
  const supabase = await createSupabaseActionClient();
  const { data, error } = await supabase
    .from("requirement_drafts")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();

  if (error || !data) {
    return { ok: false, error: "删除需求失败" };
  }

  revalidatePath("/dashboard/requirements");
  return { ok: true, requirement: data as RequirementDraft };
}

/**
 * Confirm 关卡：把 draft Requirement 推进到 confirmed（04 工单）。
 *
 * 业务意图（CONTEXT.md / Confirm 定义）：把 Requirement 从 draft 推进到
 * confirmed 的人工动作——只有经过 PM 拍板的才进 backlog。与 ADR-0002 的
 * 信号降噪精神一致（ADR-0002 把关「聚类后进 draft」，本关卡把关「draft 进 backlog」，
 * 是同一降噪链路上 draft 之后的那道闸）。本 action 只做 draft→confirmed 这一条
 * 流转（UI 唯一对应按钮）。
 *
 * 鉴权靠 RLS（user_id = auth.uid()），canTransition 把关非法流转
 * （如 delivered→draft、跨级跳跃、自环都会被拒）。
 *
 * 埋点说明：requirement_confirmed 的 track() 调用在客户端 RequirementEditor
 * 的 onClick 成功回调里（server 端 track 为 no-op，详见 analytics.ts）。
 */
export async function confirmRequirement(
  id: string
): Promise<RequirementActionResult> {
  const supabase = await createSupabaseActionClient();

  // 1. 读出当前 lifecycle，用纯函数把关流转合法性
  const { data: current, error: selectError } = await supabase
    .from("requirement_drafts")
    .select("id, lifecycle, source_type, project_id")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (selectError || !current) {
    return { ok: false, error: "需求不存在或已被删除" };
  }

  const from = current.lifecycle as RequirementLifecycle;
  const check = describeTransition(from, "confirmed");
  if (!check.ok) {
    return { ok: false, error: check.error };
  }

  // 2. 更新 lifecycle
  const { data, error } = await supabase
    .from("requirement_drafts")
    .update({ lifecycle: "confirmed" })
    .eq("id", id)
    .select()
    .single();

  if (error || !data) {
    return { ok: false, error: "确认需求失败，请重试" };
  }

  revalidatePath("/dashboard/requirements");
  revalidatePath(`/dashboard/requirements/${id}`);
  return { ok: true, requirement: data as RequirementDraft };
}
