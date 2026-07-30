import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentProjectId } from "@/lib/current-project";
import type { ApiDraft } from "@/types/database";
import { API_STATUS_META } from "@/lib/api-designer";

export default async function ApiDesignerPage() {
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
    .from("api_drafts")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  const drafts = (data as ApiDraft[]) ?? [];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">API 设计器</h1>
          <p className="text-sm text-muted-foreground">
            业务需求 → OpenAPI 3.0 草稿，代码/可视化双视图
          </p>
        </div>
        <Link
          href="/dashboard/api-designer/new"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          + 新建设计
        </Link>
      </div>

      {drafts.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-12 text-center">
          <p className="text-sm text-muted-foreground">还没有 API 草稿</p>
          <Link
            href="/dashboard/api-designer/new"
            className="mt-2 inline-block text-sm font-medium text-primary hover:underline"
          >
            新建第一个接口设计 →
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {drafts.map((d) => {
            const meta = API_STATUS_META[d.status];
            return (
              <Link
                key={d.id}
                href={`/dashboard/api-designer/${d.id}`}
                className="block rounded-lg border border-border bg-card p-4 transition-shadow hover:shadow-md"
              >
                <div className="flex items-center justify-between">
                  <h3 className="font-medium">{d.title}</h3>
                  <span className={`text-xs font-medium ${meta.color}`}>{meta.label}</span>
                </div>
                <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">
                  {d.business_requirement}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {new Date(d.created_at).toLocaleString("zh-CN")}
                </p>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
