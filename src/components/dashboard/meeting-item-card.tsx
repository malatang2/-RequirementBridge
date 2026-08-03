"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { updateMeetingItem, deleteMeetingItem } from "@/app/dashboard/meetings/actions";
import { transferMeetingItemsToFeedback } from "@/app/dashboard/feedback/actions";
import { getCurrentProjectIdClient } from "@/lib/current-project-client";
import { track } from "@/lib/analytics";
import type { MeetingItem } from "@/types/database";
import { CATEGORY_LABELS, CATEGORY_ORDER } from "@/lib/meetings";

interface Props {
  item: MeetingItem;
  /**
   * 该条目对应的 feedback_analysis id（仅 transferred_to_feedback=true 时非空）。
   * 由会议详情页 server component 反查 feedback_items.source_meta 得到，
   * 用于"已转入反馈 →"角标深链。null 表示未转入或反查未命中。
   */
  analysisId?: string;
}

const PRIORITIES = [
  { value: "high", label: "高优" },
  { value: "medium", label: "中" },
  { value: "low", label: "低" },
] as const;

export function MeetingItemCard({ item, analysisId }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(item.content);
  const [assignee, setAssignee] = useState(item.assignee ?? "");
  const [priority, setPriority] = useState(item.priority);
  const [category, setCategory] = useState(item.category);
  const [error, setError] = useState<string | null>(null);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const r = await updateMeetingItem(item.id, {
        content,
        assignee: assignee || null,
        priority,
        category,
      });
      if (!r.ok) setError(r.error);
      else setEditing(false);
    });
  }

  function handleDelete() {
    if (!confirm("确认删除这条条目？")) return;
    startTransition(async () => {
      await deleteMeetingItem(item.id);
    });
  }

  /**
   * 单条转反馈（仅 issue 类显示入口）。
   * 走与批量相同的 transferMeetingItemsToFeedback action（itemId 数组长度为 1），
   * 服务端 filterTransferableItems 会再次校验 ADR-0002 约束（issue-only + 未转入）。
   */
  function handleTransferSingle() {
    setTransferError(null);
    if (!confirm("确认将这条 issue 转入反馈聚类？\n将进入反馈模块参与聚类，聚类后可能被合并/重命名，原条目保留不动。")) {
      return;
    }
    startTransition(async () => {
      const projectId = await getCurrentProjectIdClient();
      if (!projectId) {
        setTransferError("未检测到当前项目");
        return;
      }
      const r = await transferMeetingItemsToFeedback(projectId, item.meeting_id, [item.id]);
      if (!r.ok) {
        setTransferError(r.error);
        return;
      }
      await track("meeting_feedback_transferred", {
        meeting_id: item.meeting_id,
        item_count: 1,
      });
      router.refresh();
    });
  }

  if (editing) {
    return (
      <div className="rounded-lg border border-primary/40 bg-card p-3">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={2}
          className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as typeof category)}
            className="rounded-md border border-input bg-background px-2 py-1 text-xs"
          >
            {CATEGORY_ORDER.map((c) => (
              <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
            ))}
          </select>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value as typeof priority)}
            className="rounded-md border border-input bg-background px-2 py-1 text-xs"
          >
            {PRIORITIES.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
          <input
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
            placeholder="负责人（选填）"
            className="flex-1 rounded-md border border-input bg-background px-2 py-1 text-xs"
          />
        </div>
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
        <div className="mt-2 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setEditing(false)}
            disabled={isPending}
            className="rounded-md border border-border px-3 py-1 text-xs hover:bg-accent"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isPending}
            className="rounded-md bg-primary px-3 py-1 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {isPending ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    );
  }

  const priorityColor =
    item.priority === "high" ? "text-red-600" :
    item.priority === "medium" ? "text-amber-600" : "text-muted-foreground";

  return (
    <div className="group rounded-lg border border-border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm">{item.content}</p>
        <div className="flex shrink-0 gap-2 text-xs">
          <span className={priorityColor}>
            {PRIORITIES.find((p) => p.value === item.priority)?.label}
          </span>
        </div>
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>负责人：{item.assignee ?? "待分配"}</span>
        <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          {/* 单条转反馈入口：仅 issue + 未转入显示（ADR-0002 只转 issue） */}
          {item.category === "issue" && !item.transferred_to_feedback && (
            <button
              type="button"
              onClick={handleTransferSingle}
              disabled={isPending}
              className="rounded px-1.5 py-0.5 text-blue-600 hover:bg-blue-500/10 disabled:opacity-50"
              title="转入反馈模块参与 AI 聚类"
            >
              转反馈
            </button>
          )}
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded px-1.5 py-0.5 hover:bg-accent"
          >
            编辑
          </button>
          <button
            type="button"
            onClick={handleDelete}
            className="rounded px-1.5 py-0.5 text-destructive hover:bg-destructive/10"
          >
            删除
          </button>
        </div>
      </div>
      {item.quote && (
        <p className="mt-2 border-l-2 border-muted pl-2 text-xs italic text-muted-foreground">
          “{item.quote}”
          {item.quote_offset === null && (
            <span className="ml-1 text-amber-600">⚠ 引用未匹配原文</span>
          )}
        </p>
      )}
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        {item.is_manual && (
          <span className="rounded bg-muted px-1.5 text-[10px] text-muted-foreground">
            手动新增
          </span>
        )}
        {/* 溯源角标：已转入反馈，深链到对应 analysis 详情 */}
        {item.transferred_to_feedback && (
          analysisId ? (
            <Link
              href={`/dashboard/feedback/${analysisId}`}
              className="rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 hover:bg-blue-500/20 dark:text-blue-300"
              title="查看转入的反馈分析"
            >
              已转入反馈 →
            </Link>
          ) : (
            <span className="rounded bg-muted px-1.5 text-[10px] text-muted-foreground">
              已转入反馈
            </span>
          )
        )}
      </div>
      {transferError && (
        <p className="mt-1 text-xs text-destructive">{transferError}</p>
      )}
    </div>
  );
}
