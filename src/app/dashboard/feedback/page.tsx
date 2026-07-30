import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentProjectId } from "@/lib/current-project";
import type { FeedbackAnalysis } from "@/types/database";
import { STATUS_META } from "@/components/dashboard/status-badge";

export default async function FeedbackPage() {
  const supabase = await createSupabaseServerClient();
  const projectId = await getCurrentProjectId();

  if (!projectId) {
    return (
      <div className="mx-auto max-w-3xl py-12 text-center text-muted-foreground">
        请先在左上角选择一个项目。
      </div>
    );
  }

  const { data } = await supabase
    .from("feedback_analyses")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  const analyses = (data as FeedbackAnalysis[]) ?? [];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">反馈洞察</h1>
          <p className="text-sm text-muted-foreground">
            聚类/情感/频次/优先级，一键生成需求草稿
          </p>
        </div>
        <Link
          href="/dashboard/feedback/new"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          + 新建分析
        </Link>
      </div>

      {analyses.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-12 text-center">
          <p className="text-sm text-muted-foreground">还没有反馈分析</p>
          <Link
            href="/dashboard/feedback/new"
            className="mt-2 inline-block text-sm font-medium text-primary hover:underline"
          >
            新建第一次分析 →
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {analyses.map((a) => {
            const meta = STATUS_META[a.status];
            return (
              <Link
                key={a.id}
                href={`/dashboard/feedback/${a.id}`}
                className="block rounded-lg border border-border bg-card p-4 transition-shadow hover:shadow-md"
              >
                <div className="flex items-center justify-between">
                  <h3 className="font-medium">{a.title}</h3>
                  <span className={`text-xs font-medium ${meta.color}`}>{meta.label}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {a.total_count} 条反馈
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {new Date(a.created_at).toLocaleString("zh-CN")}
                </p>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
