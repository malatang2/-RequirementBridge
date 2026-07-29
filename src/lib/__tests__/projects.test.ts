import { describe, it, expect } from "vitest";
import {
  validateProjectInput,
  isArchived,
  filterActive,
} from "@/lib/projects";

describe("validateProjectInput", () => {
  it("接受有效的项目名并 trim", () => {
    const result = validateProjectInput({ name: "  我的项目  " });
    expect(result.ok).toBe(true);
    expect(result.value?.name).toBe("我的项目");
  });

  it("拒绝空名称", () => {
    expect(validateProjectInput({ name: "" })).toEqual({
      ok: false,
      error: "项目名称不能为空",
    });
  });

  it("拒绝纯空白名称", () => {
    expect(validateProjectInput({ name: "   " }).ok).toBe(false);
  });

  it("拒绝非字符串名称", () => {
    expect(validateProjectInput({ name: 123 }).ok).toBe(false);
  });

  it("拒绝超过 100 字的名称", () => {
    expect(validateProjectInput({ name: "a".repeat(101) }).ok).toBe(false);
  });

  it("接受刚好 100 字的名称", () => {
    expect(validateProjectInput({ name: "a".repeat(100) }).ok).toBe(true);
  });

  it("把空白描述归一化为 null", () => {
    const result = validateProjectInput({
      name: "项目",
      description: "   ",
    });
    expect(result.value?.description).toBeNull();
  });

  it("保留有效描述与 API 规范上下文", () => {
    const result = validateProjectInput({
      name: "项目",
      description: "一段描述",
      api_spec_context: "camelCase 规范",
    });
    expect(result.value).toEqual({
      name: "项目",
      description: "一段描述",
      api_spec_context: "camelCase 规范",
    });
  });
});

describe("isArchived", () => {
  it("archived_at 非空视为已归档", () => {
    expect(isArchived({ archived_at: "2026-07-29T00:00:00Z" })).toBe(true);
  });

  it("archived_at 为 null 视为活跃", () => {
    expect(isArchived({ archived_at: null })).toBe(false);
  });
});

describe("filterActive", () => {
  it("只保留未归档项目", () => {
    const projects = [
      { archived_at: null },
      { archived_at: "2026-07-29T00:00:00Z" },
      { archived_at: null },
    ];
    expect(filterActive(projects)).toHaveLength(2);
  });

  it("空列表返回空列表", () => {
    expect(filterActive([])).toEqual([]);
  });
});
