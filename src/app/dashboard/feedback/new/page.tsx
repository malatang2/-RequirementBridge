"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createFeedbackAnalysis } from "../actions";
import { getCurrentProjectIdClient } from "@/lib/current-project-client";

export default function NewFeedbackPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [rawText, setRawText] = useState("");
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
    const result = await createFeedbackAnalysis(projectId, { title, rawText });
    setIsPending(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.push(`/dashboard/feedback/${result.analysisId}`);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">新建反馈分析</h1>
        <Link href="/dashboard/feedback" className="text-sm text-muted-foreground hover:text-foreground">
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
            placeholder="如：7 月用户反馈"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="rawText" className="text-sm font-medium">
            反馈内容 <span className="text-destructive">*</span>
            <span className="ml-2 font-normal text-muted-foreground">（每行一条）</span>
          </label>
          <textarea
            id="rawText"
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            rows={12}
            required
            placeholder={"每行一条反馈，例如：\n登录总是失败，很烦\n界面很好看，点赞\n希望增加导出功能\n加载速度太慢了"}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <p className="text-xs text-muted-foreground">
            ⚠️ 反馈内容将发送至阿里云百炼（国内）做聚类分析，数据不出境
          </p>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex justify-end gap-2">
          <Link
            href="/dashboard/feedback"
            className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-accent"
          >
            取消
          </Link>
          <button
            type="submit"
            disabled={isPending}
            className="rounded-md bg-primary px-6 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {isPending ? "创建中…" : "开始分析"}
          </button>
        </div>
      </form>
    </div>
  );
}
