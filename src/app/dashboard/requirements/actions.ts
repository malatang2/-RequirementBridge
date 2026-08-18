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
import { validateRequirementInput } from "@/lib/requirements";
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
