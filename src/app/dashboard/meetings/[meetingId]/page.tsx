import { notFound } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Meeting, MeetingItem } from "@/types/database";
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  groupItemsByCategory,
} from "@/lib/meetings";
import { MeetingDetailClient } from "./detail-client";

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
    .eq("meeting_id", meetingId);

  const meeting_ = meeting as Meeting;
  const items = (itemsData as MeetingItem[]) ?? [];
  const grouped = groupItemsByCategory(items);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <Link
          href="/dashboard/meetings"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← 返回会议列表
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">{meeting_.title}</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          {new Date(meeting_.created_at).toLocaleString("zh-CN")}
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
              </h2>
              {list.length === 0 ? (
                <p className="py-4 text-center text-xs text-muted-foreground">
                  无
                </p>
              ) : (
                <div className="space-y-2">
                  {list.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-lg border border-border bg-card p-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm">{item.content}</p>
                        <div className="flex shrink-0 gap-2 text-xs">
                          <PriorityTag priority={item.priority} />
                        </div>
                      </div>
                      <div className="mt-1.5 flex items-center gap-3 text-xs text-muted-foreground">
                        <span>
                          负责人：{item.assignee ?? "待分配"}
                        </span>
                      </div>
                      {item.quote && (
                        <p className="mt-2 border-l-2 border-muted pl-2 text-xs italic text-muted-foreground">
                          “{item.quote}”
                          {item.quote_offset === null && (
                            <span className="ml-1 text-amber-600">
                              ⚠ 引用未匹配原文
                            </span>
                          )}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function PriorityTag({ priority }: { priority: "high" | "medium" | "low" }) {
  const map = {
    high: { label: "高优", color: "text-red-600" },
    medium: { label: "中", color: "text-amber-600" },
    low: { label: "低", color: "text-muted-foreground" },
  };
  const m = map[priority];
  return <span className={m.color}>{m.label}</span>;
}
