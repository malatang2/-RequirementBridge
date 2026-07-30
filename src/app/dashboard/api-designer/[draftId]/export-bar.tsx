"use client";

import { useState } from "react";

interface Props {
  title: string;
  yaml: string;
}

/** 导出 YAML / JSON + 复制 */
export function ApiExportBar({ title, yaml: yamlText }: Props) {
  const [copied, setCopied] = useState(false);

  function download(filename: string, content: string, mime: string) {
    const blob = new Blob([content], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function exportJson() {
    try {
      // YAML → JSON（动态 import 避免客户端 require）
      const yamlMod = await import("js-yaml");
      const doc = yamlMod.load(yamlText);
      download(`${safeTitle}.json`, JSON.stringify(doc, null, 2), "application/json");
    } catch {
      download(`${safeTitle}.json`, "{}", "application/json");
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(yamlText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  const safeTitle = title.replace(/[\\/:*?"<>|]/g, "_");

  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={() => download(`${safeTitle}.yaml`, yamlText, "application/yaml")}
        className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
      >
        导出 YAML
      </button>
      <button
        type="button"
        onClick={exportJson}
        className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
      >
        导出 JSON
      </button>
      <button
        type="button"
        onClick={copy}
        className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
      >
        {copied ? "✓ 已复制" : "复制"}
      </button>
    </div>
  );
}
