"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createApiDraft } from "../actions";
import { getCurrentProjectIdClient } from "@/lib/current-project-client";
import { createSupabaseClient } from "@/lib/supabase/client";
import { track } from "@/lib/analytics";
import type { RequirementDraft } from "@/types/database";

/**
 * 新建 API 草稿页（M2 + 05 工单）。
 *
 * 两个入口汇入此页：
 *  - 入口 A：Requirement 详情页"生成 API 草稿" → 跳转带 ?requirementId=xxx 预填
 *  - 入口 B：本页"从需求选择"下拉 → 选中 confirmed Requirement 预填
 * 两条路径创建的 api_draft 都写 source_requirement_id 反向关联源 Requirement。
 *
 * useSearchParams() 需 Suspense 边界（Next 15 构建要求），故拆出内层表单组件。
 */
export default function NewApiDraftPage() {
  return (
    <Suspense fallback={<div className="text-sm text-muted-foreground">加载中…</div>}>
      <NewApiDraftForm />
    </Suspense>
  );
}

/** 下拉项精简结构（避免拉取整条 content 用于列表展示） */
interface RequirementOption {
  id: string;
  title: string;
  content: string;
}

function NewApiDraftForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryReqId = searchParams.get("requirementId");

  const [title, setTitle] = useState("");
  const [businessRequirement, setBusinessRequirement] = useState("");
  const [apiSpecContext, setApiSpecContext] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  // 入口 B：当前项目下 confirmed Requirement 列表
  const [options, setOptions] = useState<RequirementOption[]>([]);
  const [selectedReqId, setSelectedReqId] = useState<string>("");
  // sourceRequirementId：URL query 命中或下拉选中时锁定，handleSubmit 透传给 action
  const [sourceRequirementId, setSourceRequirementId] = useState<string | null>(null);

  // 拉取当前项目 confirmed Requirement 列表（入口 B 下拉数据源）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const projectId = await getCurrentProjectIdClient();
      if (!projectId) return;
      const supabase = createSupabaseClient();
      const { data } = await supabase
        .from("requirement_drafts")
        .select("id, title, content")
        .eq("project_id", projectId)
        .eq("lifecycle", "confirmed")
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (cancelled) return;
      setOptions((data as Pick<RequirementDraft, "id" | "title" | "content">[] | null) ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 入口 A：URL query ?requirementId=xxx 命中下拉时预填
  useEffect(() => {
    if (!queryReqId || options.length === 0) return;
    const matched = options.find((o) => o.id === queryReqId);
    if (!matched) return;
    setSelectedReqId(matched.id);
    setSourceRequirementId(matched.id);
    setTitle(matched.title);
    setBusinessRequirement(matched.content);
  }, [queryReqId, options]);

  // 下拉选择 → 预填（入口 B）；清空选择 → 解除关联但保留已填字段（用户可能想手动调整）
  function handleSelectChange(value: string) {
    setSelectedReqId(value);
    if (!value) {
      setSourceRequirementId(null);
      return;
    }
    const picked = options.find((o) => o.id === value);
    if (!picked) return;
    setSourceRequirementId(picked.id);
    setTitle(picked.title);
    setBusinessRequirement(picked.content);
  }

  const placeholderTitle = useMemo(() => "如：用户登录接口", []);

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
      sourceRequirementId: sourceRequirementId ?? undefined,
    });
    setIsPending(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    await track("api_generation_started", { draftId: result.draftId });
    // 仅在带 source 时上报：表征"需求→API 一键带入"转化（手动新建不属此路径）
    if (sourceRequirementId) {
      await track("requirement_to_api_triggered", {
        requirement_id: sourceRequirementId,
        draft_id: result.draftId,
      });
    }
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
        {/* 入口 B：从需求选择（confirmed Requirement 下拉） */}
        <div className="space-y-1.5">
          <label htmlFor="req" className="text-sm font-medium">从需求选择（选填）</label>
          <select
            id="req"
            value={selectedReqId}
            onChange={(e) => handleSelectChange(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">— 不关联需求，手动填写 —</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>{o.title}</option>
            ))}
          </select>
          {options.length === 0 && (
            <p className="text-xs text-muted-foreground">
              当前项目暂无已确认需求；可先在需求池确认一条，或直接手动填写。
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="title" className="text-sm font-medium">标题（选填）</label>
          <input
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={100}
            placeholder={placeholderTitle}
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
