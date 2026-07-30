import { notFound } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { RequirementDraft } from "@/types/database";
import { CopyButton } from "@/components/dashboard/copy-button";

export default async function RequirementDetailPage({
  params,
}: {
  params: Promise<{ requirementId: string }>;
}) {
  const { requirementId } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: draft } = await supabase
    .from("requirement_drafts")
    .select("*")
    .eq("id", requirementId)
    .single();

  if (!draft) notFound();
  const d = draft as RequirementDraft;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/dashboard/feedback" className="text-sm text-muted-foreground hover:text-foreground">
        ← 返回反馈
      </Link>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">{d.title}</h1>
        {d.source_type === "feedback_topic" && (
          <p className="mt-1 text-xs text-muted-foreground">💬 来源：反馈主题</p>
        )}
      </div>

      <div className="rounded-lg border border-border bg-card p-5">
        <div className="prose prose-sm max-w-none whitespace-pre-wrap">{d.content}</div>
      </div>

      <CopyButton text={d.content} />
    </div>
  );
}
