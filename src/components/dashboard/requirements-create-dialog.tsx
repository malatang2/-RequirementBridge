"use client";

import { useState } from "react";
import { createRequirement } from "@/app/dashboard/requirements/actions";
import { getCurrentProjectIdClient } from "@/lib/current-project-client";

interface RequirementsCreateDialogProps {
  open: boolean;
  onClose: () => void;
}

const PRIORITIES = [
  { value: "high", label: "高优" },
  { value: "medium", label: "中" },
  { value: "low", label: "低" },
] as const;

/** 新建 Requirement 对话框（仿 project-create-dialog.tsx） */
export function RequirementsCreateDialog({ open, onClose }: RequirementsCreateDialogProps) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [priority, setPriority] = useState<string>("medium");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const projectId = await getCurrentProjectIdClient();
    if (!projectId) {
      setError("请先在左上角选择一个项目");
      return;
    }

    setIsPending(true);
    const result = await createRequirement(projectId, { title, content, priority });
    setIsPending(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    // 重置并关闭
    setTitle("");
    setContent("");
    setPriority("medium");
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg space-y-4 rounded-lg border border-border bg-card p-6 shadow-lg">
        <h2 className="text-lg font-semibold">新建需求</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="req-title" className="text-sm font-medium">
              标题 <span className="text-destructive">*</span>
            </label>
            <input
              id="req-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              required
              placeholder="一句话描述这条需求"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="req-content" className="text-sm font-medium">
              内容 <span className="text-destructive">*</span>
            </label>
            <textarea
              id="req-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={5}
              placeholder="需求详情：背景、目标、验收标准……"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="req-priority" className="text-sm font-medium">
              优先级
            </label>
            <select
              id="req-priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {PRIORITIES.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-accent"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {isPending ? "创建中…" : "创建"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
