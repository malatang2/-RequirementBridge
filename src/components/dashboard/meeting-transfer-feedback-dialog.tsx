"use client";

/**
 * 会议 issue 条目批量转入反馈聚类池弹窗（06 工单）。
 *
 * 触发位置：会议详情页 issue 分组标题旁的"批量转反馈"按钮。
 * 行为：
 *  - 多选当前会议的 issue 条目（已 transferred_to_feedback=true 的条目灰显且不可选，
 *    服务端 filterTransferableItems 会再次过滤，前后端一致防重复转入）
 *  - 文案明确告知 ADR-0002 Copy 快照语义（聚类后可能被合并/重命名，原条目保留不动）
 *  - 提交调 transferMeetingItemsToFeedback，成功后触发 meeting_feedback_transferred 埋点
 *    并 router.refresh() 让"已转入反馈 →"角标出现
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { transferMeetingItemsToFeedback } from "@/app/dashboard/feedback/actions";
import { getCurrentProjectIdClient } from "@/lib/current-project-client";
import { track } from "@/lib/analytics";
import type { MeetingItem } from "@/types/database";

interface Props {
  open: boolean;
  onClose: () => void;
  meetingId: string;
  /** 仅 category='issue' 的条目由调用方传入 */
  issueItems: MeetingItem[];
}

export function MeetingTransferFeedbackDialog({
  open,
  onClose,
  meetingId,
  issueItems,
}: Props) {
  const router = useRouter();
  // 仅未转入的 issue 可勾选；已转入的灰显
  const transferable = issueItems.filter((it) => !it.transferred_to_feedback);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!open) return null;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => {
      if (prev.size === transferable.length) return new Set();
      return new Set(transferable.map((it) => it.id));
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (selected.size === 0) {
      setError("请至少勾选一条 issue 条目");
      return;
    }

    const projectId = await getCurrentProjectIdClient();
    if (!projectId) {
      setError("未检测到当前项目，请先在项目切换器选择项目");
      return;
    }

    const itemIds = Array.from(selected);
    startTransition(async () => {
      const r = await transferMeetingItemsToFeedback(projectId, meetingId, itemIds);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      // 成功：埋点（带 meeting_id + item_count，对应需求清单 §10）
      await track("meeting_feedback_transferred", {
        meeting_id: meetingId,
        item_count: itemIds.length,
      });
      setSelected(new Set());
      onClose();
      router.refresh();
    });
  }

  const allChecked = transferable.length > 0 && selected.size === transferable.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg space-y-4 rounded-lg border border-border bg-card p-6 shadow-lg">
        <div>
          <h2 className="text-lg font-semibold">转入反馈聚类</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            将进入反馈模块参与聚类，聚类后可能被合并/重命名，原条目保留不动。
          </p>
        </div>

        {transferable.length === 0 ? (
          <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
            当前会议没有可转入的 issue 条目（可能全部已转入）。
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={allChecked}
                  onChange={toggleAll}
                  className="h-3.5 w-3.5"
                />
                全选（{selected.size}/{transferable.length}）
              </label>
            </div>

            <ul className="max-h-72 space-y-1.5 overflow-y-auto">
              {issueItems.map((it) => {
                const disabled = it.transferred_to_feedback;
                return (
                  <li
                    key={it.id}
                    className={`flex items-start gap-2 rounded-md border border-border px-3 py-2 text-sm ${
                      disabled ? "opacity-50" : ""
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(it.id)}
                      onChange={() => toggle(it.id)}
                      disabled={disabled}
                      className="mt-0.5 h-3.5 w-3.5"
                    />
                    <span className="flex-1 break-words">{it.content}</span>
                    {disabled && (
                      <span className="shrink-0 rounded bg-muted px-1.5 text-[10px] text-muted-foreground">
                        已转入
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                disabled={isPending}
                className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-accent"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={isPending || selected.size === 0}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {isPending ? "转入中…" : `转入反馈（${selected.size}）`}
              </button>
            </div>
          </form>
        )}

        {transferable.length === 0 && (
          <div className="flex justify-end pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-accent"
            >
              关闭
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
