import { describe, it, expect } from "vitest";
import {
  validateTitle,
  validateAudioFile,
  validateTextMeetingInput,
  normalizeCategory,
  normalizePriority,
  computeQuoteOffset,
  parseExtractionResponse,
  groupItemsByCategory,
  MAX_AUDIO_BYTES,
} from "@/lib/meetings";

describe("validateTitle", () => {
  it("接受有效标题并 trim", () => {
    expect(validateTitle("  周会  ")).toBe("周会");
  });

  it("拒绝空/空白", () => {
    expect(validateTitle("")).toBeNull();
    expect(validateTitle("   ")).toBeNull();
    expect(validateTitle(123)).toBeNull();
  });

  it("拒绝超过 200 字", () => {
    expect(validateTitle("a".repeat(201))).toBeNull();
    expect(validateTitle("a".repeat(200))).toBe("a".repeat(200));
  });
});

describe("validateAudioFile", () => {
  it("接受合法 mp3", () => {
    expect(validateAudioFile({ name: "a.mp3", size: 1024, type: "audio/mpeg" })).toEqual({ ok: true });
  });

  it("接受 wav（按扩展名，type 怪异时）", () => {
    expect(validateAudioFile({ name: "a.wav", size: 1024, type: "" })).toEqual({ ok: true });
  });

  it("拒绝超过 50MB", () => {
    const r = validateAudioFile({ name: "a.mp3", size: MAX_AUDIO_BYTES + 1, type: "audio/mpeg" });
    expect(r.ok).toBe(false);
  });

  it("接受刚好 50MB", () => {
    expect(validateAudioFile({ name: "a.mp3", size: MAX_AUDIO_BYTES, type: "audio/mpeg" })).toEqual({ ok: true });
  });

  it("拒绝不支持格式", () => {
    const r = validateAudioFile({ name: "a.flac", size: 1024, type: "audio/flac" });
    expect(r.ok).toBe(false);
  });
});

describe("validateTextMeetingInput", () => {
  it("接受有效文本输入", () => {
    const r = validateTextMeetingInput({ title: "周会", rawText: "讨论了本周的进度安排" });
    expect(r.ok).toBe(true);
    if (r.ok && r.mode === "text") {
      expect(r.title).toBe("周会");
      expect(r.rawText).toBe("讨论了本周的进度安排");
    }
  });

  it("拒绝空标题", () => {
    expect(validateTextMeetingInput({ title: "", rawText: "内容" }).ok).toBe(false);
  });

  it("拒绝内容过短", () => {
    expect(validateTextMeetingInput({ title: "周会", rawText: "短" }).ok).toBe(false);
  });

  it("拒绝空内容", () => {
    expect(validateTextMeetingInput({ title: "周会", rawText: "" }).ok).toBe(false);
  });
});

describe("normalizeCategory", () => {
  it("英文小写直接映射", () => {
    expect(normalizeCategory("decision")).toBe("decision");
    expect(normalizeCategory("todo")).toBe("todo");
  });

  it("中文变体映射", () => {
    expect(normalizeCategory("决策")).toBe("decision");
    expect(normalizeCategory("待办")).toBe("todo");
    expect(normalizeCategory("需求")).toBe("requirement");
    expect(normalizeCategory("遗留问题")).toBe("issue");
  });

  it("无法归类默认 issue", () => {
    expect(normalizeCategory("乱七八糟")).toBe("issue");
    expect(normalizeCategory("")).toBe("issue");
  });
});

describe("normalizePriority", () => {
  it("高优变体", () => {
    expect(normalizePriority("high")).toBe("high");
    expect(normalizePriority("高")).toBe("high");
    expect(normalizePriority("高优")).toBe("high");
  });

  it("低优变体", () => {
    expect(normalizePriority("low")).toBe("low");
    expect(normalizePriority("低")).toBe("low");
  });

  it("默认 medium", () => {
    expect(normalizePriority("medium")).toBe("medium");
    expect(normalizePriority("")).toBe("medium");
    expect(normalizePriority("unknown")).toBe("medium");
  });
});

describe("computeQuoteOffset", () => {
  const rawText = "我们决定下周上线支付模块，张三负责。";

  it("精确匹配返回偏移", () => {
    // "我们决定"占4字（我0们1决2定3），"下"在索引4
    expect(computeQuoteOffset("下周上线支付模块", rawText)).toBe(4);
  });

  it("整句匹配", () => {
    expect(computeQuoteOffset("我们决定下周上线支付模块", rawText)).toBe(0);
  });

  it("找不到返回 null（影响可追溯率）", () => {
    expect(computeQuoteOffset("不存在的引用", rawText)).toBeNull();
  });

  it("空 quote 返回 null", () => {
    expect(computeQuoteOffset(null, rawText)).toBeNull();
    expect(computeQuoteOffset("", rawText)).toBeNull();
    expect(computeQuoteOffset("   ", rawText)).toBeNull();
  });

  it("trim 后匹配", () => {
    expect(computeQuoteOffset("  下周上线支付模块  ", rawText)).toBe(4);
  });
});

describe("parseExtractionResponse", () => {
  const rawText = "决定下周上线支付。张三负责开发。客户反馈登录失败。";

  it("正确解析并计算 quoteOffset", () => {
    const result = parseExtractionResponse(
      {
        summary: "本次会议讨论上线与反馈",
        items: [
          { category: "决策", content: "下周上线支付", assignee: "张三", priority: "高", quote: "决定下周上线支付" },
          { category: "待办", content: "张三负责开发", assignee: "张三", priority: "medium", quote: "张三负责开发" },
          { category: "issue", content: "登录失败", assignee: null, priority: "low", quote: "不存在原文" },
        ],
      },
      rawText
    );

    expect(result.summary).toBe("本次会议讨论上线与反馈");
    expect(result.items).toHaveLength(3);
    expect(result.items[0]).toMatchObject({
      category: "decision",
      assignee: "张三",
      priority: "high",
      quoteOffset: 0,
    });
    expect(result.items[2].quoteOffset).toBeNull(); // 找不到引用
    expect(result.items[2].assignee).toBeNull();
  });

  it("过滤空 content 条目", () => {
    const result = parseExtractionResponse(
      { items: [{ content: "" }, { content: "   " }, { content: "有效" }] },
      "有效"
    );
    expect(result.items).toHaveLength(1);
  });

  it("无 summary 时给默认值", () => {
    const result = parseExtractionResponse({}, "");
    expect(result.summary).toBe("（未生成摘要）");
    expect(result.items).toEqual([]);
  });
});

describe("groupItemsByCategory", () => {
  it("按四类分组", () => {
    const items = [
      { id: "1", category: "decision" as const, content: "a", assignee: null, priority: "medium" as const, quote: null, quoteOffset: null },
      { id: "2", category: "todo" as const, content: "b", assignee: null, priority: "medium" as const, quote: null, quoteOffset: null },
      { id: "3", category: "decision" as const, content: "c", assignee: null, priority: "medium" as const, quote: null, quoteOffset: null },
    ];
    const grouped = groupItemsByCategory(items);
    expect(grouped.decision).toHaveLength(2);
    expect(grouped.todo).toHaveLength(1);
    expect(grouped.requirement).toHaveLength(0);
    expect(grouped.issue).toHaveLength(0);
  });

  it("空列表返回四类空数组", () => {
    const grouped = groupItemsByCategory([]);
    expect(Object.keys(grouped)).toHaveLength(4);
    expect(grouped.decision).toEqual([]);
  });
});
