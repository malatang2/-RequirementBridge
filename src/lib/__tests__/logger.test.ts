/**
 * 结构化日志纯逻辑单测（TL.3 零件，对应 CI 门禁 TL.6）。
 *
 * 覆盖点：
 * - 基本字段齐全 + 顺序
 * - snippet 脱敏（截断 / 空值）
 * - 密钥字段被静默丢弃（安全红线）
 * - 单行 JSON 序列化
 * - 三级别分流
 *
 * 对应 src/lib/logger/format.ts。
 */

import { describe, it, expect } from "vitest";
import {
  buildLogEntry,
  serializeLog,
  formatLogLine,
  sanitizeSnippet,
  SNIPPET_MAX,
  type LogFields,
} from "@/lib/logger/format";

describe("sanitizeSnippet", () => {
  it("空值返回 undefined", () => {
    expect(sanitizeSnippet(null)).toBeUndefined();
    expect(sanitizeSnippet(undefined)).toBeUndefined();
    expect(sanitizeSnippet("")).toBeUndefined();
    expect(sanitizeSnippet("   ")).toBeUndefined();
  });

  it("短文本原样返回（去首尾空白）", () => {
    expect(sanitizeSnippet("  hello  ")).toBe("hello");
  });

  it("超长文本截断到 SNIPPET_MAX 并加 …", () => {
    const long = "x".repeat(SNIPPET_MAX + 50);
    const result = sanitizeSnippet(long);
    expect(result?.length).toBe(SNIPPET_MAX + 1); // 内容 + …
    expect(result?.endsWith("…")).toBe(true);
    expect(result?.slice(0, SNIPPET_MAX)).toBe("x".repeat(SNIPPET_MAX));
  });

  it("恰好 SNIPPET_MAX 不截断", () => {
    const exact = "y".repeat(SNIPPET_MAX);
    expect(sanitizeSnippet(exact)).toBe(exact);
  });

  it("非字符串转字符串处理", () => {
    expect(sanitizeSnippet(123)).toBe("123");
  });
});

describe("buildLogEntry", () => {
  const fixedDate = new Date("2026-07-31T10:00:00.000Z");
  const now = () => fixedDate;

  it("包含必备字段 ts/level/ef/event", () => {
    const entry = buildLogEntry("info", "ef.enter", { ef: "meeting-extract" }, now);
    expect(entry.ts).toBe("2026-07-31T10:00:00.000Z");
    expect(entry.level).toBe("info");
    expect(entry.ef).toBe("meeting-extract");
    expect(entry.event).toBe("ef.enter");
  });

  it("无 ef 时默认 unknown", () => {
    const entry = buildLogEntry("info", "x", {}, now);
    expect(entry.ef).toBe("unknown");
  });

  it("填充业务实体 ID 与可选字段", () => {
    const fields: LogFields = {
      ef: "meeting-extract",
      meetingId: "m-123",
      userId: "u-1",
      step: "post-llm",
      latencyMs: 850,
      errorCode: "LLM_TIMEOUT",
    };
    const entry = buildLogEntry("error", "llm.timeout", fields, now);
    expect(entry.meetingId).toBe("m-123");
    expect(entry.userId).toBe("u-1");
    expect(entry.step).toBe("post-llm");
    expect(entry.latencyMs).toBe(850);
    expect(entry.errorCode).toBe("LLM_TIMEOUT");
  });

  it("snippet 经过脱敏", () => {
    const long = "a".repeat(SNIPPET_MAX + 10);
    const entry = buildLogEntry("info", "e", { snippet: long }, now);
    expect(typeof entry.snippet).toBe("string");
    expect((entry.snippet as string).endsWith("…")).toBe(true);
  });

  it("可选字段未提供时不出现（JSON 紧凑）", () => {
    const entry = buildLogEntry("info", "e", { ef: "x" }, now);
    expect(entry).not.toHaveProperty("meetingId");
    expect(entry).not.toHaveProperty("latencyMs");
    expect(entry).not.toHaveProperty("errorCode");
    expect(entry).not.toHaveProperty("snippet");
  });

  it("【安全红线】extra 中的密钥字段被静默丢弃", () => {
    const entry = buildLogEntry(
      "info",
      "e",
      {
        extra: {
          DASHSCOPE_API_KEY: "sk-secret",
          Authorization: "Bearer xxx",
          api_key: "sk-yyy",
          password: "p@ss",
          token: "t",
          normalField: "ok",
        },
      },
      now
    );
    expect(entry).not.toHaveProperty("DASHSCOPE_API_KEY");
    expect(entry).not.toHaveProperty("Authorization");
    expect(entry).not.toHaveProperty("api_key");
    expect(entry).not.toHaveProperty("password");
    expect(entry).not.toHaveProperty("token");
    expect(entry.normalField).toBe("ok");
  });

  it("latencyMs 必须是数字才写入（防 NaN/字符串污染）", () => {
    // @ts-expect-error 故意传非数字验证防御
    const entry = buildLogEntry("info", "e", { latencyMs: "fast" }, now);
    expect(entry).not.toHaveProperty("latencyMs");
  });
});

describe("serializeLog", () => {
  it("输出单行 JSON", () => {
    const entry = buildLogEntry(
      "info",
      "ef.enter",
      { ef: "x", meetingId: "m1" },
      () => new Date("2026-07-31T10:00:00.000Z")
    );
    const line = serializeLog(entry);
    expect(line.includes("\n")).toBe(false); // 单行
    const parsed = JSON.parse(line);
    expect(parsed.ef).toBe("x");
    expect(parsed.meetingId).toBe("m1");
  });
});

describe("formatLogLine", () => {
  it("一站式生成单行 JSON 字符串", () => {
    const line = formatLogLine(
      "warn",
      "llm.retry",
      { ef: "api-generate", draftId: "d1", errorCode: "GENERATION_FAILED" },
      () => new Date("2026-07-31T10:00:00.000Z")
    );
    expect(line.includes("\n")).toBe(false);
    const parsed = JSON.parse(line);
    expect(parsed.level).toBe("warn");
    expect(parsed.event).toBe("llm.retry");
    expect(parsed.draftId).toBe("d1");
    expect(parsed.errorCode).toBe("GENERATION_FAILED");
  });

  it("三级别都能正确序列化", () => {
    for (const lvl of ["info", "warn", "error"] as const) {
      const line = formatLogLine(lvl, "e", {}, () => new Date("2026-07-31T10:00:00.000Z"));
      expect(JSON.parse(line).level).toBe(lvl);
    }
  });
});
