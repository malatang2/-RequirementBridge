"use client";

import { useState, useTransition } from "react";
import { updateMeetingItem, deleteMeetingItem } from "@/app/dashboard/meetings/actions";
import type { MeetingItem } from "@/types/database";
import { CATEGORY_LABELS, CATEGORY_ORDER } from "@/lib/meetings";

interface Props {
  item: MeetingItem;
}

const PRIORITIES = [
  { value: "high", label: "高优" },
  { value: "medium", label: "中" },
  { value: "low", label: "低" },
] as const;

export function MeetingItemCard({ item }: Props) {
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(item.content);
  const [assignee, setAssignee] = useState(item.assignee ?? "");
  const [priority, setPriority] = useState(item.priority);
  const [category, setCategory] = useState(item.category);
  const [error, setError] = useState<string | null>(null);
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
      {item.is_manual && (
        <span className="mt-1 inline-block rounded bg-muted px-1.5 text-[10px] text-muted-foreground">
          手动新增
        </span>
      )}
    </div>
  );
}
