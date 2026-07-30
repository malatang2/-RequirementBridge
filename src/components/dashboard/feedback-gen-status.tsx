"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTaskStatus } from "@/hooks/use-task-status";
import type { TaskStatus } from "@/types/database";
import { createSupabaseClient } from "@/lib/supabase/client";

interface Props {
  analysisId: string;
  initialStatus: TaskStatus;
  errorMessage: string | null;
}

/** 反馈分析状态轮询（analyzing → completed 刷新拉主题） */
export function FeedbackGenStatus({ analysisId, initialStatus, errorMessage }: Props) {
  const router = useRouter();
  const { status, isStale } = useTaskStatus({
    enabled: initialStatus === "uploading" || initialStatus === "analyzing",
    initialStatus,
    fetcher: async () => {
      const supabase = createSupabaseClient();
      const { data } = await supabase
        .from("feedback_analyses")
        .select("status, updated_at")
        .eq("id", analysisId)
        .single();
      return {
        status: (data?.status as TaskStatus) ?? "failed",
        updatedAt: data?.updated_at ?? new Date().toISOString(),
      };
    },
  });

  useEffect(() => {
    if (status === "completed") router.refresh();
  }, [status, router]);

  if (initialStatus === "completed" && status === "completed") return null;

  if (status === "uploading" || status === "analyzing") {
    return (
      <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-4">
        <div className="flex items-center gap-3">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
            AI 正在聚类分析反馈…
          </span>
        </div>
      </div>
    );
  }

  if (status === "failed") {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4">
        <p className="text-sm font-medium text-red-700 dark:text-red-300">
          ❌ 分析失败{isStale ? "（超时）" : ""}
        </p>
        {errorMessage && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{errorMessage}</p>}
        <button
          onClick={() => router.refresh()}
          className="mt-2 rounded-md border border-red-500/40 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-500/10 dark:text-red-300"
        >
          刷新
        </button>
      </div>
    );
  }

  return null;
}
