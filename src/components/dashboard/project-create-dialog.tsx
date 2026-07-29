"use client";

import { useState } from "react";
import { createProject } from "@/app/dashboard/projects/actions";

interface ProjectCreateDialogProps {
  open: boolean;
  onClose: () => void;
}

export function ProjectCreateDialog({ open, onClose }: ProjectCreateDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [apiSpecContext, setApiSpecContext] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsPending(true);

    const result = await createProject({ name, description, api_spec_context: apiSpecContext });
    setIsPending(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    // 重置并关闭
    setName("");
    setDescription("");
    setApiSpecContext("");
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md space-y-4 rounded-lg border border-border bg-card p-6 shadow-lg">
        <h2 className="text-lg font-semibold">新建项目</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="proj-name" className="text-sm font-medium">
              项目名称 <span className="text-destructive">*</span>
            </label>
            <input
              id="proj-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              required
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="proj-desc" className="text-sm font-medium">
              描述（选填）
            </label>
            <textarea
              id="proj-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="proj-spec" className="text-sm font-medium">
              API 规范上下文（选填）
            </label>
            <textarea
              id="proj-spec"
              value={apiSpecContext}
              onChange={(e) => setApiSpecContext(e.target.value)}
              rows={3}
              placeholder="团队 API 规范，如：统一 camelCase，错误码用 {code, message, data}..."
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
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
