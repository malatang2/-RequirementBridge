"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { regenerateApiDraft } from "../actions";

interface Props {
  draftId: string;
}

/** 重新生成按钮 */
export function RegenerateButton({ draftId }: Props) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleRegenerate() {
    if (!confirm("确认重新生成？当前 YAML 会被新版本替换（历史版本保留）。")) return;
    startTransition(async () => {
      const r = await regenerateApiDraft(draftId);
      if (r.ok) router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={handleRegenerate}
      disabled={isPending}
      className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
    >
      {isPending ? "生成中…" : "🔄 重新生成"}
    </button>
  );
}
