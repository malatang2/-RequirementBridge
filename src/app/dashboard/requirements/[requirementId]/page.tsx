import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { RequirementDraft } from "@/types/database";
import { RequirementEditor } from "@/components/dashboard/requirement-editor";

export default async function RequirementDetailPage({
  params,
}: {
  params: Promise<{ requirementId: string }>;
}) {
  const { requirementId } = await params;
  const supabase = await createSupabaseServerClient();

  // 直链仍可访问软删记录（deleted_at 非空），由 Editor 展示"已删除"提示。
  const { data: draft } = await supabase
    .from("requirement_drafts")
    .select("*")
    .eq("id", requirementId)
    .maybeSingle();

  if (!draft) notFound();
  const d = draft as RequirementDraft;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        href="/dashboard/requirements"
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        ← 返回需求池
      </Link>

      <RequirementEditor requirement={d} deleted={d.deleted_at !== null} />
    </div>
  );
}
