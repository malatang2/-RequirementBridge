"use client";

import { useState, useMemo, useTransition } from "react";
import yaml from "js-yaml";
import { saveVersion } from "@/app/dashboard/api-designer/actions";
import { analyzeOpenApiDoc } from "@/lib/api-designer";

interface Props {
  draftId: string;
  initialYaml: string;
}

/** 代码视图：可编辑 YAML + 实时校验（js-yaml 语法 + 结构检查） */
export function ApiCodeView({ draftId, initialYaml }: Props) {
  const [yamlText, setYamlText] = useState(initialYaml);
  const [isPending, startTransition] = useTransition();

  // 实时校验（js-yaml 解析 + 结构检查，对应 F11 前端层）
  const analysis = useMemo(() => {
    try {
      const doc = yaml.load(yamlText) as Record<string, unknown>;
      if (!doc || typeof doc !== "object") {
        return { parseable: false, error: "解析结果非对象", issues: ["解析结果非对象"] };
      }
      return analyzeOpenApiDoc(doc);
    } catch (e) {
      return { parseable: false, error: (e as Error).message, issues: [`YAML 语法错误: ${(e as Error).message}`] };
    }
  }, [yamlText]);

  const isDirty = yamlText !== initialYaml;
  const issues = analysis.issues ?? [];
  const allGood = analysis.parseable && issues.length === 0;

  function handleSave() {
    if (!analysis.parseable) return;
    startTransition(async () => {
      await saveVersion(draftId, yamlText);
    });
  }

  return (
    <div className="space-y-3">
      {/* 实时校验状态条 */}
      <div className={`rounded-md border p-2.5 text-xs ${
        allGood
          ? "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300"
          : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
      }`}>
        {allGood ? (
          <span>✅ YAML 合法 · 字段规范 · 错误码完整</span>
        ) : (
          <div className="space-y-0.5">
            <div className="font-medium">⚠️ 发现 {issues.length} 个问题：</div>
            {issues.map((iss, i) => (
              <div key={i} className="pl-2">• {iss}</div>
            ))}
          </div>
        )}
      </div>

      {/* YAML 编辑区 */}
      <textarea
        value={yamlText}
        onChange={(e) => setYamlText(e.target.value)}
        rows={24}
        spellCheck={false}
        className="w-full rounded-md border border-input bg-muted/30 p-3 font-mono text-xs leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring"
      />

      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {isDirty ? "未保存的修改" : "已是最新"}
        </span>
        <button
          type="button"
          onClick={handleSave}
          disabled={!isDirty || !analysis.parseable || isPending}
          className="rounded-md bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {isPending ? "保存中…" : "保存为版本"}
        </button>
      </div>
    </div>
  );
}
