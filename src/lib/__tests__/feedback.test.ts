import { describe, it, expect } from "vitest";
import {
  validateFeedbackInput,
  parseClusteringResponse,
  computeStats,
  sortByFrequency,
  withSortOrder,
  verifyFrequencyConsistency,
  pickSampleFeedback,
  computeSentimentDistribution,
  filterTransferableItems,
  type TransferableMeetingItem,
} from "@/lib/feedback";

describe("validateFeedbackInput", () => {
  it("每行一条，过滤空行", () => {
    const r = validateFeedbackInput("登录失败\n\n\n界面好看\n  \n");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.mode).toBe("paste");
      expect(r.items).toEqual(["登录失败", "界面好看"]);
    }
  });

  it("trim 每条", () => {
    const r = validateFeedbackInput("  登录失败  \n  界面好看");
    if (r.ok) expect(r.items).toEqual(["登录失败", "界面好看"]);
  });

  it("拒绝空输入", () => {
    expect(validateFeedbackInput("").ok).toBe(false);
    expect(validateFeedbackInput("   \n  \n").ok).toBe(false);
  });

  it("拒绝非字符串", () => {
    expect(validateFeedbackInput(123).ok).toBe(false);
    expect(validateFeedbackInput(null).ok).toBe(false);
  });

  it("拒绝超 2000 条", () => {
    const text = Array(2001).fill("反馈").join("\n");
    expect(validateFeedbackInput(text).ok).toBe(false);
  });

  it("接受刚好 2000 条", () => {
    const text = Array(2000).fill("反馈").join("\n");
    expect(validateFeedbackInput(text).ok).toBe(true);
  });
});

describe("parseClusteringResponse", () => {
  it("正确解析并归一化", () => {
    const r = parseClusteringResponse(
      {
        topics: [
          { name: "登录问题", summary: "登录失败", sentiment: "负面", priority: "高", item_indices: [0, 2] },
          { name: "界面", summary: "好看", sentiment: "positive", priority: "low", item_indices: [1] },
        ],
        unassigned_indices: [3],
      },
      4
    );
    expect(r.topics).toHaveLength(2);
    expect(r.topics[0]).toMatchObject({
      name: "登录问题",
      sentiment: "negative",
      priority: "high",
      itemIndices: [0, 2],
    });
    expect(r.unassignedIndices).toEqual([3]);
  });

  it("过滤越界 item_indices", () => {
    const r = parseClusteringResponse(
      { topics: [{ name: "t", item_indices: [0, 5, -1, 99] }] },
      3
    );
    expect(r.topics[0].itemIndices).toEqual([0]);
  });

  it("过滤无 name 的主题", () => {
    const r = parseClusteringResponse(
      { topics: [{ name: "" }, { name: "  " }, { name: "有效" }] },
      1
    );
    expect(r.topics).toHaveLength(1);
  });

  it("默认 sentiment 为 neutral", () => {
    const r = parseClusteringResponse({ topics: [{ name: "t" }] }, 1);
    expect(r.topics[0].sentiment).toBe("neutral");
  });

  it("空响应返回空数组", () => {
    const r = parseClusteringResponse({}, 0);
    expect(r.topics).toEqual([]);
    expect(r.unassignedIndices).toEqual([]);
  });
});

describe("computeStats", () => {
  it("正确计算各项", () => {
    const stats = computeStats(
      100,
      [
        { frequency: 30, priority: "high", sentiment: "negative" },
        { frequency: 20, priority: "medium", sentiment: "negative" },
        { frequency: 15, priority: "high", sentiment: "positive" },
      ]
    );
    expect(stats.total).toBe(100);
    expect(stats.topicCount).toBe(3);
    expect(stats.highPriorityCount).toBe(2);
    // 负面 = 30 + 20 = 50，占比 50/100 = 0.5
    expect(stats.negativeRatio).toBe(0.5);
  });

  it("total 为 0 时 negativeRatio 为 0", () => {
    const stats = computeStats(0, []);
    expect(stats.negativeRatio).toBe(0);
    expect(stats.topicCount).toBe(0);
  });

  it("无负面主题时 negativeRatio 为 0", () => {
    const stats = computeStats(50, [
      { frequency: 30, priority: "low", sentiment: "positive" },
    ]);
    expect(stats.negativeRatio).toBe(0);
  });
});

describe("sortByFrequency", () => {
  it("按 frequency 降序", () => {
    const sorted = sortByFrequency([
      { frequency: 5, name: "a" },
      { frequency: 30, name: "b" },
      { frequency: 15, name: "c" },
    ]);
    expect(sorted.map((t) => t.name)).toEqual(["b", "c", "a"]);
  });

  it("frequency 相同按名称（中文）二级排序", () => {
    const sorted = sortByFrequency([
      { frequency: 5, name: "登录" },
      { frequency: 5, name: "崩溃" },
    ]);
    expect(sorted[0].name).toBe("崩溃");
  });

  it("不修改原数组", () => {
    const orig = [{ frequency: 1, name: "a" }, { frequency: 5, name: "b" }];
    sortByFrequency(orig);
    expect(orig[0].frequency).toBe(1);
  });
});

describe("withSortOrder", () => {
  it("写入降序 sortOrder", () => {
    const result = withSortOrder([
      { frequency: 5, name: "a" },
      { frequency: 30, name: "b" },
    ]);
    expect(result[0]).toMatchObject({ name: "b", sortOrder: 0 });
    expect(result[1]).toMatchObject({ name: "a", sortOrder: 1 });
  });
});

