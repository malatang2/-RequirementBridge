"use client";

import { useMemo } from "react";
import yaml from "js-yaml";

interface Props {
  yaml: string;
}

/** 可视化视图：解析 YAML 渲染 Swagger 风格卡片 */
export function ApiVisualView({ yaml: yamlText }: Props) {
  const doc = useMemo(() => {
    try {
      return yaml.load(yamlText) as Record<string, unknown> | null;
    } catch {
      return null;
    }
  }, [yamlText]);

  if (!doc) {
    return (
      <div className="rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
        YAML 解析失败，无法渲染可视化视图
      </div>
    );
  }

  const paths = (doc.paths ?? {}) as Record<string, Record<string, unknown>>;
  const pathEntries = Object.entries(paths);

  if (pathEntries.length === 0) {
    return (
      <div className="rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
        无 paths 定义
      </div>
    );
  }

  const METHOD_COLORS: Record<string, string> = {
    get: "bg-blue-500/10 text-blue-600",
    post: "bg-green-500/10 text-green-600",
    put: "bg-amber-500/10 text-amber-600",
    patch: "bg-purple-500/10 text-purple-600",
    delete: "bg-red-500/10 text-red-600",
  };

  return (
    <div className="space-y-3">
      {pathEntries.map(([path, methods]) => (
        <div key={path} className="rounded-md border border-border bg-card p-3">
          {Object.entries(methods).map(([method, op]) => {
            if (!["get", "post", "put", "patch", "delete"].includes(method)) return null;
            const operation = op as {
              summary?: string;
              responses?: Record<string, { description?: string }>;
              parameters?: Array<{ name?: string; required?: boolean }>;
            };
            const responses = operation.responses ?? {};
            return (
              <div key={method} className="py-1.5">
                <div className="flex items-center gap-2">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${METHOD_COLORS[method] ?? ""}`}>
                    {method}
                  </span>
                  <code className="text-xs font-medium">{path}</code>
                </div>
                {operation.summary && (
                  <p className="mt-1 pl-1 text-xs text-muted-foreground">{operation.summary}</p>
                )}
                <div className="mt-1.5 flex flex-wrap gap-1 pl-1">
                  {Object.entries(responses).map(([code]) => (
                    <span
                      key={code}
                      className={`rounded px-1.5 py-0.5 text-[10px] ${
                        code.startsWith("2") ? "bg-green-500/10 text-green-600" :
                        code.startsWith("4") || code.startsWith("5") ? "bg-red-500/10 text-red-600" :
                        "bg-muted text-muted-foreground"
                      }`}
                    >
                      {code}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
