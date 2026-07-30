import { notFound } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ApiDraft, ApiVersion } from "@/types/database";
import { ApiGenStatus } from "@/components/dashboard/api-gen-status";
import { ApiCodeView } from "@/components/dashboard/api-code-view";
import { ApiVisualView } from "./visual-view";
import { ApiExportBar } from "./export-bar";
import { RegenerateButton } from "./regenerate-button";

export default async function ApiDraftDetailPage({
  params,
}: {
  params: Promise<{ draftId: string }>;
}) {
  const { draftId } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: draft } = await supabase
    .from("api_drafts")
    .select("*")
    .eq("id", draftId)
    .single();

  if (!draft) notFound();

  const { data: versions } = await supabase
    .from("api_versions")
    .select("*")
    .eq("draft_id", draftId)
    .order("version_number", { ascending: false });

  const d = draft as ApiDraft;
  const versionList = (versions as ApiVersion[]) ?? [];
  const isCompleted = d.status === "completed";

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <Link href="/dashboard/api-designer" className="text-sm text-muted-foreground hover:text-foreground">
          ← 返回 API 设计器
        </Link>
        {isCompleted && (
          <div className="flex gap-2">
            <RegenerateButton draftId={d.id} />
            <ApiExportBar title={d.title} yaml={d.current_yaml ?? ""} />
          </div>
        )}
      </div>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">{d.title}</h1>
        <div className="mt-1.5 rounded-md border border-border bg-muted/30 p-3">
          <p className="text-xs font-medium text-muted-foreground">业务需求</p>
          <p className="mt-1 text-sm">{d.business_requirement}</p>
          {d.api_spec_context && (
            <>
              <p className="mt-2 text-xs font-medium text-muted-foreground">规范上下文</p>
              <p className="mt-1 text-xs text-muted-foreground">{d.api_spec_context}</p>
            </>
          )}
        </div>
      </div>

      <ApiGenStatus draftId={d.id} initialStatus={d.status} errorMessage={d.error_message} />

      {isCompleted && d.current_yaml && (
        <>
          {/* 双视图（代码视图为主，可视化视图独立页内切换） */}
          <div className="space-y-2">
            <h2 className="text-sm font-semibold">代码视图（可编辑 + 实时校验）</h2>
            <ApiCodeView draftId={d.id} initialYaml={d.current_yaml} />
          </div>

          <div className="space-y-2">
            <h2 className="text-sm font-semibold">可视化视图</h2>
            <ApiVisualView yaml={d.current_yaml} />
          </div>

          {/* 版本历史 */}
          <div className="space-y-2">
            <h2 className="text-sm font-semibold">
              版本历史（{versionList.length}）
            </h2>
            <div className="space-y-1.5">
              {versionList.map((v) => (
                <div
                  key={v.id}
                  className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-xs"
                >
                  <span>
                    v{v.version_number}
                    {v.id === d.current_version_id && (
                      <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-primary">当前</span>
                    )}
                    {v.is_auto ? "（自动）" : "（手动）"}
                  </span>
                  <span className="text-muted-foreground">
                    {new Date(v.generated_at).toLocaleString("zh-CN")}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
