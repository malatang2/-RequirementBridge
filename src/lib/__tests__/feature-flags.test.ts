import { describe, it, expect } from "vitest";
import { parseFeatureFlags } from "@/lib/feature-flags";

/**
 * parseFeatureFlags 是灰度链路的唯一解析点（09 工单）。
 * 语义：fail closed——任何非法输入一律全关，只有 requirement_hub === true 才开。
 */
describe("parseFeatureFlags", () => {
  it("null → 全关", () => {
    expect(parseFeatureFlags(null)).toEqual({ requirementHub: false });
  });

  it("undefined → 全关", () => {
    expect(parseFeatureFlags(undefined)).toEqual({ requirementHub: false });
  });

  it("数组 → 全关", () => {
    expect(parseFeatureFlags([])).toEqual({ requirementHub: false });
    expect(parseFeatureFlags([{ requirement_hub: true }])).toEqual({
      requirementHub: false,
    });
  });

  it("字符串 → 全关", () => {
    expect(parseFeatureFlags("requirement_hub")).toEqual({ requirementHub: false });
    expect(parseFeatureFlags('{"requirement_hub": true}')).toEqual({
      requirementHub: false,
    });
  });

  it("数字 / 布尔 → 全关", () => {
    expect(parseFeatureFlags(0)).toEqual({ requirementHub: false });
    expect(parseFeatureFlags(true)).toEqual({ requirementHub: false });
  });

  it("空对象 → 全关", () => {
    expect(parseFeatureFlags({})).toEqual({ requirementHub: false });
  });

  it("requirement_hub: true → 开", () => {
    expect(parseFeatureFlags({ requirement_hub: true })).toEqual({
      requirementHub: true,
    });
  });

  it("requirement_hub: false → 关", () => {
    expect(parseFeatureFlags({ requirement_hub: false })).toEqual({
      requirementHub: false,
    });
  });

  it("requirement_hub 非严格 true（'true' 字符串 / 1）→ 关", () => {
    expect(parseFeatureFlags({ requirement_hub: "true" })).toEqual({
      requirementHub: false,
    });
    expect(parseFeatureFlags({ requirement_hub: 1 })).toEqual({
      requirementHub: false,
    });
  });

  it("其他 key 一律忽略（含嵌套对象值）", () => {
    expect(
      parseFeatureFlags({ other_feature: true, nested: { requirement_hub: true } })
    ).toEqual({ requirementHub: false });
  });

  it("其他 key 与 requirement_hub 并存时只看 requirement_hub", () => {
    expect(
      parseFeatureFlags({ requirement_hub: true, beta: true, extra: "x" })
    ).toEqual({ requirementHub: true });
  });

  it("每次返回新对象（调用方改写不影响后续解析）", () => {
    const a = parseFeatureFlags({ requirement_hub: true });
    a.requirementHub = false;
    expect(parseFeatureFlags({ requirement_hub: true })).toEqual({
      requirementHub: true,
    });
    expect(parseFeatureFlags(null)).not.toBe(parseFeatureFlags(null));
  });
});
