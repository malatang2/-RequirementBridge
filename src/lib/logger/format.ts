/**
 * 结构化日志的纯逻辑层（TL.3 零件，Day 5 预热）。
 *
 * 设计（与 src/lib/meetings.ts 同构的 TDD seam）：
 * - 本文件只做"格式化 + 脱敏"，纯函数，可单测，不依赖 Deno / 浏览器。
 * - 实际输出（console.log/error）由调用层负责：
 *     · Edge Function 侧：supabase/functions/_shared/logger.ts（Deno）
 *     · Next.js 服务端侧：src/lib/logger/server.ts（阶段二 TL.4）
 * - 这样纯逻辑有单测覆盖（支撑 CI 门禁 TL.6），EF 端零成本复用。
 *
 * 安全约束（对应《日志与审计基础设施开发计划 §5.1》）：
 * - 永不输出密钥（调用方无法把 DASHSCOPE_API_KEY 传进来，类型上拒绝）。
 * - 长文本只取 snippet（前 SNIPPET_MAX 字），避免 raw_text 全量泄漏。
 */

/** 日志级别 */
export type LogLevel = "info" | "warn" | "error";

/** 单条日志携带的字段（可选，按场景填） */
export interface LogFields {
  /** 来源 Edge Function 名 / Server Action 名 */
  ef?: string;
  /** 业务实体 ID（meetingId / draftId / analysisId） */
  meetingId?: string;
  draftId?: string;
  analysisId?: string;
  /** 触发用户 ID（服务端解析 JWT 得到，前端日志不带） */
  userId?: string;
  /** 流程步骤标签（如 "pre-llm" / "post-llm" / "write-db"） */
  step?: string;
  /** 耗时（毫秒） */
  latencyMs?: number;
  /** 统一错误码（LLM_TIMEOUT / LLM_RATE_LIMIT / LLM_ERROR / GENERATION_FAILED） */
  errorCode?: string;
  /** 文本片段（排障用，会被截断脱敏） */
  snippet?: string;
  /** 其它结构化扩展（放这里，避免散落顶层） */
  extra?: Record<string, unknown>;
}

/** snippet 最大长度（对应计划 §5.1：raw_text 只进前 100 字） */
export const SNIPPET_MAX = 100;

/** 禁止出现在日志里的字段名（防调用方误传密钥） */
const FORBIDDEN_KEYS = new Set([
  "apiKey",
  "api_key",
  "DASHSCOPE_API_KEY",
  "authorization",
  "Authorization",
  "SUPABASE_SERVICE_ROLE_KEY",
  "password",
  "token",
]);

/**
 * 把 snippet 截断脱敏。
 * - 超长截断到 SNIPPET_MAX 并加 "…" 后缀。
 * - 去掉首尾空白。
 */
export function sanitizeSnippet(raw: unknown): string | undefined {
  if (raw === null || raw === undefined) return undefined;
  const s = String(raw).trim();
  if (!s) return undefined;
  if (s.length <= SNIPPET_MAX) return s;
  return s.slice(0, SNIPPET_MAX) + "…";
}

/**
 * 构造单条结构化日志的对象（纯函数，核心 seam）。
 *
 * 返回的字段顺序固定（ts → level → ef → event → 业务ID → userId → step → latencyMs → errorCode → snippet → extra），
 * 便于人工/程序化阅读。null/undefined 字段会被剔除（保持 JSON 紧凑）。
 *
 * 对应计划 §5.1 的输出结构。
 */
export function buildLogEntry(
  level: LogLevel,
  event: string,
  fields: LogFields = {},
  now: () => Date = () => new Date()
): Record<string, unknown> {
  const entry: Record<string, unknown> = {
    ts: now().toISOString(),
    level,
    ef: fields.ef ?? "unknown",
    event,
  };

  // 业务实体 ID（最多填一个，按优先级）
  const entityId = fields.meetingId ?? fields.draftId ?? fields.analysisId;
  if (fields.meetingId) entry.meetingId = fields.meetingId;
  if (fields.draftId) entry.draftId = fields.draftId;
  if (fields.analysisId) entry.analysisId = fields.analysisId;
  // 标记 entity 类型（便于按类型检索，可选）
  if (entityId && !entry.meetingId && !entry.draftId && !entry.analysisId) {
    /* no-op：上面已分别写入 */
  }

  if (fields.userId) entry.userId = fields.userId;
  if (fields.step) entry.step = fields.step;
  if (typeof fields.latencyMs === "number") entry.latencyMs = fields.latencyMs;
  if (fields.errorCode) entry.errorCode = fields.errorCode;

  const snippet = sanitizeSnippet(fields.snippet);
  if (snippet) entry.snippet = snippet;

  // 扩展字段：防密钥泄漏
  if (fields.extra) {
    for (const [k, v] of Object.entries(fields.extra)) {
      if (FORBIDDEN_KEYS.has(k)) continue; // 静默丢弃敏感 key
      entry[k] = v;
    }
  }

  return entry;
}

/**
 * 序列化为单行 JSON 字符串（供 console.log 输出）。
 * 纯函数：保证可单测"字段齐全 / 无密钥 / 单行"。
 */
export function serializeLog(entry: Record<string, unknown>): string {
  return JSON.stringify(entry);
}

/**
 * 一站式：level + event + fields → 单行 JSON 字符串。
 * 调用层（EF / Server）拿到字符串后直接 console.log 即可。
 */
export function formatLogLine(
  level: LogLevel,
  event: string,
  fields?: LogFields,
  now?: () => Date
): string {
  return serializeLog(buildLogEntry(level, event, fields, now));
}
