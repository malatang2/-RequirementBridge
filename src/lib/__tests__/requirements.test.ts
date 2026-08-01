import { describe, it, expect } from "vitest";
import {
  validateRequirementInput,
  LIFECYCLE_LABELS,
  LIFECYCLE_ORDER,
  SOURCE_LABELS,
} from "@/lib/requirements";

describe("validateRequirementInput", () => {
  it("接受有效输入并 trim 标题", () => {
    const result = validateRequirementInput({
      title: "  登录页支持手机号  ",
      content: "用户希望用手机号登录",
    });
    expect(result.ok).toBe(true);
    expect(result.value?.title).toBe("登录页支持手机号");
    expect(result.value?.content).toBe("用户希望用手机号登录");
  });

  it("拒绝空标题", () => {
    expect(validateRequirementInput({ title: "", content: "x" })).toEqual({
      ok: false,
      error: "标题不能为空",
    });
  });

  it("拒绝纯空白标题", () => {
    expect(validateRequirementInput({ title: "   ", content: "x" }).ok).toBe(false);
  });

  it("拒绝非字符串标题", () => {
    expect(validateRequirementInput({ title: 123, content: "x" }).ok).toBe(false);
  });

  it("拒绝超过 200 字的标题", () => {
    expect(
      validateRequirementInput({ title: "a".repeat(201), content: "x" }).ok
    ).toBe(false);
  });

  it("接受刚好 200 字的标题", () => {
    expect(
      validateRequirementInput({ title: "a".repeat(200), content: "x" }).ok
    ).toBe(true);
  });

  it("拒绝空内容", () => {
    expect(
      validateRequirementInput({ title: "标题", content: "" })
    ).toEqual({ ok: false, error: "内容不能为空" });
  });

  it("拒绝纯空白内容", () => {
    expect(
      validateRequirementInput({ title: "标题", content: "   " }).ok
    ).toBe(false);
  });

  it("拒绝非字符串内容", () => {
    expect(
      validateRequirementInput({ title: "标题", content: 42 }).ok
    ).toBe(false);
  });

  it("非法 priority 归一化为默认 medium", () => {
    const result = validateRequirementInput({
      title: "标题",
      content: "内容",
      priority: "urgent" as unknown,
    });
    expect(result.ok).toBe(true);
    expect(result.value?.priority).toBe("medium");
  });

  it("接受合法 priority（high）", () => {
    const result = validateRequirementInput({
      title: "标题",
      content: "内容",
      priority: "high",
    });
    expect(result.ok).toBe(true);
    expect(result.value?.priority).toBe("high");
  });

  it("未传 priority 时默认 medium", () => {
    const result = validateRequirementInput({ title: "标题", content: "内容" });
    expect(result.value?.priority).toBe("medium");
  });

  it("lifecycle 不受输入影响（恒为 draft，由 server action 写入）", () => {
    const result = validateRequirementInput({
      title: "标题",
      content: "内容",
      // 即便传入 lifecycle 也应被忽略，不在 value 里透出
      lifecycle: "confirmed",
    } as Record<string, unknown>);
    expect(result.ok).toBe(true);
    expect(result.value).not.toHaveProperty("lifecycle");
  });
});

describe("展示配置常量", () => {
  it("LIFECYCLE_LABELS 覆盖全部五个生命周期", () => {
    expect(LIFECYCLE_LABELS.draft).toBeDefined();
    expect(LIFECYCLE_LABELS.confirmed).toBeDefined();
    expect(LIFECYCLE_LABELS.in_progress).toBeDefined();
    expect(LIFECYCLE_LABELS.delivered).toBeDefined();
    expect(LIFECYCLE_LABELS.parked).toBeDefined();
  });

  it("LIFECYCLE_ORDER 以 draft 在前，符合排序预期", () => {
    expect(LIFECYCLE_ORDER[0]).toBe("draft");
    expect(LIFECYCLE_ORDER).toHaveLength(5);
    // 全部枚举值都在
    expect(LIFECYCLE_ORDER).toEqual(
      expect.arrayContaining([
        "draft",
        "confirmed",
        "in_progress",
        "delivered",
        "parked",
      ])
    );
  });

  it("SOURCE_LABELS 覆盖三种来源", () => {
    expect(SOURCE_LABELS.feedback_topic).toBeDefined();
    expect(SOURCE_LABELS.meeting_item).toBeDefined();
    expect(SOURCE_LABELS.manual).toBeDefined();
  });
});
