import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentProjectId } from "@/lib/current-project";
import type { RequirementDraft } from "@/types/database";

export default async function RequirementsPage() {
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
    .from("requirement_drafts")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  const drafts = (data as RequirementDraft[]) ?? [];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">需求草稿</h1>
        <p className="text-sm text-muted-foreground">
          由反馈主题生成的需求草稿汇总（可手动带入 API 设计器）
        </p>
      </div>

      {drafts.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-12 text-center">
          <p className="text-sm text-muted-foreground">还没有需求草稿</p>
          <p className="mt-2 text-xs text-muted-foreground">
            在「反馈洞察」中勾选主题，点「生成需求草稿」即可创建
          </p>
          <Link
            href="/dashboard/feedback"
            className="mt-3 inline-block text-sm font-medium text-primary hover:underline"
          >
            去反馈洞察 →
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {drafts.map((d) => (
            <Link
              key={d.id}
              href={`/dashboard/requirements/${d.id}`}
              className="block rounded-lg border border-border bg-card p-4 transition-shadow hover:shadow-md"
            >
              <div className="flex items-center justify-between">
                <h3 className="font-medium">{d.title}</h3>
                {d.source_type === "feedback_topic" && (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    💬 来自反馈
                  </span>
                )}
              </div>
              <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                {d.content.replace(/^#+\s*/gm, "").slice(0, 100) || "（空内容）"}
                {d.content.length > 100 ? "..." : ""}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                {new Date(d.created_at).toLocaleString("zh-CN")}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
