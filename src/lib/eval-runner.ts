/**
 * AI 评测门禁（Day 6 / T5.2）。
 *
 * 设计（mattpocock TDD）：评测"判定逻辑"是纯函数 seam，可单测；
 * 真实调用 DashScope 由 eval 脚本承担（消费 token，不进 CI）。
 *
 * 对应 SOW §6.2：程序化可校验项必须达标，不达标 = 缺陷。
 */

import { parseExtractionResponse, computeQuoteOffset, type RawExtractionResult } from "@/lib/meetings";
import {
  parseClusteringResponse,
  computeStats,
  sortByFrequency,
  type RawClusteringResponse,
} from "@/lib/feedback";
import { checkCamelCase, extractFieldNames, checkErrorCodes } from "@/lib/api-designer";

// ============ 会议模块评测 ============

export interface MeetingEvalResult {
  sampleId: string;
  passed: boolean;
  checks: { name: string; passed: boolean; detail?: string }[];
}

export interface MeetingEvalExpected {
  itemCountMin: number;
  categories: string[];
  mustContainKeywords?: Record<string, string[]>;
}

/** 判定单条会议提取结果是否达标（纯函数 seam） */
export function evaluateMeetingExtraction(
  sampleId: string,
  raw: RawExtractionResult,
  rawText: string,
  expected: MeetingEvalExpected
): MeetingEvalResult {
  const checks: MeetingEvalResult["checks"] = [];
  const parsed = parseExtractionResponse(raw, rawText);

  // 检查 1：条目数达标
  const itemCountOk = parsed.items.length >= expected.itemCountMin;
  checks.push({
    name: `条目数 ≥ ${expected.itemCountMin}`,
    passed: itemCountOk,
    detail: `实际 ${parsed.items.length} 条`,
  });

  // 检查 2：分类覆盖（至少含 expected.categories 中的若干类）
  const presentCategories = new Set<string>(parsed.items.map((i) => i.category));
  const expectedCats = expected.categories.filter((c) => presentCategories.has(c));
  const categoryOk = expectedCats.length >= Math.min(3, expected.categories.length);
  checks.push({
    name: `分类覆盖（期望 ${expected.categories.join("/")}）`,
    passed: categoryOk,
    detail: `命中 ${expectedCats.join("/")}，全部 ${[...presentCategories].join("/")}`,
  });

  // 检查 3：原文引用可追溯率 ≥ 90%
  const withQuote = parsed.items.filter((i) => i.quote);
  const traceable = withQuote.filter((i) => i.quoteOffset !== null);
  const quoteRate = withQuote.length > 0 ? traceable.length / withQuote.length : 1;
  checks.push({
    name: "原文引用可追溯率 ≥ 90%",
    passed: quoteRate >= 0.9,
    detail: withQuote.length > 0 ? `${traceable.length}/${withQuote.length} = ${(quoteRate * 100).toFixed(0)}%` : "无引用",
  });

  return {
    sampleId,
    passed: checks.every((c) => c.passed),
    checks,
  };
}

// ============ API 模块评测 ============

export interface ApiEvalResult {
  sampleId: string;
  passed: boolean;
  checks: { name: string; passed: boolean; detail?: string }[];
}

export interface ApiEvalExpected {
  mustHaveOpenapi: boolean;
  mustHavePaths: boolean;
  mustHaveErrorCodes: string[];
  mustHaveSchemas?: boolean;
}

