"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTaskStatus } from "@/hooks/use-task-status";
import type { GenStatus } from "@/types/database";
import { createSupabaseClient } from "@/lib/supabase/client";

interface Props {
  draftId: string;
  initialStatus: GenStatus;
  errorMessage: string | null;
}

/** API 草稿生成状态轮询（generating → completed 时刷新拉 YAML） */
export function ApiGenStatus({ draftId, initialStatus, errorMessage }: Props) {
  const router = useRouter();
  const { status, isStale } = useTaskStatus({
    enabled: initialStatus === "generating",
    initialStatus,
    fetcher: async () => {
      const supabase = createSupabaseClient();
      const { data } = await supabase
        .from("api_drafts")
        .select("status, updated_at")
        .eq("id", draftId)
        .single();
      return {
        status: (data?.status as GenStatus) ?? "failed",
        updatedAt: data?.updated_at ?? new Date().toISOString(),
      };
    },
  });

  useEffect(() => {
    if (status === "completed") router.refresh();
  }, [status, router]);

  if (initialStatus === "completed" && status === "completed") return null;

  if (status === "generating") {
    return (
      <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-4">
        <div className="flex items-center gap-3">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
            AI 正在生成 OpenAPI 定义…
          </span>
        </div>
      </div>
    );
  }

  if (status === "failed") {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4">
        <p className="text-sm font-medium text-red-700 dark:text-red-300">
          ❌ 生成失败{isStale ? "（超时）" : ""}
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
