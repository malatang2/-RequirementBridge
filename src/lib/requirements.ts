/**
 * Requirement CRUD 服务层（v2 Phase 1 / 工单 03）。
 *
 * 设计：与 projects.ts 同构——把「可测的纯逻辑」与「DB 调用」分离。
 * - validateRequirementInput / 展示配置常量是纯函数（seam），可单测。
 * - listRequirements / createRequirement 等是 DB 薄封装，靠 RLS 隔离 + 集成测试（08 工单）。
 *
 * 术语：遵循 CONTEXT.md——Requirement 指一条被管理的需求（不论生命周期阶段）；
 * Requirement Draft 仅指 lifecycle='draft' 的 Requirement。本模块是「需求统一中枢」的本体。
 */

import type { PriorityLevel, RequirementLifecycle } from "@/types/database";

/** 创建/更新 Requirement 的输入（lifecycle 不在此——由 server action 固定写 'draft'，04 工单做流转） */
export interface RequirementInput {
  title: string;
  content: string;
  priority: PriorityLevel;
}

export type RequirementValidation = {
  ok: boolean;
  error?: string;
  value?: RequirementInput;
};

const VALID_PRIORITIES: readonly PriorityLevel[] = ["high", "medium", "low"];

/** 校验 Requirement 输入（纯函数 seam，仿 validateProjectInput） */
export function validateRequirementInput(input: {
  title?: unknown;
  content?: unknown;
  priority?: unknown;
}): RequirementValidation {
  const title = typeof input.title === "string" ? input.title.trim() : "";

  if (!title) {
    return { ok: false, error: "标题不能为空" };
  }
  if (title.length > 200) {
    return { ok: false, error: "标题不能超过 200 字" };
  }

  const content = typeof input.content === "string" ? input.content.trim() : "";
  if (!content) {
    return { ok: false, error: "内容不能为空" };
  }

  // priority 非法时归一化为默认值（与会议条目优先级选择一致的宽松策略），
  // 不报错——避免上层因枚举意外崩在表单。
  const priority: PriorityLevel =
    typeof input.priority === "string" &&
    (VALID_PRIORITIES as readonly string[]).includes(input.priority)
      ? (input.priority as PriorityLevel)
      : "medium";

  return { ok: true, value: { title, content, priority } };
}

/**
 * Requirement 生命周期展示标签（UI 复用）。
 * lifecycle 顺序 = 列表排序优先级（draft 在前）。
 */
export const LIFECYCLE_LABELS: Record<RequirementLifecycle, string> = {
  draft: "草稿",
  confirmed: "已确认",
  in_progress: "进行中",
  delivered: "已交付",
  parked: "搁置",
};

/**
 * 生命周期排序基准（draft 在前 → confirmed → in_progress → delivered → parked）。
 * listRequirements 排序时 lifecycle asc 即对应此顺序（枚举声明顺序一致）。
 */
export const LIFECYCLE_ORDER: RequirementLifecycle[] = [
  "draft",
  "confirmed",
  "in_progress",
  "delivered",
  "parked",
];

/** Requirement 来源展示标签（对应 source_type 取值集合） */
export const SOURCE_LABELS: Record<"feedback_topic" | "meeting_item" | "manual", string> = {
  feedback_topic: "💬 反馈",
  meeting_item: "📅 会议",
  manual: "✍️ 手动",
};

/**
 * 解析来源展示标签（纯函数 seam，UI 复用）。
 * source_type 取未知值时返回 null（保持 additive：老数据或未来枚举不致渲染崩）。
 */
export function resolveSourceLabel(sourceType: string): string | null {
  if (
    sourceType === "feedback_topic" ||
    sourceType === "meeting_item" ||
    sourceType === "manual"
  ) {
    return SOURCE_LABELS[sourceType];
  }
  return null;
}
