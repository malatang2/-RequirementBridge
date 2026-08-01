import Link from "next/link";
import { Suspense } from "react";
import { getCurrentProjectId } from "@/lib/current-project";
import { listRequirements } from "@/app/dashboard/requirements/actions";
import { LIFECYCLE_LABELS, resolveSourceLabel } from "@/lib/requirements";
import { RequirementNewButton } from "@/components/dashboard/requirement-new-button";
import { RequirementFilters } from "@/components/dashboard/requirement-filters";
import type {
  PriorityLevel,
  RequirementDraft,
  RequirementLifecycle,
} from "@/types/database";

const PRIORITY_LABELS: Record<PriorityLevel, string> = {
  high: "高优",
  medium: "中",
  low: "低",
};
const PRIORITY_COLOR: Record<string, string> = {
  high: "text-red-600",
  medium: "text-amber-600",
  low: "text-muted-foreground",
};

export default async function RequirementsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const projectId = await getCurrentProjectId();

  if (!projectId) {
    return (
      <div className="mx-auto max-w-3xl py-12 text-center text-muted-foreground">
        请先在左上角选择一个项目。
      </div>
    );
  }

  const params = await searchParams;
  const single = (v: string | string[] | undefined) =>
    Array.isArray(v) ? v[0] : v;

  const drafts = await listRequirements(projectId, {
    lifecycle: (single(params.lifecycle) as RequirementLifecycle) || null,
    priority: (single(params.priority) as PriorityLevel) || null,
    source_type: single(params.source_type) || null,
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">需求池</h1>
          <p className="text-sm text-muted-foreground">
            统一管理来自反馈、会议与手动录入的产品需求
          </p>
        </div>
        <RequirementNewButton />
      </div>

      {/* useSearchParams 需要 Suspense 边界 */}
      <Suspense fallback={null}>
        <RequirementFilters />
      </Suspense>

      {drafts.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-12 text-center">
          <p className="text-sm text-muted-foreground">
            {params.lifecycle || params.priority || params.source_type
              ? "当前筛选下没有匹配的需求"
              : "需求池还是空的"}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            点右上角「+ 新建需求」手动创建，或在「反馈洞察」勾选主题生成草稿
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
          {drafts.map((d: RequirementDraft) => {
            const sourceLabel = resolveSourceLabel(d.source_type) ?? null;
            return (
              <Link
                key={d.id}
                href={`/dashboard/requirements/${d.id}`}
                className="block rounded-lg border border-border bg-card p-4 transition-shadow hover:shadow-md"
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-medium">{d.title}</h3>
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {LIFECYCLE_LABELS[d.lifecycle]}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                  {d.content.replace(/^#+\s*/gm, "").slice(0, 100) || "（空内容）"}
                  {d.content.length > 100 ? "..." : ""}
                </p>
                <div className="mt-2 flex items-center gap-2 text-xs">
                  <span className={PRIORITY_COLOR[d.priority] ?? "text-muted-foreground"}>
                    {PRIORITY_LABELS[d.priority]}
                  </span>
                  {sourceLabel && (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {sourceLabel}
                    </span>
                  )}
                  <span className="ml-auto text-muted-foreground">
                    {new Date(d.updated_at).toLocaleString("zh-CN")}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
