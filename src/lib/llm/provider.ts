/**
 * LLM 服务封装层（T0.5）。
 *
 * CP0 决议（B1-B3, B5）：
 * - AI 服务由 OpenAI 迁移至通义千问 DashScope。
 * - 文本：生成类（提取/OpenAPI）用 Qwen-Max；聚类类（反馈/草稿）用 Qwen-Plus。
 * - 语音转写：fun-asr / Paraformer（异步任务）。
 * - 网络方案：v1 用 Supabase Edge Function；不达标迁阿里云 FC。
 *   → 本层抽象 LLMProvider 接口，便于切换实现，0 业务成本（Follow-up F7）。
 *
 * 对应《前后端接口契约 §0.3》：DashScope 错误码归一化为统一 LLM_* 错误码。
 */

/** 任务用途 → 模型映射（CP0 B2） */
export type LlmPurpose =
  | "extract" // 会议结构化提取 → Qwen-Max
  | "openapi" // API 草稿生成 → Qwen-Max
  | "cluster" // 反馈聚类 → Qwen-Plus
  | "draft"; // 需求草稿 → Qwen-Plus

/** 用途 → 模型名（DashScope） */
const MODEL_BY_PURPOSE: Record<LlmPurpose, string> = {
  extract: "qwen-max",
  openapi: "qwen-max",
  cluster: "qwen-plus",
  draft: "qwen-plus",
};

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  purpose: LlmPurpose;
  messages: ChatMessage[];
  /** 强制 JSON 输出（DashScope OpenAI 兼容接口支持 response_format） */
  jsonMode?: boolean;
  temperature?: number;
}

export interface ChatResult {
  content: string;
  usage: { model: string; tokens: number };
}

/**
 * LLMProvider 接口——预留切换（DashScope / 阿里云 FC / 其他）。
 * 实现类须把底层错误归一化为 LLM_* 错误码。
 */
export interface LLMProvider {
  /** 文本对话（结构化提取 / OpenAPI 生成 / 聚类） */
  chat(options: ChatOptions): Promise<ChatResult>;
}

/** 统一错误（对应接口契约 §0.3 错误码） */
export class LlmError extends Error {
  constructor(
    public code: "LLM_TIMEOUT" | "LLM_RATE_LIMIT" | "LLM_ERROR" | "GENERATION_FAILED",
    message: string,
    public retryable: boolean
  ) {
    super(message);
    this.name = "LlmError";
  }
}

export { MODEL_BY_PURPOSE };
