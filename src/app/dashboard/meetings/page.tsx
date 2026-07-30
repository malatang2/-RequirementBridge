import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentProjectId } from "@/lib/current-project";
import type { Meeting } from "@/types/database";
import { STATUS_META } from "@/components/dashboard/status-badge";

export default async function MeetingsPage() {
  const supabase = await createSupabaseServerClient();
  const projectId = await getCurrentProjectId();

  if (!projectId) {
    return (
      <div className="mx-auto max-w-3xl py-12 text-center text-muted-foreground">
        请先在左上角选择一个项目。
      </div>
    );
  }

  const { data } = await supabase
    .from("meetings")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  const meetings = (data as Meeting[]) ?? [];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">会议纪要</h1>
          <p className="text-sm text-muted-foreground">
            上传音频或粘贴文本，AI 提取决策/待办/需求/问题
          </p>
        </div>
        <Link
          href="/dashboard/meetings/new"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          + 新建会议
        </Link>
      </div>

      {meetings.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-12 text-center">
          <p className="text-sm text-muted-foreground">还没有会议记录</p>
          <Link
            href="/dashboard/meetings/new"
            className="mt-2 inline-block text-sm font-medium text-primary hover:underline"
          >
            新建第一场会议 →
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {meetings.map((m) => {
            const meta = STATUS_META[m.status];
            return (
              <Link
                key={m.id}
                href={`/dashboard/meetings/${m.id}`}
                className="block rounded-lg border border-border bg-card p-4 transition-shadow hover:shadow-md"
              >
                <div className="flex items-center justify-between">
                  <h3 className="font-medium">{m.title}</h3>
                  <span className={`text-xs font-medium ${meta.color}`}>
                    {meta.label}
                  </span>
                </div>
                {m.summary && (
                  <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">
                    {m.summary}
                  </p>
                )}
                <p className="mt-2 text-xs text-muted-foreground">
                  {new Date(m.created_at).toLocaleString("zh-CN")}
                </p>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
