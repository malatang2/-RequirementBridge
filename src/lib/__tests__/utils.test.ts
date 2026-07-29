import { describe, it, expect } from "vitest";
import { cn } from "@/lib/utils";

describe("cn", () => {
  it("合并多个 className", () => {
    expect(cn("px-2", "py-1")).toBe("px-2 py-1");
  });

  it("处理条件类名（falsy 过滤）", () => {
    expect(cn("base", false && "hidden", undefined, "tail")).toBe("base tail");
  });

  it("tailwind-merge 去重冲突类", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });
});
