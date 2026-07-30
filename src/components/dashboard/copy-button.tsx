"use client";

import { useState } from "react";

/** 复制到剪贴板按钮 */
export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  return (
    <button
      onClick={handleCopy}
      className="rounded-md border border-border px-4 py-2 text-sm hover:bg-accent"
    >
      {copied ? "✓ 已复制" : "复制"}
    </button>
  );
}