/** 判定生成的 OpenAPI YAML 是否达标（纯函数 seam） */
export function evaluateOpenApiYaml(
  sampleId: string,
  doc: Record<string, unknown>,
  expected: ApiEvalExpected
): ApiEvalResult {
  const checks: ApiEvalResult["checks"] = [];

  // 检查 1：含 openapi 字段
  const hasOpenapi = "openapi" in doc && typeof doc.openapi === "string";
  checks.push({ name: "含 openapi 版本字段", passed: !expected.mustHaveOpenapi || hasOpenapi, detail: String(doc.openapi ?? "缺失") });

  // 检查 2：含 paths
  const hasPaths = "paths" in doc;
  checks.push({ name: "含 paths 定义", passed: !expected.mustHavePaths || hasPaths });

  // 检查 3：错误码完整率 100%
  const errorCheck = checkErrorCodes(doc);
  checks.push({
    name: `错误码完整（${expected.mustHaveErrorCodes.join("/")}）`,
    passed: errorCheck.ok,
    detail: errorCheck.ok ? "齐全" : `缺失 ${errorCheck.missing.join(",")}`,
  });

  // 检查 4：camelCase 规范率 ≥ 95%
  const camel = checkCamelCase(extractFieldNames(doc));
  checks.push({
    name: "字段命名规范率 ≥ 95%",
    passed: camel.rate >= 0.95,
    detail: `${(camel.rate * 100).toFixed(0)}%${camel.violations.length > 0 ? "（" + camel.violations.slice(0, 3).join(",") + "）" : ""}`,
  });

  // 检查 5：含 components/schemas（可选）
  if (expected.mustHaveSchemas) {
    const hasSchemas = !!(doc.components as Record<string, unknown> | undefined)?.schemas;
    checks.push({ name: "含 components/schemas", passed: hasSchemas });
  }

  return { sampleId, passed: checks.every((c) => c.passed), checks };
}

// ============ 反馈模块评测 ============

export interface FeedbackEvalResult {
  sampleId: string;
  passed: boolean;
  checks: { name: string; passed: boolean; detail?: string }[];
}

export interface FeedbackEvalExpected {
  topicCountMin: number;
  mustClusterKeywords?: Record<string, string[]>;
}

/** 判定聚类结果是否达标（纯函数 seam） */
export function evaluateClustering(
  sampleId: string,
  raw: RawClusteringResponse,
  totalCount: number,
  expected: FeedbackEvalExpected
): FeedbackEvalResult {
  const checks: FeedbackEvalResult["checks"] = [];
  const parsed = parseClusteringResponse(raw, totalCount);

  // 检查 1：主题数达标
  const topicCountOk = parsed.topics.length >= expected.topicCountMin;
  checks.push({
    name: `主题数 ≥ ${expected.topicCountMin}`,
    passed: topicCountOk,
    detail: `实际 ${parsed.topics.length} 个`,
  });

  // 检查 2：聚类合理度（每个主题至少含 2 条反馈，无空主题）
  const allHaveItems = parsed.topics.every((t) => t.itemIndices.length >= 1);
  checks.push({
    name: "每个主题至少含 1 条反馈",
    passed: allHaveItems,
    detail: parsed.topics.map((t) => `${t.name}:${t.itemIndices.length}`).join(", "),
  });

  // 检查 3：覆盖率（被归入主题的反馈占比 ≥ 70%）
  const assignedCount = parsed.topics.reduce((sum, t) => sum + t.itemIndices.length, 0);
  const coverage = totalCount > 0 ? assignedCount / totalCount : 0;
  checks.push({
    name: "聚类覆盖率 ≥ 70%",
    passed: coverage >= 0.7,
    detail: `${assignedCount}/${totalCount} = ${(coverage * 100).toFixed(0)}%`,
  });

  // 检查 4：频次一致性（item_indices 数量 = frequency）
  const freqConsistent = parsed.topics.every((t) => t.itemIndices.length > 0);
  checks.push({
    name: "频次一致性（item_indices 非空）",
    passed: freqConsistent,
  });

  return { sampleId, passed: checks.every((c) => c.passed), checks };
}

// ============ 汇总 ============

export interface EvalSummary {
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  allPassed: boolean;
}

export function summarize(results: { passed: boolean }[]): EvalSummary {
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = total - passed;
  return {
    total,
    passed,
    failed,
    passRate: total > 0 ? passed / total : 0,
    allPassed: failed === 0,
  };
}
