/**
 * DashScope（通义千问）实现——v1 默认 Provider。
 * 使用 DashScope OpenAI 兼容接口：仅改 base_url + api_key。
 */

import {
  LLMProvider,
  ChatOptions,
  ChatResult,
  LlmError,
  MODEL_BY_PURPOSE,
} from "./provider";
import { serverEnv } from "@/lib/env";

export class DashScopeProvider implements LLMProvider {
  private baseUrl: string;
  private apiKey: string;

  constructor() {
    this.baseUrl = serverEnv.dashscopeBaseUrl;
    this.apiKey = serverEnv.dashscopeApiKey;
  }

  async chat(options: ChatOptions): Promise<ChatResult> {
    const model = MODEL_BY_PURPOSE[options.purpose];
    const body: Record<string, unknown> = {
      model,
      messages: options.messages,
      temperature: options.temperature ?? 0.2,
    };
    if (options.jsonMode) {
      // 强制 JSON 输出（Qwen-Max/Plus 支持）；prompt 内也应写明"仅输出 JSON"双重保险
      body.response_format = { type: "json_object" };
    }

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      // 网络层超时 / 连通性问题（CP0 B5 关注点）
      throw new LlmError("LLM_TIMEOUT", `DashScope 网络调用失败: ${(e as Error).message}`, true);
    }

    // DashScope 错误码归一化（接口契约 §0.3 映射表）
    if (res.status === 429) {
      throw new LlmError("LLM_RATE_LIMIT", "DashScope 限流，请稍后重试", true);
    }
    if (res.status === 401 || res.status === 403) {
      throw new LlmError("LLM_ERROR", "DashScope 鉴权失败（key 配置问题）", false);
    }
    if (!res.ok) {
      throw new LlmError("LLM_ERROR", `DashScope 返回 ${res.status}`, false);
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { total_tokens?: number };
    };

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      // 模型返回空 / 非法 JSON → 业务层重试
      throw new LlmError("GENERATION_FAILED", "DashScope 返回内容为空", true);
    }

    return {
      content,
      usage: { model, tokens: data.usage?.total_tokens ?? 0 },
    };
  }
}

/** 单例 */
let _provider: LLMProvider | null = null;
export function getLLMProvider(): LLMProvider {
  if (!_provider) {
    // CP0 B5：v1 用 DashScope；不达标可在此切换为 FCProvider
    _provider = new DashScopeProvider();
  }
  return _provider;
}
