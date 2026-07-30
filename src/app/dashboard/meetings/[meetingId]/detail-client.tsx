"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTaskStatus } from "@/hooks/use-task-status";
import type { TaskStatus } from "@/types/database";
import { createSupabaseClient } from "@/lib/supabase/client";

interface Props {
  meetingId: string;
  initialStatus: TaskStatus;
  errorMessage: string | null;
}

/**
 * 会议详情的客户端部分：处理进行中/失败态 + 状态轮询。
 * 完成后自动刷新页面（拉取最新条目）。
 */
export function MeetingDetailClient({
  meetingId,
  initialStatus,
  errorMessage,
}: Props) {
  const router = useRouter();
  const { status, isStale } = useTaskStatus({
    enabled: initialStatus === "uploading" || initialStatus === "transcribing" || initialStatus === "analyzing",
    initialStatus,
    fetcher: async () => {
      const supabase = createSupabaseClient();
      const { data } = await supabase
        .from("meetings")
        .select("status, updated_at")
        .eq("id", meetingId)
        .single();
      return {
        status: (data?.status as TaskStatus) ?? "failed",
        updatedAt: data?.updated_at ?? new Date().toISOString(),
      };
    },
  });

  // 完成时刷新页面拉取条目
  useEffect(() => {
    if (status === "completed") {
      router.refresh();
    }
  }, [status, router]);

  // 终态或初始完成：不渲染状态条
  if (initialStatus === "completed" && status === "completed") {
    return null;
  }

  if (status === "uploading" || status === "transcribing" || status === "analyzing") {
    const messages: Record<string, string> = {
      uploading: "上传中…",
      transcribing: "转录中…预计 1-2 分钟",
      analyzing: "AI 正在提取决策与待办…",
    };
    return (
      <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-4">
        <div className="flex items-center gap-3">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
            {messages[status] ?? "处理中…"}
          </span>
        </div>
      </div>
    );
  }

  if (status === "failed") {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4">
        <p className="text-sm font-medium text-red-700 dark:text-red-300">
          ❌ 处理失败{isStale ? "（超时）" : ""}
        </p>
        {errorMessage && (
          <p className="mt-1 text-xs text-red-600 dark:text-red-400">{errorMessage}</p>
        )}
        <button
          onClick={() => router.refresh()}
          className="mt-2 rounded-md border border-red-500/40 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-500/10 dark:text-red-300"
        >
          刷新重试
        </button>
      </div>
    );
  }

  return null;
}
