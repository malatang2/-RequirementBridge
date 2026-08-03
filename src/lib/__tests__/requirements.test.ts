import { describe, it, expect } from "vitest";
import {
  validateRequirementInput,
  canTransition,
  describeTransition,
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

describe("canTransition — Requirement 生命周期流转关卡（04 工单）", () => {
  describe("合法流转", () => {
    it("draft → confirmed 为 true（本工单 UI 的核心路径）", () => {
      expect(canTransition("draft", "confirmed")).toBe(true);
    });

    it("draft → parked 为 true（草稿可直接搁置）", () => {
      expect(canTransition("draft", "parked")).toBe(true);
    });

    it("confirmed → in_progress 为 true", () => {
      expect(canTransition("confirmed", "in_progress")).toBe(true);
    });

    it("confirmed → parked 为 true", () => {
      expect(canTransition("confirmed", "parked")).toBe(true);
    });

    it("in_progress → delivered 为 true", () => {
      expect(canTransition("in_progress", "delivered")).toBe(true);
    });

    it("in_progress → parked 为 true", () => {
      expect(canTransition("in_progress", "parked")).toBe(true);
    });
  });

  describe("非法流转（必须拒绝）", () => {
    it("delivered → draft 为 false（终态无出度）", () => {
      expect(canTransition("delivered", "draft")).toBe(false);
    });

    it("delivered → confirmed 为 false（终态无出度）", () => {
      expect(canTransition("delivered", "confirmed")).toBe(false);
    });

    it("parked → draft 为 false（终态无出度）", () => {
      expect(canTransition("parked", "draft")).toBe(false);
    });

    it("confirmed → draft 为 false（不可回退）", () => {
      expect(canTransition("confirmed", "draft")).toBe(false);
    });

    it("draft → delivered 为 false（跨级跳跃）", () => {
      expect(canTransition("draft", "delivered")).toBe(false);
    });

    it("draft → in_progress 为 false（跨级跳跃）", () => {
      expect(canTransition("draft", "in_progress")).toBe(false);
    });

    it("confirmed → delivered 为 false（跨级跳跃）", () => {
      expect(canTransition("confirmed", "delivered")).toBe(false);
    });
  });

  describe("自环（无意义流转拒绝）", () => {
    it("draft → draft 为 false", () => {
      expect(canTransition("draft", "draft")).toBe(false);
    });

    it("confirmed → confirmed 为 false", () => {
      expect(canTransition("confirmed", "confirmed")).toBe(false);
    });

    it("delivered → delivered 为 false", () => {
      expect(canTransition("delivered", "delivered")).toBe(false);
    });

    it("parked → parked 为 false", () => {
      expect(canTransition("parked", "parked")).toBe(false);
    });
  });

  describe("终态 delivered/parked 无任何出度", () => {
    it("delivered 到任意其他状态均为 false", () => {
      (["draft", "confirmed", "in_progress", "parked"] as const).forEach((to) => {
        expect(canTransition("delivered", to)).toBe(false);
      });
    });

    it("parked 到任意其他状态均为 false", () => {
      (["draft", "confirmed", "in_progress", "delivered"] as const).forEach((to) => {
        expect(canTransition("parked", to)).toBe(false);
      });
    });
  });
});

describe("describeTransition — 给 action 层返回错误文案", () => {
  it("合法流转返回 ok:true", () => {
    expect(describeTransition("draft", "confirmed")).toEqual({ ok: true });
  });

  it("非法流转返回 ok:false 带中文文案", () => {
    const r = describeTransition("delivered", "draft");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(typeof r.error).toBe("string");
      expect(r.error.length).toBeGreaterThan(0);
    }
  });

  it("自环也返回错误文案", () => {
    const r = describeTransition("draft", "draft");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(typeof r.error).toBe("string");
    }
  });
});
