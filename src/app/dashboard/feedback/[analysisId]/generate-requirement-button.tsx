"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { generateRequirementFromTopics } from "../actions";
import { getCurrentProjectIdClient } from "@/lib/current-project-client";
import type { FeedbackTopic } from "@/types/database";

interface Props {
  analysisId: string;
  topics: FeedbackTopic[];
}

/** 生成需求草稿按钮：弹出主题选择 → 调生成 */
export function GenerateRequirementButton({ analysisId, topics }: Props) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  async function handleGenerate() {
    setError(null);
    const projectId = await getCurrentProjectIdClient();
    if (!projectId) {
      setError("请先选择项目");
      return;
    }
    startTransition(async () => {
      const r = await generateRequirementFromTopics(projectId, Array.from(selected));
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setOpen(false);
      router.push(`/dashboard/requirements/${r.requirementId}`);
    });
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        生成需求草稿
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md space-y-4 rounded-lg border border-border bg-card p-6 shadow-lg">
            <h2 className="text-lg font-semibold">选择主题生成需求草稿</h2>
            <p className="text-xs text-muted-foreground">勾选要转化为需求草稿的主题（可多选）</p>

            <div className="max-h-64 space-y-1.5 overflow-auto">
              {topics.map((t) => (
                <label
                  key={t.id}
                  className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-accent"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(t.id)}
                    onChange={() => toggle(t.id)}
                    className="accent-primary"
                  />
                  <span className="flex-1">{t.name}</span>
                  <span className="text-xs text-muted-foreground">{t.frequency} 条</span>
                </label>
              ))}
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setOpen(false); setSelected(new Set()); setError(null); }}
                className="rounded-md border border-border px-4 py-2 text-sm hover:bg-accent"
              >
                取消
              </button>
              <button
                onClick={handleGenerate}
                disabled={selected.size === 0 || isPending}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {isPending ? "生成中…" : `生成（${selected.size}）`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
