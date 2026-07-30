import type { TaskStatus, GenStatus } from "@/types/database";

/**
 * 状态徽章（会议/API/反馈三模块共用，对应设计评审 F1 前端方案）。
 * 抽一个统一组件渲染 进行中/失败重试/完成 三态。
 */

export type AnyStatus = TaskStatus | GenStatus;

export const STATUS_META: Record<
  AnyStatus,
  { label: string; color: string }
> = {
  uploading: { label: "上传中…", color: "text-blue-600" },
  transcribing: { label: "转录中…", color: "text-blue-600" },
  analyzing: { label: "AI 分析中…", color: "text-blue-600" },
  generating: { label: "生成中…", color: "text-blue-600" },
  completed: { label: "完成", color: "text-green-600" },
  failed: { label: "失败", color: "text-red-600" },
};

export interface StatusBadgeProps {
  status: AnyStatus;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const meta = STATUS_META[status];
  return (
    <span className={`text-xs font-medium ${meta.color} ${className ?? ""}`}>
      {meta.label}
    </span>
  );
}
