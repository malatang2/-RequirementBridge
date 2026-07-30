/**
 * Edge Function 结构化日志输出层（TL.3，Deno 运行时）。
 *
 * 设计（对应《日志与审计基础设施开发计划 §5.1》）：
 * - 纯逻辑（格式化 / 脱敏）在 src/lib/logger/format.ts，有单测覆盖。
 * - 本文件只负责"输出"：把 format 后的单行 JSON 走 console.log/error，
 *   由 Supabase 平台采集 stdout。
 * - 4 个 Edge Function 通过 import { log } from "../_shared/logger.ts" 复用。
 *
 * 注意：Deno 运行时无法直接 import src/（TS 项目 exclude 了 supabase/functions）。
 * 因此 EF 侧在 build/deploy 时由 supabase CLI 打包，本文件内联了与
 * src/lib/logger/format.ts 等价的最小格式化逻辑，保证两端输出格式一致。
 * （纯逻辑源在 src/，有单测；EF 侧为运行副本，改 format.ts 时同步改这里。）
 */

export type LogLevel = "info" | "warn" | "error";

const SNIPPET_MAX = 100;
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

export interface LogFields {
  ef?: string;
  meetingId?: string;
  draftId?: string;
  analysisId?: string;
  userId?: string;
  step?: string;
  latencyMs?: number;
  errorCode?: string;
  snippet?: string;
  extra?: Record<string, unknown>;
}

function sanitizeSnippet(raw: unknown): string | undefined {
  if (raw === null || raw === undefined) return undefined;
  const s = String(raw).trim();
  if (!s) return undefined;
  if (s.length <= SNIPPET_MAX) return s;
  return s.slice(0, SNIPPET_MAX) + "…";
}

/**
 * 输出一条结构化日志（单行 JSON）。
 * - info/warn → console.log
 * - error    → console.error
 */
export function log(
  level: LogLevel,
  event: string,
  fields: LogFields = {}
): void {
  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    ef: fields.ef ?? "unknown",
    event,
  };
  if (fields.meetingId) entry.meetingId = fields.meetingId;
  if (fields.draftId) entry.draftId = fields.draftId;
  if (fields.analysisId) entry.analysisId = fields.analysisId;
  if (fields.userId) entry.userId = fields.userId;
  if (fields.step) entry.step = fields.step;
  if (typeof fields.latencyMs === "number") entry.latencyMs = fields.latencyMs;
  if (fields.errorCode) entry.errorCode = fields.errorCode;
  const snippet = sanitizeSnippet(fields.snippet);
  if (snippet) entry.snippet = snippet;
  if (fields.extra) {
    for (const [k, v] of Object.entries(fields.extra)) {
      if (FORBIDDEN_KEYS.has(k)) continue;
      entry[k] = v;
    }
  }

  const line = JSON.stringify(entry);
  if (level === "error") {
    console.error(line);
  } else {
    console.log(line);
  }
}

/** 便捷方法 */
export const logger = {
  info: (event: string, fields?: LogFields) => log("info", event, fields),
  warn: (event: string, fields?: LogFields) => log("warn", event, fields),
  error: (event: string, fields?: LogFields) => log("error", event, fields),
};
