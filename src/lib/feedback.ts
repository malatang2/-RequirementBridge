/**
 * 反馈洞察服务层（M3）。
 *
 * 设计（mattpocock TDD）：可测纯逻辑 seam 与 Edge Function / DB 调用分离。
 * - validateFeedbackInput：粘贴/文件输入校验
 * - parseClusteringResponse：Qwen 聚类响应解析（含 item_indices 归属）
 * - computeStats：统计计算（总数/主题数/高优数/负面占比）—— 验收门槛
 * - sortByFrequency：主题按 frequency 降序
 *
 * 对应《前后端接口契约 §3.5》《数据模型 §3.7-3.9》。
 */

import type {
  SentimentLabel,
  PriorityLevel,
  FeedbackItem,
  FeedbackTopic,
} from "@/types/database";

// ============ seam 1：反馈输入校验 ============

export type FeedbackInputValidation =
  | { ok: true; items: string[]; mode: "paste" }
  | { ok: false; error: string };

/**
 * 校验粘贴模式输入（每行一条反馈）。
 * 空行会被过滤。
 */
export function validateFeedbackInput(rawText: unknown): FeedbackInputValidation {
  if (typeof rawText !== "string") {
    return { ok: false, error: "反馈内容格式错误" };
  }
  const items = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (items.length === 0) {
    return { ok: false, error: "请至少输入一条反馈" };
  }
  if (items.length > 2000) {
    return { ok: false, error: "反馈条数过多（最多 2000 条）" };
  }

  return { ok: true, items, mode: "paste" };
}

// ============ seam 2：聚类响应解析 ============

/** Qwen 聚类返回的单个主题原始结构（接口契约 §3.5） */
export interface RawClusteredTopic {
  name?: string;
  summary?: string;
  sentiment?: string;
  priority?: string;
  item_indices?: number[];
}

export interface RawClusteringResponse {
  topics?: RawClusteredTopic[];
  unassigned_indices?: number[];
}

export interface ParsedTopic {
  name: string;
  summary: string;
  sentiment: SentimentLabel;
  priority: PriorityLevel;
  itemIndices: number[];
}

export interface ParsedClusteringResult {
  topics: ParsedTopic[];
  unassignedIndices: number[];
}

const SENTIMENT_MAP: Record<string, SentimentLabel> = {
  positive: "positive",
  正面: "positive",
  积极: "positive",
  negative: "negative",
  负面: "negative",
  消极: "negative",
  neutral: "neutral",
  中性: "neutral",
  中立: "neutral",
};

function normalizeSentiment(raw?: string): SentimentLabel {
  const s = (raw ?? "").toLowerCase().trim();
  return SENTIMENT_MAP[s] ?? "neutral";
}

function normalizePriorityFB(raw?: string): PriorityLevel {
  const p = (raw ?? "").toLowerCase().trim();
  if (p.startsWith("high") || p === "高" || p === "高优") return "high";
  if (p.startsWith("low") || p === "低") return "low";
  return "medium";
}

/**
 * 解析 Qwen 聚类响应（纯函数 seam）。
 * 含：归一化 sentiment/priority、合并 unassigned 为"其他"主题、
 *     过滤无效 item_indices（越界）、按 frequency 暂存（排序在后面）。
 */
export function parseClusteringResponse(
  raw: RawClusteringResponse,
  totalCount: number
): ParsedClusteringResult {
  const topics: ParsedTopic[] = (raw.topics ?? [])
    .filter((t) => typeof t.name === "string" && t.name.trim())
    .map((t) => ({
      name: t.name!.trim(),
      summary: (t.summary ?? "").trim(),
      sentiment: normalizeSentiment(t.sentiment),
      priority: normalizePriorityFB(t.priority),
      // 过滤越界的 item_indices
      itemIndices: (t.item_indices ?? []).filter(
        (i) => typeof i === "number" && i >= 0 && i < totalCount
      ),
    }));

  const unassignedIndices = (raw.unassigned_indices ?? []).filter(
    (i) => typeof i === "number" && i >= 0 && i < totalCount
  );

  return { topics, unassignedIndices };
}

