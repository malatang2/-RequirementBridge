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

/**
 * Requirement 生命周期合法流转表（04 工单 — Confirm 关卡）。
 *
 * 设计：单向有向图，draft 是入口、delivered/parked 是终态（无出度）。
 * 任何回退、跨级跳跃、自环都不在此表 → canTransition 拒绝。
 *
 * 本工单 UI 只用 draft→confirmed 这一条（PM 在详情页点"确认纳入需求池"），
 * 其余路径在表里就位是为后续工单（in_progress→delivered 等 UI）铺路，避免反复改表。
 */
export const TRANSITIONS: Record<RequirementLifecycle, RequirementLifecycle[]> = {
  draft: ["confirmed", "parked"],
  confirmed: ["in_progress", "parked"],
  in_progress: ["delivered", "parked"],
  delivered: [], // 终态
  parked: [], // 终态
};

/**
 * 判定 lifecycle 流转是否合法（纯函数 seam）。
 * 合法路径见 TRANSITIONS；自环 / 回退 / 跨级 / 出终态一律 false。
 */
export function canTransition(
  from: RequirementLifecycle,
  to: RequirementLifecycle
): boolean {
  if (from === to) return false; // 自环无意义
  return TRANSITIONS[from].includes(to);
}

export type TransitionDescription =
  | { ok: true }
  | { ok: false; error: string };

/**
 * 流转判定 + 中文错误文案（给 server action 直接回传给 UI 用）。
 * 仿 validateRequirementInput 的判别联合风格：成功 { ok: true }，失败带 error。
 */
export function describeTransition(
  from: RequirementLifecycle,
  to: RequirementLifecycle
): TransitionDescription {
  if (from === to) {
    return { ok: false, error: "状态未变化，无需流转" };
  }
  if (canTransition(from, to)) {
    return { ok: true };
  }
  // 区分两种典型非法情形，给用户可读的反馈
  if (TRANSITIONS[from].length === 0) {
    return {
      ok: false,
      error: `「${LIFECYCLE_LABELS[from]}」是终态，无法再流转`,
    };
  }
  return {
    ok: false,
    error: `不支持从「${LIFECYCLE_LABELS[from]}」流转到「${LIFECYCLE_LABELS[to]}」`,
  };
}
