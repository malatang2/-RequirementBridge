"use client";

/**
 * API 设计器列表（07 工单）。
 *
 * 拆分动机：视图切换是客户端交互（点击 toggle），但数据获取留在 Server Component。
 * 故 Server Component 把 drafts + requirements 查好后注入本 client 组件，
 * 这里只负责 toggle 状态 + 两种渲染形态。仿 requirement-filters.tsx 的 URL 驱动模式。
 *
 * URL 同步：`?view=grouped` 持久化视图偏好（刷新/分享可恢复）。默认 flat。
 *
 * 排序：分组顺序由 Server Component 在 DB 查询里排好（lifecycle/priority/updated_at，
 * 与 listRequirements 一致），客户端不再重排——避免排序逻辑分叉。
 */

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import yaml from "js-yaml";
import {
  API_STATUS_META,
  draftOriginLabel,
  extractFirstPathMethod,
  groupApiDraftsByRequirement,
} from "@/lib/api-designer";
import type { RequirementProjection } from "@/lib/api-designer";
import {
  LIFECYCLE_LABELS,
  PRIORITY_COLOR,
  PRIORITY_LABELS,
} from "@/lib/requirements";
import type { ApiDraft } from "@/types/database";

type ViewMode = "flat" | "grouped";

interface ApiDesignerListProps {
  drafts: ApiDraft[];
  /** 分组模式需要的需求元信息（Server Component 批量查好传入，已按 lifecycle/priority 排序） */
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

/** 分组视图：按 Requirement 分组展示（顺序由传入的 requirements 决定，已排序） */
function GroupedView({
  drafts,
  requirements,
}: {
  drafts: ApiDraft[];
  requirements: RequirementProjection[];
}) {
  const groups = groupApiDraftsByRequirement(drafts, requirements);

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
                    {LIFECYCLE_LABELS[g.requirement!.lifecycle]}
                  </span>
                  <span
                    className={`text-[10px] ${PRIORITY_COLOR[g.requirement!.priority]}`}
                  >
                    {PRIORITY_LABELS[g.requirement!.priority]}
                  </span>
                </div>
              )}
              <span className="text-xs text-muted-foreground">
                {g.drafts.length} 个接口
              </span>
            </header>

            {/* 组内接口清单：path + method + origin 标签 */}
            <ul className="divide-y divide-border">
              {g.drafts.map((d) => (
                <li key={d.id}>
                  <GroupedDraftRow draft={d} isUnattached={isUnattached} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/**
 * 组内单行：从 current_yaml 解析出首个 path + method；origin 标签仅在未归属组渲染
 * （命名组里组头已标需求，origin 是冗余信息）。origin 文案由 draftOriginLabel 决定：
 * 未归属 + null id → 自由创建；未归属 + 非 null id → 原属需求已删除（orphan）。
 * YAML 解析放客户端：仅分组视图用到，用 useState/useEffect 在挂载后解析（SSR 返回 null）。
 */
function GroupedDraftRow({
  draft,
  isUnattached,
}: {
  draft: ApiDraft;
  isUnattached: boolean;
}) {
  const meta = API_STATUS_META[draft.status];
  const endpoint = useFirstEndpoint(draft.current_yaml);
  const originLabel = draftOriginLabel(isUnattached, draft.source_requirement_id);

  return (
    <Link
      href={`/dashboard/api-designer/${draft.id}`}
      className="flex items-center justify-between gap-2 px-4 py-2.5 transition-colors hover:bg-muted/40"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{draft.title}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          {endpoint ? (
            <>
              <span className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase text-primary">
                {endpoint.method}
              </span>
              <span className="truncate font-mono text-[10px]">{endpoint.path}</span>
            </>
          ) : (
            <span className="text-[10px] italic">
              {draft.current_yaml ? "解析中…" : "无 YAML"}
            </span>
          )}
          {originLabel && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">{originLabel}</span>
          )}
        </div>
      </div>
      <span className={`shrink-0 text-xs font-medium ${meta.color}`}>{meta.label}</span>
    </Link>
  );
}

/**
 * 从 YAML 字符串解析首个 path + method（缓存解析结果，避免每次渲染重解析）。
 * 用 useState + useEffect：首渲染返回 null（避免 hydration mismatch，因 SSR 无法跑 yaml.load），
 * 挂载后异步解析。失败/空 YAML 永远返回 null。
 */
function useFirstEndpoint(
  currentYaml: string | null
): { path: string; method: string } | null {
  const [endpoint, setEndpoint] = useState<{ path: string; method: string } | null>(
    null
  );

  useEffect(() => {
    if (!currentYaml) {
      setEndpoint(null);
      return;
    }
    try {
      const doc = yaml.load(currentYaml);
      setEndpoint(extractFirstPathMethod(doc));
    } catch {
      setEndpoint(null);
    }
  }, [currentYaml]);

  return endpoint;
}
