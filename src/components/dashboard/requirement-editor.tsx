"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { updateRequirement, deleteRequirement, confirmRequirement } from "@/app/dashboard/requirements/actions";
import { LIFECYCLE_LABELS, resolveSourceLabel } from "@/lib/requirements";
import type { RequirementDraft } from "@/types/database";
import { CopyButton } from "@/components/dashboard/copy-button";
import { track } from "@/lib/analytics";

interface Props {
  requirement: RequirementDraft;
  deleted: boolean;
}

const PRIORITIES = [
  { value: "high", label: "高优" },
  { value: "medium", label: "中" },
  { value: "low", label: "低" },
] as const;

const PRIORITY_COLOR: Record<string, string> = {
  high: "text-red-600",
  medium: "text-amber-600",
  low: "text-muted-foreground",
};

/**
 * Requirement 详情交互层（仿 meeting-item-card.tsx 的 editing/viewing 模式切换）。
 * 由详情 Server Component 注入 requirement 数据；本组件负责编辑/软删除的人机交互。
 */
export function RequirementEditor({ requirement, deleted }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(requirement.title);
  const [content, setContent] = useState(requirement.content);
  const [priority, setPriority] = useState<string>(requirement.priority);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // 已软删：只读展示 + 已删除提示，不提供编辑/删除
  if (deleted) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          ⚠ 此需求已被删除（数据已保留，仅列表不展示）。
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{requirement.title}</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {LIFECYCLE_LABELS[requirement.lifecycle]} · {requirement.priority}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-5">
          <div className="prose prose-sm max-w-none whitespace-pre-wrap">{requirement.content}</div>
        </div>
      </div>
    );
  }

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const r = await updateRequirement(requirement.id, { title, content, priority });
      if (!r.ok) setError(r.error);
      else setEditing(false);
    });
  }

  function handleDelete() {
    if (!confirm("确认删除这条需求？（软删除，数据保留，可联系恢复）")) return;
    startTransition(async () => {
      const r = await deleteRequirement(requirement.id);
      if (!r.ok) setError(r.error);
    });
  }

  /**
   * Confirm 关卡：draft → confirmed（04 工单）。
   * 成功后上报 requirement_confirmed 埋点（v2 北极星指标）。
   * 埋点点在客户端 onSuccess——server action 里的 track 为 no-op（服务端无 window）。
   */
  function handleConfirm() {
    setError(null);
    startTransition(async () => {
      const r = await confirmRequirement(requirement.id);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      // 成功后才上报，避免失败也计入转化
      await track("requirement_confirmed", {
        requirementId: requirement.id,
        sourceType: requirement.source_type,
        projectId: requirement.project_id,
      });
      // revalidatePath 已在 action 内触发，页面会自动刷新 lifecycle 展示
    });
  }

  if (editing) {
    return (
      <div className="space-y-4">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-lg font-bold focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={12}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            className="rounded-md border border-input bg-background px-2 py-1 text-xs"
          >
            {PRIORITIES.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setEditing(false)}
            disabled={isPending}
            className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isPending}
            className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {isPending ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    );
  }

  const sourceLabel = resolveSourceLabel(requirement.source_type) ?? null;

  return (
    <div className="space-y-4">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight">{requirement.title}</h1>
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {LIFECYCLE_LABELS[requirement.lifecycle]}
          </span>
          {sourceLabel && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {sourceLabel}
            </span>
          )}
        </div>
        <p className={`mt-1 text-xs ${PRIORITY_COLOR[requirement.priority] ?? ""}`}>
          优先级：{PRIORITIES.find((p) => p.value === requirement.priority)?.label}
          {requirement.is_edited && (
            <span className="ml-2 text-muted-foreground">· 已编辑</span>
          )}
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card p-5">
        <div className="prose prose-sm max-w-none whitespace-pre-wrap">{requirement.content}</div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <CopyButton text={requirement.content} />
        {requirement.lifecycle === "draft" && (
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isPending}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {isPending ? "确认中…" : "确认纳入需求池"}
          </button>
        )}
        {/*
          05 工单：生成 API 草稿入口 A。
          仅 confirmed 可点 → 跳 API 设计器新建页（带 requirementId 预填 title + business_requirement）；
          非 confirmed 置灰 + tooltip "请先确认需求"。
          纯跳转（router.push），不调 server action——提交由新建页表单触发 createApiDraft。
        */}
        {requirement.lifecycle === "confirmed" ? (
          <button
            type="button"
            onClick={() =>
              router.push(`/dashboard/api-designer/new?requirementId=${requirement.id}`)
            }
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            生成 API 草稿
          </button>
        ) : (
          <button
            type="button"
            disabled
            title="请先确认需求"
            className="cursor-not-allowed rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground"
          >
            生成 API 草稿
          </button>
        )}
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setEditing(true)}
          disabled={isPending}
          className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent"
        >
          编辑
        </button>
        <button
          type="button"
          onClick={handleDelete}
          disabled={isPending}
          className="rounded-md border border-destructive px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-50"
        >
          删除
        </button>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
