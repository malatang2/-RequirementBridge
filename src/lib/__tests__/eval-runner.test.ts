import { describe, it, expect } from "vitest";
import {
  evaluateMeetingExtraction,
  evaluateOpenApiYaml,
  evaluateClustering,
  summarize,
} from "@/lib/eval-runner";

describe("evaluateMeetingExtraction", () => {
  const rawText = "决定下周三上线支付模块，张三负责。需要优化登录页加载速度。数据导出权限设计有遗留问题。新增批量导入用户需求。";

  it("合格提取全部通过", () => {
    const r = evaluateMeetingExtraction(
      "m1",
      {
        summary: "讨论了上线与优化",
        items: [
          { category: "decision", content: "下周三上线支付", assignee: "张三", priority: "high", quote: "决定下周三上线支付模块" },
          { category: "todo", content: "优化登录页", assignee: null, priority: "high", quote: "优化登录页加载速度" },
          { category: "issue", content: "权限遗留", assignee: null, priority: "medium", quote: "权限设计有遗留问题" },
          { category: "requirement", content: "批量导入", assignee: null, priority: "medium", quote: "批量导入用户需求" },
        ],
      },
      rawText,
      { itemCountMin: 4, categories: ["decision", "todo", "issue", "requirement"] }
    );
    expect(r.passed).toBe(true);
    expect(r.checks.every((c) => c.passed)).toBe(true);
  });

  it("引用追溯率不足 90% 不通过", () => {
    const r = evaluateMeetingExtraction(
      "m1",
      {
        items: [
          { category: "decision", content: "上线", quote: "完全不存在的原文片段啊啊啊" },
          { category: "todo", content: "优化", quote: "另一个不存在的引用" },
          { category: "issue", content: "权限", quote: "再一个不存在的" },
          { category: "requirement", content: "导入", quote: "还是不存在" },
        ],
      },
      rawText,
      { itemCountMin: 4, categories: ["decision", "todo", "issue", "requirement"] }
    );
    expect(r.passed).toBe(false);
    expect(r.checks.some((c) => c.name.includes("追溯率"))).toBe(true);
  });

  it("条目数不足不通过", () => {
    const r = evaluateMeetingExtraction(
      "m1",
      { items: [{ category: "decision", content: "唯一一条" }] },
      rawText,
      { itemCountMin: 4, categories: ["decision"] }
    );
    expect(r.passed).toBe(false);
  });
});

describe("evaluateOpenApiYaml", () => {
  const validDoc = {
    openapi: "3.0.0",
    paths: {
      "/login": {
        post: { responses: { "200": {}, "400": {}, "401": {}, "404": {}, "500": {} } },
      },
    },
    components: { schemas: { LoginReq: { properties: { email: {}, password: {} } } } },
  };

  it("合格 OpenAPI 全部通过", () => {
    const r = evaluateOpenApiYaml("a1", validDoc, {
      mustHaveOpenapi: true,
      mustHavePaths: true,
      mustHaveErrorCodes: ["400", "401", "404", "500"],
      mustHaveSchemas: true,
    });
    expect(r.passed).toBe(true);
  });

  it("缺错误码不通过", () => {
    const doc = { ...validDoc, paths: { "/x": { post: { responses: { "200": {}, "400": {} } } } } };
    const r = evaluateOpenApiYaml("a1", doc, {
      mustHaveOpenapi: true,
      mustHavePaths: true,
      mustHaveErrorCodes: ["400", "401", "404", "500"],
    });
    expect(r.passed).toBe(false);
  });

  it("camelCase 不达标不通过", () => {
    const doc = {
      openapi: "3.0.0",
      paths: { "/x": { post: { responses: { "400": {}, "401": {}, "404": {}, "500": {} } } } },
      components: { schemas: { A: { properties: { bad_name: {}, user_id: {}, good: {} } } } },
    };
    const r = evaluateOpenApiYaml("a1", doc, {
      mustHaveOpenapi: true,
      mustHavePaths: true,
      mustHaveErrorCodes: ["400", "401", "404", "500"],
    });
    expect(r.passed).toBe(false);
    expect(r.checks.some((c) => c.name.includes("命名规范"))).toBe(true);
  });
});

describe("evaluateClustering", () => {
  it("合格聚类通过", () => {
    const r = evaluateClustering(
      "f1",
      {
        topics: [
          { name: "登录", item_indices: [0, 1, 2] },
          { name: "界面", item_indices: [3, 4] },
          { name: "性能", item_indices: [5, 6] },
        ],
      },
      7,
      { topicCountMin: 3 }
    );
    expect(r.passed).toBe(true);
  });

  it("主题数不足不通过", () => {
    const r = evaluateClustering("f1", { topics: [{ name: "唯一", item_indices: [0] }] }, 7, {
      topicCountMin: 3,
    });
    expect(r.passed).toBe(false);
  });

  it("覆盖率不足不通过", () => {
    const r = evaluateClustering(
      "f1",
      { topics: [{ name: "t", item_indices: [0] }] },
      10,
      { topicCountMin: 1 }
    );
    expect(r.passed).toBe(false);
    expect(r.checks.some((c) => c.name.includes("覆盖率"))).toBe(true);
  });

  it("有空主题（item_indices 空）不通过", () => {
    const r = evaluateClustering(
      "f1",
      { topics: [{ name: "空", item_indices: [] }, { name: "有", item_indices: [0, 1, 2, 3, 4, 5, 6] }] },
      7,
      { topicCountMin: 2 }
    );
    expect(r.passed).toBe(false);
  });
});

describe("summarize", () => {
  it("全过 allPassed=true", () => {
    const s = summarize([{ passed: true }, { passed: true }, { passed: true }]);
    expect(s.allPassed).toBe(true);
    expect(s.passRate).toBe(1);
    expect(s.failed).toBe(0);
  });

  it("有失败 allPassed=false", () => {
    const s = summarize([{ passed: true }, { passed: false }]);
    expect(s.allPassed).toBe(false);
    expect(s.passRate).toBe(0.5);
    expect(s.failed).toBe(1);
  });

  it("空列表", () => {
    const s = summarize([]);
    expect(s.total).toBe(0);
    expect(s.passRate).toBe(0);
  });
});
