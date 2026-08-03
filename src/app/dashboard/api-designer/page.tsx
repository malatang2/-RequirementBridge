import Link from "next/link";
import { Suspense } from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentProjectId } from "@/lib/current-project";
import type { ApiDraft, RequirementDraft } from "@/types/database";
import { ApiDesignerList } from "@/components/dashboard/api-designer-list";
import type { RequirementProjection } from "@/lib/api-designer";

/**
 * API 设计器列表页（07 工单改造）。
 *
 * 架构：Server Component 查数据（drafts + 分组模式需要的需求元信息）→
 * 注入 <ApiDesignerList> client 组件做视图切换交互。
 * 仿 v1 projects/meetings 的「server 查数据 + 嵌套 client 子组件交互」模式。
 *
 * 视图偏好走 URL `?view=grouped`（与「选项目」用 cookie 的模式区别开），
 * 便于刷新保留 + 链接分享。
 */
export default async function ApiDesignerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const supabase = await createSupabaseServerClient();
  const projectId = await getCurrentProjectId();

  if (!projectId) {
    return (
      <div className="mx-auto max-w-3xl py-12 text-center text-muted-foreground">
        请先在左上角选择一个项目。
      </div>
    );
  }

  const params = await searchParams;
  const viewParam = Array.isArray(params.view) ? params.view[0] : params.view;
  const initialView: "flat" | "grouped" = viewParam === "grouped" ? "grouped" : "flat";

  // 平铺视图主查询（不变）
  const { data } = await supabase
    .from("api_drafts")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  const drafts = (data as ApiDraft[]) ?? [];

  // 分组视图：批量查相关 Requirement 的元信息（避免 N+1）。
  // 只查 drafts 里出现的 source_requirement_id（去重 + 过滤 null），
  // 排除软删需求（deleted_at 非空）——软删需求不展示组头（其接口自动归「未归属」）。
  const sourceIds = Array.from(
    new Set(
      drafts
        .map((d) => d.source_requirement_id)
        .filter((id): id is string => id !== null)
    )
  );

  let requirements: RequirementProjection[] = [];
  if (sourceIds.length > 0) {
    const { data: reqData } = await supabase
      .from("requirement_drafts")
      .select("id, title, lifecycle, priority, deleted_at")
      .in("id", sourceIds)
      .is("deleted_at", null);
    const reqs = (reqData as Pick<RequirementDraft, "id" | "title" | "lifecycle" | "priority" | "deleted_at">[] | null) ?? [];
    requirements = reqs.map((r) => ({
      id: r.id,
      title: r.title,
      lifecycle: r.lifecycle,
      priority: r.priority,
    }));
  }

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
        // useSearchParams 需 Suspense 边界（next.js 硬性要求）
        <Suspense fallback={null}>
          <ApiDesignerList
            drafts={drafts}
            requirements={requirements}
            initialView={initialView}
          />
        </Suspense>
      )}
    </div>
  );
}
