"use client";

import { useState, useTransition } from "react";
import { addMeetingItem } from "@/app/dashboard/meetings/actions";
import { CATEGORY_LABELS } from "@/lib/meetings";
import type { MeetingItemCategory } from "@/types/database";

interface Props {
  meetingId: string;
  category: MeetingItemCategory;
}

/** 分类内的"+ 添加"内联新增条目 */
export function AddItemInline({ meetingId, category }: Props) {
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState("");
  const [assignee, setAssignee] = useState("");
  const [priority, setPriority] = useState<"high" | "medium" | "low">("medium");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleAdd() {
    setError(null);
    if (!content.trim()) {
      setError("内容不能为空");
      return;
    }
    startTransition(async () => {
      const r = await addMeetingItem(meetingId, {
        category,
        content,
        assignee: assignee || null,
        priority,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      // 重置
      setContent("");
      setAssignee("");
      setPriority("medium");
      setOpen(false);
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-md border border-dashed border-border py-1.5 text-xs text-muted-foreground hover:border-primary/40 hover:text-primary"
      >
        + 添加{CATEGORY_LABELS[category]}
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-primary/40 bg-card p-3">
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={2}
        autoFocus
        placeholder={`${CATEGORY_LABELS[category]}内容...`}
        className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value as typeof priority)}
          className="rounded-md border border-input bg-background px-2 py-1 text-xs"
        >
          <option value="high">高优</option>
          <option value="medium">中</option>
          <option value="low">低</option>
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
          onClick={() => setOpen(false)}
          disabled={isPending}
          className="rounded-md border border-border px-3 py-1 text-xs hover:bg-accent"
        >
          取消
        </button>
        <button
          type="button"
          onClick={handleAdd}
          disabled={isPending}
          className="rounded-md bg-primary px-3 py-1 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {isPending ? "添加中…" : "添加"}
        </button>
      </div>
    </div>
  );
}
