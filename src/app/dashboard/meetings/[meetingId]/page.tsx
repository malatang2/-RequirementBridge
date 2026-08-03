import { notFound } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Meeting, MeetingItem } from "@/types/database";
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  groupItemsByCategory,
  type MeetingExportData,
} from "@/lib/meetings";
import { MeetingDetailClient } from "./detail-client";
import { MeetingItemCard } from "@/components/dashboard/meeting-item-card";
import { AddItemInline } from "@/components/dashboard/add-item-inline";
import { MeetingExportBar } from "@/components/dashboard/meeting-export-bar";
import { MeetingBatchTransferButton } from "@/components/dashboard/meeting-batch-transfer-button";

export default async function MeetingDetailPage({
  params,
}: {
  params: Promise<{ meetingId: string }>;
}) {
  const { meetingId } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: meeting } = await supabase
    .from("meetings")
    .select("*")
    .eq("id", meetingId)
    .single();

  if (!meeting) notFound();

  const { data: itemsData } = await supabase
    .from("meeting_items")
    .select("*")
    .eq("meeting_id", meetingId)
    .order("created_at", { ascending: true });

  const meeting_ = meeting as Meeting;
  const items = (itemsData as MeetingItem[]) ?? [];
  const grouped = groupItemsByCategory(items);
  const isCompleted = meeting_.status === "completed";

  // 反查 meeting_item_id → analysis_id 映射（06 工单）
  // 查 feedback_items 中 source_type='meeting' 且本会议的条目，
  // 用于已转入条目显示"已转入反馈 →"角标深链到对应 analysis 详情页。
  // ADR-0002：source_meta 是出身溯源链接（非同步契约），此处只读不写。
  const itemIdToAnalysisId = new Map<string, string>();
  if (isCompleted) {
    const { data: linkedFeedbackItems } = await supabase
      .from("feedback_items")
      .select("id, analysis_id, source_meta")
      .eq("source_type", "meeting");
    for (const fi of (linkedFeedbackItems ?? []) as Array<{
      id: string;
      analysis_id: string;
      source_meta: Record<string, unknown> | null;
    }>) {
      const meta = fi.source_meta;
      if (meta && typeof meta === "object" && meta.meeting_id === meetingId) {
        const itemId = meta.meeting_item_id;
        if (typeof itemId === "string") {
          // 同一 meeting_item 理论上只转入一次（防重复转入），后写入覆盖前者
          itemIdToAnalysisId.set(itemId, fi.analysis_id);
        }
      }
    }
  }

  const exportData: MeetingExportData = {
    title: meeting_.title,
    summary: meeting_.summary,
    items: items.map((it) => ({
      id: it.id,
      category: it.category,
      content: it.content,
      assignee: it.assignee,
      priority: it.priority,
      quote: it.quote,
      quoteOffset: it.quote_offset,
    })),
    createdAt: meeting_.created_at,
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <Link
          href="/dashboard/meetings"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← 返回会议列表
        </Link>
        {isCompleted && <MeetingExportBar data={exportData} />}
      </div>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">{meeting_.title}</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          {new Date(meeting_.created_at).toLocaleString("zh-CN")}
          {meeting_.is_edited && (
            <span className="ml-2 rounded bg-muted px-1.5 py-0.5">已编辑</span>
          )}
        </p>
      </div>

      {/* 客户端组件：处理状态轮询 + 进行中/失败态 */}
      <MeetingDetailClient
        meetingId={meeting_.id}
        initialStatus={meeting_.status}
        errorMessage={meeting_.error_message}
      />

      {/* 摘要 */}
      {meeting_.summary && (
        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
            整体摘要
          </h2>
          <p className="text-sm leading-relaxed">{meeting_.summary}</p>
        </div>
      )}

      {/* 四类分组 */}
      {isCompleted && (
        <div className="space-y-6">
          {CATEGORY_ORDER.map((cat) => {
            const list = grouped[cat];
            return (
              <section key={cat}>
                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                  {CATEGORY_LABELS[cat]}
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    {list.length}
                  </span>
                  {/* issue 分组：批量转反馈入口（06 工单，ADR-0002 只转 issue） */}
                  {cat === "issue" && list.length > 0 && (
                    <MeetingBatchTransferButton
                      meetingId={meeting_.id}
                      issueItems={list}
                    />
                  )}
                </h2>
                <div className="space-y-2">
                  {list.map((item) => (
                    <MeetingItemCard
                      key={item.id}
                      item={item}
                      analysisId={itemIdToAnalysisId.get(item.id)}
                    />
                  ))}
                  <AddItemInline meetingId={meeting_.id} category={cat} />
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