describe("verifyFrequencyConsistency", () => {
  const topics = [
    { id: "t1", frequency: 2 },
    { id: "t2", frequency: 3 },
  ];

  it("一致时 ok=true", () => {
    const items = [
      { topic_id: "t1" }, { topic_id: "t1" },
      { topic_id: "t2" }, { topic_id: "t2" }, { topic_id: "t2" },
    ];
    expect(verifyFrequencyConsistency(topics, items).ok).toBe(true);
  });

  it("不一致时报告 mismatch", () => {
    const items = [
      { topic_id: "t1" }, { topic_id: "t1" }, { topic_id: "t1" }, // 实际3，声明2
      { topic_id: "t2" }, { topic_id: "t2" }, { topic_id: "t2" },
    ];
    const r = verifyFrequencyConsistency(topics, items);
    expect(r.ok).toBe(false);
    expect(r.mismatches).toHaveLength(1);
    expect(r.mismatches[0]).toMatchObject({ topicId: "t1", expected: 3, actual: 2 });
  });

  it("空 items 与 0 frequency 一致", () => {
    expect(verifyFrequencyConsistency([{ id: "t", frequency: 0 }], []).ok).toBe(true);
  });
});

describe("pickSampleFeedback", () => {
  const items = [
    { topic_id: "t1", content: "反馈1" },
    { topic_id: "t1", content: "反馈2" },
    { topic_id: "t1", content: "反馈3" },
    { topic_id: "t1", content: "反馈4" },
    { topic_id: "t2", content: "其他" },
  ];

  it("默认取最多 3 条", () => {
    expect(pickSampleFeedback("t1", items)).toEqual(["反馈1", "反馈2", "反馈3"]);
  });

  it("不足 3 条时全取", () => {
    expect(pickSampleFeedback("t2", items)).toEqual(["其他"]);
  });

  it("可自定义 max", () => {
    expect(pickSampleFeedback("t1", items, 2)).toEqual(["反馈1", "反馈2"]);
  });

  it("无匹配返回空数组", () => {
    expect(pickSampleFeedback("t3", items)).toEqual([]);
  });
});

describe("computeSentimentDistribution", () => {
  it("统计三类数量", () => {
    const items = [
      { sentiment: "positive" as const }, { sentiment: "positive" as const },
      { sentiment: "negative" as const },
      { sentiment: "neutral" as const }, { sentiment: "neutral" as const }, { sentiment: "neutral" as const },
    ];
    expect(computeSentimentDistribution(items)).toEqual({
      positive: 2,
      negative: 1,
      neutral: 3,
    });
  });

  it("null sentiment 计入 neutral", () => {
    expect(computeSentimentDistribution([{ sentiment: null }, { sentiment: null }])).toEqual({
      positive: 0,
      negative: 0,
      neutral: 2,
    });
  });
});

// ============ seam 7：会议 issue 条目转入反馈校验（06 工单） ============

describe("filterTransferableItems", () => {
  // ADR-0002 三条硬约束之一：只转 category='issue'
  // 另：transferred_to_feedback=true 不再可转（防重复转入）
  // 另：必须本会议的条目（meeting_id 匹配）
  // 另：内容非空（聚类无意义的空条目跳过）

  const baseItem = (over: Partial<TransferableMeetingItem>): TransferableMeetingItem => ({
    id: "i1",
    meeting_id: "m1",
    category: "issue",
    content: "登录失败",
    transferred_to_feedback: false,
    ...over,
  });

  it("只保留 issue + 未转入的条目", () => {
    const items = [
      baseItem({ id: "i1" }),
      baseItem({ id: "i2", category: "decision" }),
      baseItem({ id: "i3", category: "requirement" }),
      baseItem({ id: "i4", category: "todo" }),
    ];
    const r = filterTransferableItems(items, "m1");
    expect(r.map((x) => x.id)).toEqual(["i1"]);
  });

  it("排除已转入的条目（防重复转入）", () => {
    const items = [
      baseItem({ id: "i1", transferred_to_feedback: true }),
      baseItem({ id: "i2" }),
    ];
    const r = filterTransferableItems(items, "m1");
    expect(r.map((x) => x.id)).toEqual(["i2"]);
  });

  it("排除其它会议的条目（meeting_id 不匹配）", () => {
    const items = [
      baseItem({ id: "i1", meeting_id: "m1" }),
      baseItem({ id: "i2", meeting_id: "other" }),
    ];
    const r = filterTransferableItems(items, "m1");
    expect(r.map((x) => x.id)).toEqual(["i1"]);
  });

  it("排除空内容条目（聚类无意义）", () => {
    const items = [
      baseItem({ id: "i1", content: "   " }),
      baseItem({ id: "i2", content: "" }),
      baseItem({ id: "i3", content: "有效 issue" }),
    ];
    const r = filterTransferableItems(items, "m1");
    expect(r.map((x) => x.id)).toEqual(["i3"]);
  });

  it("空数组返回空数组", () => {
    expect(filterTransferableItems([], "m1")).toEqual([]);
  });

  it("保留输入顺序（与 action 批量插入顺序一致，EF 按位置回填）", () => {
    const items = [
      baseItem({ id: "c" }),
      baseItem({ id: "a" }),
      baseItem({ id: "b" }),
    ];
    const r = filterTransferableItems(items, "m1");
    expect(r.map((x) => x.id)).toEqual(["c", "a", "b"]);
  });
});
