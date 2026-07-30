"use client";

import { useState } from "react";
import {
  exportMeetingToMarkdown,
  exportMeetingToCsv,
  type MeetingExportData,
} from "@/lib/meetings";

interface Props {
  data: MeetingExportData;
}

/** 导出栏：生成 MD/CSV 并触发下载 + 复制 */
export function MeetingExportBar({ data }: Props) {
  const [copied, setCopied] = useState<string | null>(null);

  function download(filename: string, content: string, mime: string) {
    const blob = new Blob([content], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setCopied("复制失败");
      setTimeout(() => setCopied(null), 1500);
    }
  }

  const safeTitle = data.title.replace(/[\\/:*?"<>|]/g, "_");

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => download(`${safeTitle}.md`, exportMeetingToMarkdown(data), "text/markdown")}
        className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
      >
        导出 Markdown
      </button>
      <button
        type="button"
        onClick={() => download(`${safeTitle}.csv`, exportMeetingToCsv(data), "text/csv")}
        className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
      >
        导出 CSV
      </button>
      <button
        type="button"
        onClick={() => copy(exportMeetingToMarkdown(data), "已复制 Markdown")}
        className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
      >
        复制
      </button>
      {copied && <span className="text-xs text-green-600">{copied}</span>}
    </div>
  );
}
