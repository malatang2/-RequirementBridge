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
  escapeCsvField,
  exportMeetingToMarkdown,
  exportMeetingToCsv,
  type MeetingExportData,
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

// ===== T1.6 导出 =====

const sampleExportData: MeetingExportData = {
  title: "产品周会",
  summary: "讨论了上线与优化",
  createdAt: "2026-07-29T10:00:00.000Z",
  items: [
    {
      id: "1",
      category: "decision",
      content: "下周三上线支付",
      assignee: "张三",
      priority: "high",
      quote: "决定下周三上线",
      quoteOffset: 0,
    },
    {
      id: "2",
      category: "todo",
      content: "优化登录速度",
      assignee: null,
      priority: "medium",
      quote: null,
      quoteOffset: null,
    },
  ],
};

describe("escapeCsvField", () => {
  it("普通文本原样返回", () => {
    expect(escapeCsvField("hello")).toBe("hello");
  });

  it("null 返回空串", () => {
    expect(escapeCsvField(null)).toBe("");
  });

  it("含逗号加引号", () => {
    expect(escapeCsvField("a,b")).toBe('"a,b"');
  });

  it("含引号翻倍并加引号", () => {
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
  });

  it("含换行加引号", () => {
    expect(escapeCsvField("line1\nline2")).toBe('"line1\nline2"');
  });
});

describe("exportMeetingToMarkdown", () => {
  const md = exportMeetingToMarkdown(sampleExportData);

  it("包含标题（一级）", () => {
    expect(md).toContain("# 产品周会");
  });

  it("包含摘要段", () => {
    expect(md).toContain("## 摘要");
    expect(md).toContain("讨论了上线与优化");
  });

  it("按分类分组，含数量", () => {
    expect(md).toContain("## 决策（1）");
    expect(md).toContain("## 待办（1）");
  });

  it("条目含内容、负责人、优先级", () => {
    expect(md).toContain("**下周三上线支付**");
    expect(md).toContain("@张三");
    expect(md).toContain("[高优]");
    // assignee=null 显示待分配
    expect(md).toContain("@待分配");
    expect(md).toContain("[中]");
  });

  it("原文引用用引用块呈现", () => {
    expect(md).toContain("- > 决定下周三上线");
  });

  it("无引用的条目不输出引用块", () => {
    // 优化登录速度 这条无 quote，不应有 "- >"
    const lines = md.split("\n");
    const todoLineIdx = lines.findIndex((l) => l.includes("**优化登录速度**"));
    const nextLine = lines[todoLineIdx + 1] ?? "";
    expect(nextLine).not.toContain("- >");
  });

  it("空条目不报错且不输出分类段", () => {
    const md2 = exportMeetingToMarkdown({
      title: "空会议",
      summary: null,
      createdAt: "2026-07-29T10:00:00.000Z",
      items: [],
    });
    expect(md2).not.toContain("## 决策");
    expect(md2).toContain("# 空会议");
  });
});

describe("exportMeetingToCsv", () => {
  const csv = exportMeetingToCsv(sampleExportData);

  it("含 BOM 头（Excel UTF-8 识别）", () => {
    expect(csv.startsWith("\uFEFF")).toBe(true);
  });

  it("含表头", () => {
    expect(csv).toContain("分类,内容,负责人,优先级,原文引用");
  });

  it("每条条目一行，CRLF 分隔", () => {
    const lines = csv.replace(/^\uFEFF/, "").trimEnd().split("\r\n");
    // 表头 + 2 条数据
    expect(lines).toHaveLength(3);
  });

  it("assignee=null 输出空（非待分配，CSV 是数据格式）", () => {
    // 待办那条负责人为空
    expect(csv).toContain(",优化登录速度,,中,");
  });

  it("含逗号的内容被正确转义", () => {
    const csv2 = exportMeetingToCsv({
      title: "t",
      summary: null,
      createdAt: "2026-07-29T10:00:00.000Z",
      items: [
        { id: "1", category: "todo", content: "a,b", assignee: null, priority: "low", quote: null, quoteOffset: null },
      ],
    });
    expect(csv2).toContain('"a,b"');
  });
});
