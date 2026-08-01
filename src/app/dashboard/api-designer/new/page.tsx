"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createApiDraft } from "../actions";
import { getCurrentProjectIdClient } from "@/lib/current-project-client";
import { track } from "@/lib/analytics";

export default function NewApiDraftPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [businessRequirement, setBusinessRequirement] = useState("");
  const [apiSpecContext, setApiSpecContext] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const projectId = await getCurrentProjectIdClient();
    if (!projectId) {
      setError("请先选择项目");
      return;
    }

    setIsPending(true);
    const result = await createApiDraft(projectId, {
      businessRequirement,
      apiSpecContext: apiSpecContext || undefined,
      title,
    });
    setIsPending(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    await track("api_generation_started", { draftId: result.draftId });
    router.push(`/dashboard/api-designer/${result.draftId}`);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">新建设计</h1>
        <Link href="/dashboard/api-designer" className="text-sm text-muted-foreground hover:text-foreground">
          ← 返回
        </Link>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-1.5">
          <label htmlFor="title" className="text-sm font-medium">标题（选填）</label>
          <input
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={100}
            placeholder="如：用户登录接口"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="br" className="text-sm font-medium">
            业务需求 <span className="text-destructive">*</span>
          </label>
          <textarea
            id="br"
            value={businessRequirement}
            onChange={(e) => setBusinessRequirement(e.target.value)}
            rows={5}
            required
            minLength={10}
            placeholder="描述接口要实现的功能，例如：实现邮箱+密码登录，校验凭证后返回 JWT，错误时返回明确错误码..."
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <p className="text-xs text-muted-foreground">
            ⚠️ 内容将发送至阿里云百炼（国内）生成 OpenAPI 3.0 定义
          </p>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="ctx" className="text-sm font-medium">API 规范上下文（选填）</label>
          <textarea
            id="ctx"
            value={apiSpecContext}
            onChange={(e) => setApiSpecContext(e.target.value)}
            rows={3}
            placeholder="团队 API 规范，如：统一 camelCase，错误码用 {code, message, data} 结构..."
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex justify-end gap-2">
          <Link
            href="/dashboard/api-designer"
            className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-accent"
          >
            取消
          </Link>
          <button
            type="submit"
            disabled={isPending}
            className="rounded-md bg-primary px-6 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {isPending ? "创建中…" : "生成 OpenAPI"}
          </button>
        </div>
      </form>
    </div>
  );
}
