"use client";

/**
 * "批量转反馈"触发按钮 + 弹窗状态持有者（06 工单）。
 *
 * 放在会议详情页 issue 分组标题旁。点击打开 MeetingTransferFeedbackDialog。
 * 单独拆成 client 组件是因为父页面（会议详情）是 server component，
 * 无法持有 useState（弹窗开关）。这里把 open 状态 + 触发按钮封装在一起。
 */

import { useState } from "react";
import type { MeetingItem } from "@/types/database";
import { MeetingTransferFeedbackDialog } from "./meeting-transfer-feedback-dialog";

interface Props {
  meetingId: string;
  issueItems: MeetingItem[];
}

export function MeetingBatchTransferButton({ meetingId, issueItems }: Props) {
  const [open, setOpen] = useState(false);
  // 没有任何 issue 条目时不渲染按钮（避免空入口）
  if (issueItems.length === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
        title="把 issue 条目转入反馈模块参与 AI 聚类"
      >
        批量转反馈
      </button>
      <MeetingTransferFeedbackDialog
        open={open}
        onClose={() => setOpen(false)}
        meetingId={meetingId}
        issueItems={issueItems}
      />
    </>
  );
}
