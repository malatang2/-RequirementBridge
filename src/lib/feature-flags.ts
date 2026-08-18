/**
 * 灰度开关（09 工单）：基于 profiles.feature_flags（jsonb）的模块级 gate。
 *
 * 设计：fail closed——解析失败 / 未登录 / 查无 profile 行一律视为全关。
 * Phase 1 只有一个模块级 key `requirement_hub`（需求模块总开关：需求 CRUD /
 * Confirm 关卡 / 会议条目转入反馈 / 需求一键带入 API）；jsonb 天然支持
 * 未来拆细粒度 key，届时扩展 FeatureFlags 接口即可。
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/** 应用侧感知的灰度开关集合（DB jsonb key → 语义化布尔） */
export interface FeatureFlags {
  /** Phase 1 需求模块总开关（DB key: requirement_hub） */
  requirementHub: boolean;
}

/** gated server action 在 flag off 时的统一拒绝文案（前端占位与 action 返回一致） */
export const FEATURE_UNAVAILABLE_ERROR = "该功能尚未开放";

/**
 * 防御性解析 profiles.feature_flags（jsonb → FeatureFlags）。
 * 只有 `requirement_hub === true`（严格布尔）才开；其他 key 一律忽略。
 */
export function parseFeatureFlags(raw: unknown): FeatureFlags {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { requirementHub: false };
  }
  const record = raw as Record<string, unknown>;
  return { requirementHub: record.requirement_hub === true };
}

/**
 * 读取当前登录用户的灰度开关（server client 与 action client 均可传入）。
 * 未登录 / profiles 无行 / 查询失败均按全关处理。
 */
export async function loadFeatureFlags(
  client: SupabaseClient
): Promise<FeatureFlags> {
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) return { requirementHub: false };

  const { data } = await client
    .from("profiles")
    .select("feature_flags")
    .eq("id", user.id)
    .maybeSingle();

  return parseFeatureFlags(
    (data as { feature_flags?: unknown } | null)?.feature_flags
  );
}
