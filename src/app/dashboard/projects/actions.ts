"use server";

/**
 * 项目 CRUD Server Actions（T0.4）。
 * DB 薄封装，靠 RLS 隔离（user_id = auth.uid()）。
 * 对应 DoD：项目可创建/读取/更新/归档。
 */

import { revalidatePath } from "next/cache";
import { createSupabaseActionClient } from "@/lib/supabase/action-client";
import { validateProjectInput } from "@/lib/projects";
import type { Project } from "@/types/database";

export type ProjectActionResult =
  | { ok: true; project: Project }
  | { ok: false; error: string };

/** 获取当前用户的项目列表（不含归档） */
export async function listProjects(): Promise<Project[]> {
  const supabase = await createSupabaseActionClient();
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .is("archived_at", null)
    .order("created_at", { ascending: false });

  if (error) return [];
  return (data as Project[]) ?? [];
}

/** 创建项目 */
export async function createProject(
  input: Parameters<typeof validateProjectInput>[0]
): Promise<ProjectActionResult> {
  const validation = validateProjectInput(input);
  if (!validation.ok) {
    return { ok: false, error: validation.error ?? "输入无效" };
  }

  const supabase = await createSupabaseActionClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "未登录" };

  const { data, error } = await supabase
    .from("projects")
    .insert({
      user_id: user.id,
      name: validation.value!.name,
      description: validation.value!.description,
      api_spec_context: validation.value!.api_spec_context,
    })
    .select()
    .single();

  if (error) {
    return { ok: false, error: "创建项目失败，请重试" };
  }

  revalidatePath("/dashboard");
  return { ok: true, project: data as Project };
}

/** 更新项目 */
export async function updateProject(
  id: string,
  input: Parameters<typeof validateProjectInput>[0]
): Promise<ProjectActionResult> {
  const validation = validateProjectInput(input);
  if (!validation.ok) {
    return { ok: false, error: validation.error ?? "输入无效" };
  }

  const supabase = await createSupabaseActionClient();
  const { data, error } = await supabase
    .from("projects")
    .update({
      name: validation.value!.name,
      description: validation.value!.description,
      api_spec_context: validation.value!.api_spec_context,
    })
    .eq("id", id)
    .select()
    .single();

  if (error || !data) {
    return { ok: false, error: "更新项目失败" };
  }

  revalidatePath("/dashboard");
  return { ok: true, project: data as Project };
}

/** 归档项目（软删除） */
export async function archiveProject(id: string): Promise<ProjectActionResult> {
  const supabase = await createSupabaseActionClient();
  const { data, error } = await supabase
    .from("projects")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();

  if (error || !data) {
    return { ok: false, error: "归档项目失败" };
  }

  revalidatePath("/dashboard");
  return { ok: true, project: data as Project };
}
