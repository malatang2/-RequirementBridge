"use server";

/**
 * API 设计器 Server Actions（M2）。
 * 对应《前后端接口契约 §2.1/§2.2》：业务需求 → Qwen 生成 OpenAPI → 版本管理。
 */

import { revalidatePath } from "next/cache";
import { createSupabaseActionClient } from "@/lib/supabase/action-client";
import { validateApiInput, nextVersionNumber } from "@/lib/api-designer";
import { publicEnv } from "@/lib/env";
import type { ApiDraft } from "@/types/database";

export type ApiDraftActionResult =
  | { ok: true; draftId: string }
  | { ok: false; error: string };

/** 创建草稿并触发 Qwen 生成 */
export async function createApiDraft(
  projectId: string,
  input: {
    businessRequirement?: unknown;
    apiSpecContext?: unknown;
    title?: string;
    sourceRequirementId?: string;
  }
): Promise<ApiDraftActionResult> {
  const validation = validateApiInput(input);
  if (!validation.ok) return { ok: false, error: validation.error };

  const supabase = await createSupabaseActionClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "未登录" };
  if (!projectId) return { ok: false, error: "请先选择项目" };

  const title = (typeof input.title === "string" && input.title.trim()) || "未命名接口";

  // 【05】源需求校验：传入时才校验（跨项目越权防护）。
  // RLS 只保证 user_id 隔离，但用户可能传别的项目的 requirement_id——
  // 故显式校验：存在 + 同项目 + lifecycle='confirmed' + 未软删。
  let sourceRequirementId: string | null = null;
  if (typeof input.sourceRequirementId === "string" && input.sourceRequirementId) {
    const { data: srcReq } = await supabase
      .from("requirement_drafts")
      .select("id, project_id, lifecycle, deleted_at")
      .eq("id", input.sourceRequirementId)
      .maybeSingle();
    if (
      !srcReq ||
      srcReq.project_id !== projectId ||
      srcReq.lifecycle !== "confirmed" ||
      srcReq.deleted_at !== null
    ) {
      return { ok: false, error: "源需求无效或未确认" };
    }
    sourceRequirementId = srcReq.id;
  }

  const { data: draft, error: insertError } = await supabase
    .from("api_drafts")
    .insert({
      user_id: user.id,
      project_id: projectId,
      title,
      business_requirement: validation.businessRequirement,
      api_spec_context: validation.apiSpecContext,
      status: "generating",
      source_requirement_id: sourceRequirementId,
    })
    .select()
    .single();

  if (insertError || !draft) {
    return { ok: false, error: "创建草稿失败，请重试" };
  }

  // 调 Edge Function 生成（异步，前端轮询 status）
  try {
    const res = await fetch(`${publicEnv.supabaseUrl}/functions/v1/api-generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token ?? ""}`,
      },
      body: JSON.stringify({
        draftId: draft.id,
        businessRequirement: validation.businessRequirement,
        apiSpecContext: validation.apiSpecContext,
      }),
    });
    if (!res.ok) {
      await supabase
        .from("api_drafts")
        .update({ status: "failed", error_message: "AI 生成服务暂不可用" })
        .eq("id", draft.id);
    }
  } catch {
    await supabase
      .from("api_drafts")
      .update({ status: "failed", error_message: "网络异常，请重试" })
      .eq("id", draft.id);
  }

  // PostHog track 已移至 api-designer/new 客户端组件（server runtime 无 window，原调用静默失效）

  revalidatePath("/dashboard/api-designer");
  return { ok: true, draftId: draft.id };
}

/** 重新生成（基于已有草稿） */
export async function regenerateApiDraft(draftId: string): Promise<ApiDraftActionResult> {
  const supabase = await createSupabaseActionClient();
  const { data: draft } = await supabase
    .from("api_drafts")
    .select("business_requirement, api_spec_context")
    .eq("id", draftId)
    .single();

  if (!draft) return { ok: false, error: "草稿不存在" };

  await supabase.from("api_drafts").update({ status: "generating" }).eq("id", draftId);

  try {
    await fetch(`${publicEnv.supabaseUrl}/functions/v1/api-generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token ?? ""}`,
      },
      body: JSON.stringify({
        draftId,
        businessRequirement: draft.business_requirement,
        apiSpecContext: draft.api_spec_context,
      }),
    });
  } catch {
    await supabase
      .from("api_drafts")
      .update({ status: "failed", error_message: "网络异常，请重试" })
      .eq("id", draftId);
  }

  revalidatePath("/dashboard/api-designer");
  return { ok: true, draftId };
}

/** 保存当前 YAML 为新版本（用户编辑后手动保存） */
export async function saveVersion(
  draftId: string,
  yaml: string
): Promise<{ ok: true; versionNumber: number } | { ok: false; error: string }> {
  const supabase = await createSupabaseActionClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "未登录" };

  // 取已有版本号
  const { data: versions } = await supabase
    .from("api_versions")
    .select("version_number")
    .eq("draft_id", draftId);
  const versionNumber = nextVersionNumber((versions as { version_number: number }[]) ?? []);

  const { data: newVersion, error } = await supabase
    .from("api_versions")
    .insert({
      draft_id: draftId,
      user_id: user.id,
      version_number: versionNumber,
      yaml_content: yaml,
      is_auto: false,
    })
    .select()
    .single();

  if (error || !newVersion) return { ok: false, error: "保存版本失败" };

  // 更新当前指针
  await supabase
    .from("api_drafts")
    .update({ current_version_id: newVersion.id, current_yaml: yaml, is_edited: true })
    .eq("id", draftId);

  revalidatePath("/dashboard/api-designer");
  return { ok: true, versionNumber };
}