// ============ seam 3：统计计算（验收门槛）============

export interface FeedbackStats {
  total: number;
  topicCount: number;
  highPriorityCount: number;
  negativeRatio: number;
}

/**
 * 计算统计指标（统计卡用）。
 * total 用 feedback_items 总数（非 topic frequency 之和，因一条反馈可能未归类）。
 */
export function computeStats(
  totalCount: number,
  topics: { frequency: number; priority: PriorityLevel; sentiment: SentimentLabel | null }[]
): FeedbackStats {
  const topicCount = topics.length;
  const highPriorityCount = topics.filter((t) => t.priority === "high").length;

  // 负面占比：负面反馈条数 / 总反馈条数
  // 用各主题 frequency 加权（sentiment=negative 的主题其 feedback 条数）
  const negativeCount = topics
    .filter((t) => t.sentiment === "negative")
    .reduce((sum, t) => sum + t.frequency, 0);
  const negativeRatio = totalCount > 0 ? negativeCount / totalCount : 0;

  return {
    total: totalCount,
    topicCount,
    highPriorityCount,
    negativeRatio,
  };
}

// ============ seam 4：按 frequency 降序排序 ============

/** 主题按 frequency 降序排序（条形图与列表用），稳定的二级排序按名称 */
export function sortByFrequency<T extends { frequency: number; name: string }>(
  topics: T[]
): T[] {
  return [...topics].sort((a, b) => {
    if (b.frequency !== a.frequency) return b.frequency - a.frequency;
    return a.name.localeCompare(b.name, "zh");
  });
}

/** 为排序后的主题写入 sort_order（持久化用） */
export function withSortOrder<T extends { frequency: number; name: string }>(
  topics: T[]
): (T & { sortOrder: number })[] {
  return sortByFrequency(topics).map((t, idx) => ({ ...t, sortOrder: idx }));
}

// ============ seam 5：主题频次一致性校验（验收 100%）============

/**
 * 校验频次准确性：每个主题的 frequency 应等于其关联的 feedback_items 数量。
 * 对应"频次统计准确率 100%"验收（数据模型触发器保证，此函数用于回归测试）。
 */
export function verifyFrequencyConsistency(
  topics: { id: string; frequency: number }[],
  items: { topic_id: string | null }[]
): { ok: boolean; mismatches: { topicId: string; expected: number; actual: number }[] } {
  const mismatches: { topicId: string; expected: number; actual: number }[] = [];
  for (const topic of topics) {
    const expected = items.filter((i) => i.topic_id === topic.id).length;
    if (expected !== topic.frequency) {
      mismatches.push({
        topicId: topic.id,
        expected,
        actual: topic.frequency,
      });
    }
  }
  return { ok: mismatches.length === 0, mismatches };
}

// ============ seam 6：从主题+反馈提取样本（每主题 2-3 条）============

/** 为每个主题提取最多 N 条样本反馈（用于 sample_feedback 字段） */
export function pickSampleFeedback(
  topicId: string,
  items: { topic_id: string | null; content: string }[],
  max = 3
): string[] {
  return items
    .filter((i) => i.topic_id === topicId)
    .slice(0, max)
    .map((i) => i.content);
}

// ============ 情感饼图数据 ============

export interface SentimentDistribution {
  positive: number;
  negative: number;
  neutral: number;
}

/** 按反馈条数统计情感分布（饼图用） */
export function computeSentimentDistribution(
  items: { sentiment: SentimentLabel | null }[]
): SentimentDistribution {
  const dist: SentimentDistribution = { positive: 0, negative: 0, neutral: 0 };
  for (const item of items) {
    const s = item.sentiment ?? "neutral";
    if (s in dist) dist[s]++;
    else dist.neutral++;
  }
  return dist;
}

export type { FeedbackItem, FeedbackTopic };
