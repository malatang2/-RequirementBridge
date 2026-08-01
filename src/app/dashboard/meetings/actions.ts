"use server";

/**
 * 会议模块 Server Actions（M1）。
 * 文本模式：直接调 Edge Function（Qwen 提取）。
 * 音频模式：前端直传 Storage → 传 path 调 Edge Function（转录+提取）。
 */

import { revalidatePath } from "next/cache";
import { createSupabaseActionClient } from "@/lib/supabase/action-client";
import { validateTextMeetingInput } from "@/lib/meetings";
import { publicEnv } from "@/lib/env";

export type MeetingActionResult =
  | { ok: true; meetingId: string }
  | { ok: false; error: string };

/** 文本模式：创建会议并触发 Qwen 提取 */
export async function createTextMeeting(
  projectId: string,
  input: { title?: unknown; rawText?: unknown }
): Promise<MeetingActionResult> {
  const validation = validateTextMeetingInput(input);
  if (!validation.ok) {
    return { ok: false, error: validation.error };
  }
  // 类型守卫：text 模式必有 rawText
  if (validation.mode !== "text") {
    return { ok: false, error: "输入模式错误" };
  }

  const supabase = await createSupabaseActionClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "未登录" };
  if (!projectId) return { ok: false, error: "请先选择项目" };

  // 1. 建会议记录，status=analyzing（文本模式无 transcribing）
  const { data: meeting, error: insertError } = await supabase
    .from("meetings")
    .insert({
      user_id: user.id,
      project_id: projectId,
      title: validation.title,
      input_mode: "text",
      raw_text: validation.rawText,
      status: "analyzing",
    })
    .select()
    .single();

  if (insertError || !meeting) {
    return { ok: false, error: "创建会议失败，请重试" };
  }

  // 2. 调 Edge Function 做结构化提取（异步，前端轮询 status）
  try {
    const res = await fetch(
      `${publicEnv.supabaseUrl}/functions/v1/meeting-extract`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token ?? ""}`,
        },
        body: JSON.stringify({
          meetingId: meeting.id,
          text: validation.rawText,
        }),
      }
    );
    if (!res.ok) {
      // 提取请求失败，标记 failed（前端可重试）
      await supabase
        .from("meetings")
        .update({ status: "failed", error_message: "AI 提取服务暂不可用" })
        .eq("id", meeting.id);
    }
  } catch (e) {
    await supabase
      .from("meetings")
      .update({ status: "failed", error_message: "网络异常，请重试" })
      .eq("id", meeting.id);
  }

  // PostHog 埋点（T4.2）
  const { track } = await import("@/lib/analytics");
  await track("meeting_created", { meetingId: meeting.id, mode: "text" });

  revalidatePath("/dashboard/meetings");
  return { ok: true, meetingId: meeting.id };
}

/** 音频模式：建会议记录（前端已上传音频到 Storage） */
export async function createAudioMeeting(
  projectId: string,
  input: { title: string; audioPath: string; audioFilename: string; audioSizeBytes: number }
): Promise<MeetingActionResult> {
  const supabase = await createSupabaseActionClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "未登录" };
  if (!projectId) return { ok: false, error: "请先选择项目" };

  const { data: meeting, error } = await supabase
    .from("meetings")
    .insert({
      user_id: user.id,
      project_id: projectId,
      title: input.title.trim(),
      input_mode: "audio",
      audio_path: input.audioPath,
      audio_filename: input.audioFilename,
      audio_size_bytes: input.audioSizeBytes,
      status: "transcribing",
    })
    .select()
    .single();

  if (error || !meeting) {
    return { ok: false, error: "创建会议失败，请重试" };
  }

  // 触发转录 Edge Function（音频→fun-asr→提取，全链路在 Edge Function 内完成）
  try {
    await fetch(`${publicEnv.supabaseUrl}/functions/v1/meeting-transcribe`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token ?? ""}`,
      },
      body: JSON.stringify({ meetingId: meeting.id }),
    });
  } catch {
    // 网络异常标记 failed
    await supabase
      .from("meetings")
      .update({ status: "failed", error_message: "转录服务暂不可用" })
      .eq("id", meeting.id);
  }

  revalidatePath("/dashboard/meetings");
  return { ok: true, meetingId: meeting.id };
}

// ============ T1.5 条目编辑/增删/改优先级 ============

export type ItemActionResult = { ok: true } | { ok: false; error: string };

/** 编辑条目（内容/负责人/优先级/分类） */
export async function updateMeetingItem(
  itemId: string,
  patch: {
    content?: string;
    assignee?: string | null;
    priority?: "high" | "medium" | "low";
    category?: "decision" | "todo" | "requirement" | "issue";
  }
): Promise<ItemActionResult> {
  if (patch.content !== undefined && !patch.content.trim()) {
    return { ok: false, error: "内容不能为空" };
  }
  const supabase = await createSupabaseActionClient();
  const update: Record<string, unknown> = { is_edited: true };
  if (patch.content !== undefined) update.content = patch.content.trim();
  if (patch.assignee !== undefined) update.assignee = patch.assignee?.trim() || null;
  if (patch.priority !== undefined) update.priority = patch.priority;
  if (patch.category !== undefined) update.category = patch.category;

  const { error } = await supabase.from("meeting_items").update(update).eq("id", itemId);
  if (error) return { ok: false, error: "更新失败" };
  revalidatePath("/dashboard/meetings");
  return { ok: true };
}

/** 删除条目 */
export async function deleteMeetingItem(itemId: string): Promise<ItemActionResult> {
  const supabase = await createSupabaseActionClient();
  const { error } = await supabase.from("meeting_items").delete().eq("id", itemId);
  if (error) return { ok: false, error: "删除失败" };
  revalidatePath("/dashboard/meetings");
  return { ok: true };
}

/** 手动新增条目 */
export async function addMeetingItem(
  meetingId: string,
  input: {
    category: "decision" | "todo" | "requirement" | "issue";
    content: string;
    assignee?: string | null;
    priority?: "high" | "medium" | "low";
  }
): Promise<ItemActionResult> {
  if (!input.content.trim()) return { ok: false, error: "内容不能为空" };

  const supabase = await createSupabaseActionClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "未登录" };

  const { error } = await supabase.from("meeting_items").insert({
    meeting_id: meetingId,
    user_id: user.id,
    category: input.category,
    content: input.content.trim(),
    assignee: input.assignee?.trim() || null,
    priority: input.priority ?? "medium",
    is_edited: true,
    is_manual: true, // 手动新增，触发器会标记 meeting.is_edited
  });
  if (error) return { ok: false, error: "新增失败" };
  revalidatePath("/dashboard/meetings");
  return { ok: true };
}
