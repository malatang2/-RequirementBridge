"use client";

/**
 * API 设计器列表（07 工单）。
 *
 * 拆分动机：视图切换是客户端交互（点击 toggle），但数据获取留在 Server Component。
 * 故 Server Component 把 drafts + requirements 查好后注入本 client 组件，
 * 这里只负责 toggle 状态 + 两种渲染形态。仿 requirement-filters.tsx 的 URL 驱动模式。
 *
 * URL 同步：`?view=grouped` 持久化视图偏好（刷新/分享可恢复）。默认 flat。
 */

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { API_STATUS_META, groupApiDraftsByRequirement } from "@/lib/api-designer";
import type { RequirementProjection } from "@/lib/api-designer";
import { LIFECYCLE_LABELS, LIFECYCLE_ORDER } from "@/lib/requirements";
import type {
  ApiDraft,
  PriorityLevel,
  RequirementLifecycle,
} from "@/types/database";

type ViewMode = "flat" | "grouped";

const PRIORITY_LABELS: Record<PriorityLevel, string> = {
  high: "高优",
  medium: "中",
  low: "低",
};
const PRIORITY_COLOR: Record<PriorityLevel, string> = {
  high: "text-red-600",
  medium: "text-amber-600",
  low: "text-muted-foreground",
};

interface ApiDesignerListProps {
  drafts: ApiDraft[];
  /** 分组模式需要的需求元信息（Server Component 批量查好传入） */
  requirements: RequirementProjection[];
  /** 服务端从 ?view= 读出的初始视图（避免 hydration mismatch） */
  initialView: ViewMode;
}

export function ApiDesignerList({
  drafts,
  requirements,
  initialView,
}: ApiDesignerListProps) {
  const router = useRouter();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  // 以服务端注入的 initialView 为准（SSR 友好，避免 hydration mismatch）
  const view: ViewMode = initialView;

  function switchView(next: ViewMode) {
    if (next === view) return;
    const sp = new URLSearchParams(params.toString());
    if (next === "grouped") sp.set("view", "grouped");
    else sp.delete("view"); // flat 是默认，不持久化 query 保持 URL 干净
    startTransition(() => router.push(`/dashboard/api-designer?${sp.toString()}`));
  }

  return (
    <div className="space-y-4">
      {/* 视图切换 */}
      <div className="flex items-center gap-1" role="group" aria-label="视图切换">
        <ToggleButton
          active={view === "flat"}
          onClick={() => switchView("flat")}
          disabled={isPending}
        >
          平铺
        </ToggleButton>
        <ToggleButton
          active={view === "grouped"}
          onClick={() => switchView("grouped")}
          disabled={isPending}
        >
          按需求分组
        </ToggleButton>
      </div>

      {view === "flat" ? (
        <FlatView drafts={drafts} />
      ) : (
        <GroupedView drafts={drafts} requirements={requirements} />
      )}
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  disabled,
  children,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`rounded-md border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background text-muted-foreground hover:bg-muted"
      }`}
    >
      {children}
    </button>
  );
}

/** 平铺视图：照搬现状的卡片渲染 */
function FlatView({ drafts }: { drafts: ApiDraft[] }) {
  return (
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
  );
}

/** 分组视图：按 Requirement 分组展示 */
function GroupedView({
  drafts,
  requirements,
}: {
  drafts: ApiDraft[];
  requirements: RequirementProjection[];
}) {
  // 复用 03 的 lifecycle asc → priority asc 排序：分组顺序与需求池一致
  const lifecycleRank = new Map(LIFECYCLE_ORDER.map((l, i) => [l, i]));
  const priorityRank = new Map<PriorityLevel, number>([
    ["high", 0],
    ["medium", 1],
    ["low", 2],
  ]);
  const sortedReqs = [...requirements].sort((a, b) => {
    const la = lifecycleRank.get(a.lifecycle as RequirementLifecycle) ?? 99;
    const lb = lifecycleRank.get(b.lifecycle as RequirementLifecycle) ?? 99;
    if (la !== lb) return la - lb;
    const pa = priorityRank.get(a.priority as PriorityLevel) ?? 99;
    const pb = priorityRank.get(b.priority as PriorityLevel) ?? 99;
    if (pa !== pb) return pa - pb;
    // 兜底：标题稳定排序
    return a.title.localeCompare(b.title, "zh");
  });

  const groups = groupApiDraftsByRequirement(drafts, sortedReqs);

  if (groups.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        还没有 API 草稿
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {groups.map((g) => {
        const isUnattached = g.requirement === null;
        return (
          <section
            key={g.requirement?.id ?? "__unattached"}
            className="rounded-lg border border-border bg-card/50"
          >
            {/* 组头 */}
            <header
              className={`flex items-center justify-between gap-2 border-b border-border px-4 py-2.5 ${
                isUnattached ? "bg-muted/40" : ""
              }`}
            >
              {isUnattached ? (
                <h3 className="text-sm font-medium text-muted-foreground">
                  未归属
                  <span className="ml-2 text-xs font-normal text-muted-foreground/70">
                    未关联需求的接口
                  </span>
                </h3>
              ) : (
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-medium">{g.requirement!.title}</h3>
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {LIFECYCLE_LABELS[g.requirement!.lifecycle as RequirementLifecycle] ??
                      g.requirement!.lifecycle}
                  </span>
                  <span
                    className={`text-[10px] ${
                      PRIORITY_COLOR[g.requirement!.priority as PriorityLevel] ?? ""
                    }`}
                  >
                    {PRIORITY_LABELS[g.requirement!.priority as PriorityLevel] ??
                      g.requirement!.priority}
                  </span>
                </div>
              )}
              <span className="text-xs text-muted-foreground">
                {g.drafts.length} 个接口
              </span>
            </header>

            {/* 组内接口清单 */}
            <ul className="divide-y divide-border">
              {g.drafts.map((d) => {
                const meta = API_STATUS_META[d.status];
                return (
                  <li key={d.id}>
                    <Link
                      href={`/dashboard/api-designer/${d.id}`}
                      className="flex items-center justify-between gap-2 px-4 py-2.5 transition-colors hover:bg-muted/40"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{d.title}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {d.business_requirement}
                        </p>
                      </div>
                      <span className={`shrink-0 text-xs font-medium ${meta.color}`}>
                        {meta.label}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
