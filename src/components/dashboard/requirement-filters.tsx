"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { LIFECYCLE_LABELS, LIFECYCLE_ORDER, SOURCE_LABELS } from "@/lib/requirements";
import type { PriorityLevel, RequirementLifecycle } from "@/types/database";

/**
 * Requirement 列表筛选器（客户端，驱动 URL searchParams）。
 * 通过 useRouter 切换 query，Server Component 据此重新筛选——保持 v1 的服务端直查模式。
 */
const PRIORITY_OPTIONS: PriorityLevel[] = ["high", "medium", "low"];
const PRIORITY_LABELS: Record<PriorityLevel, string> = {
  high: "高优",
  medium: "中",
  low: "低",
};

const SOURCE_KEYS = ["feedback_topic", "meeting_item", "manual"] as const;

export function RequirementFilters() {
  const router = useRouter();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const lifecycle = params.get("lifecycle") ?? "";
  const priority = params.get("priority") ?? "";
  const source_type = params.get("source_type") ?? "";

  function apply(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    startTransition(() => router.push(`/dashboard/requirements?${next.toString()}`));
  }

  const baseSelect =
    "rounded-md border border-input bg-background px-2 py-1 text-xs disabled:opacity-50";

  return (
    <div className="flex flex-wrap gap-2">
      <select
        value={lifecycle}
        onChange={(e) => apply("lifecycle", e.target.value)}
        disabled={isPending}
        className={baseSelect}
        aria-label="按生命周期筛选"
      >
        <option value="">全部状态</option>
        {LIFECYCLE_ORDER.map((l: RequirementLifecycle) => (
          <option key={l} value={l}>{LIFECYCLE_LABELS[l]}</option>
        ))}
      </select>

      <select
        value={priority}
        onChange={(e) => apply("priority", e.target.value)}
        disabled={isPending}
        className={baseSelect}
        aria-label="按优先级筛选"
      >
        <option value="">全部优先级</option>
        {PRIORITY_OPTIONS.map((p) => (
          <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
        ))}
      </select>

      <select
        value={source_type}
        onChange={(e) => apply("source_type", e.target.value)}
        disabled={isPending}
        className={baseSelect}
        aria-label="按来源筛选"
      >
        <option value="">全部来源</option>
        {SOURCE_KEYS.map((s) => (
          <option key={s} value={s}>{SOURCE_LABELS[s]}</option>
        ))}
      </select>
    </div>
  );
}
