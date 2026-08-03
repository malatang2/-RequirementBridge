import { describe, it, expect } from "vitest";
import {
  validateApiInput,
  isCamelCase,
  checkCamelCase,
  extractFieldNames,
  checkErrorCodes,
  analyzeOpenApiDoc,
  nextVersionNumber,
  groupApiDraftsByRequirement,
  extractFirstPathMethod,
  draftOriginLabel,
  REQUIRED_ERROR_CODES,
} from "@/lib/api-designer";
import type { ApiDraft, RequirementDraft } from "@/types/database";

describe("validateApiInput", () => {
  it("接受有效输入并 trim", () => {
    const r = validateApiInput({ businessRequirement: "  实现邮箱密码登录接口  ", apiSpecContext: "camelCase 规范" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.businessRequirement).toBe("实现邮箱密码登录接口");
      expect(r.apiSpecContext).toBe("camelCase 规范");
    }
  });

  it("api_spec_context 选填，空时为 null", () => {
    const r = validateApiInput({ businessRequirement: "实现邮箱密码登录接口" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.apiSpecContext).toBeNull();
  });

  it("拒绝空业务需求", () => {
    expect(validateApiInput({ businessRequirement: "" }).ok).toBe(false);
    expect(validateApiInput({}).ok).toBe(false);
  });

  it("拒绝过短需求（<10 字）", () => {
    expect(validateApiInput({ businessRequirement: "短" }).ok).toBe(false);
  });

  it("接受刚好 10 字", () => {
    expect(validateApiInput({ businessRequirement: "实现用户邮箱登录接口" }).ok).toBe(true);
  });

  it("拒绝超长需求（>5000）", () => {
    expect(validateApiInput({ businessRequirement: "a".repeat(5001) }).ok).toBe(false);
  });
});

describe("isCamelCase", () => {
  it("合法 camelCase", () => {
    expect(isCamelCase("userName")).toBe(true);
    expect(isCamelCase("email")).toBe(true);
    expect(isCamelCase("id")).toBe(true);
    expect(isCamelCase("accessToken")).toBe(true);
  });

  it("拒绝 snake_case", () => {
    expect(isCamelCase("user_name")).toBe(false);
    expect(isCamelCase("access_token")).toBe(false);
  });

  it("拒绝 kebab-case", () => {
    expect(isCamelCase("user-name")).toBe(false);
  });

  it("拒绝 PascalCase（首字母大写）", () => {
    expect(isCamelCase("UserName")).toBe(false);
    expect(isCamelCase("User")).toBe(false);
  });

  it("拒绝含空格", () => {
    expect(isCamelCase("user name")).toBe(false);
  });

  it("拒绝数字开头", () => {
    expect(isCamelCase("1user")).toBe(false);
  });

  it("空串返回 false", () => {
    expect(isCamelCase("")).toBe(false);
  });
});

describe("checkCamelCase", () => {
  it("全部合规 rate=1", () => {
    const r = checkCamelCase(["userName", "email", "id"]);
    expect(r.rate).toBe(1);
    expect(r.compliant).toBe(3);
    expect(r.violations).toEqual([]);
  });

  it("部分违规列出 violations", () => {
    const r = checkCamelCase(["userName", "user_name", "email", "UserToken"]);
    expect(r.rate).toBe(0.5);
    expect(r.violations).toEqual(["user_name", "UserToken"]);
  });

  it("空列表 rate=1（无字段视为全合规）", () => {
    const r = checkCamelCase([]);
    expect(r.rate).toBe(1);
  });
});

describe("extractFieldNames", () => {
  it("从 components/schemas 提取属性名", () => {
    const doc = {
      components: {
        schemas: {
          User: { properties: { userName: {}, email: {} } },
          LoginRequest: { properties: { password: {} } },
        },
      },
    };
    expect(extractFieldNames(doc).sort()).toEqual(["email", "password", "userName"]);
  });

  it("从 paths 的 parameters 提取参数名", () => {
    const doc = {
      paths: {
        "/users/{id}": {
          get: { parameters: [{ name: "userId" }, { name: "pageSize" }] },
        },
      },
    };
    expect(extractFieldNames(doc).sort()).toEqual(["pageSize", "userId"]);
  });

  it("去重（schema 和参数同名）", () => {
    const doc = {
      components: { schemas: { U: { properties: { userId: {} } } } },
      paths: { "/u": { get: { parameters: [{ name: "userId" }] } } },
    };
    expect(extractFieldNames(doc)).toEqual(["userId"]);
  });

  it("无 schemas/paths 返回空", () => {
    expect(extractFieldNames({})).toEqual([]);
  });
});

describe("checkErrorCodes", () => {
  const buildDoc = (responses: Record<string, unknown>) => ({
    paths: {
      "/login": {
        post: { responses },
      },
    },
  });

  it("四码齐全 ok=true", () => {
    const doc = buildDoc({
      "200": {},
      "400": {}, "401": {}, "404": {}, "500": {},
    });
    const r = checkErrorCodes(doc);
    expect(r.ok).toBe(true);
    expect(r.missing).toEqual([]);
    expect(r.checkedPaths).toBe(1);
  });

  it("缺失部分返回 missing", () => {
    const doc = buildDoc({ "200": {}, "400": {}, "401": {} });
    const r = checkErrorCodes(doc);
    expect(r.ok).toBe(false);
    expect(r.missing.sort()).toEqual(["404", "500"]);
  });

  it("无 responses 视为全部缺失", () => {
    const doc = { paths: { "/x": { get: {} } } };
    const r = checkErrorCodes(doc);
    expect(r.ok).toBe(false);
    expect(r.missing.sort()).toEqual([...REQUIRED_ERROR_CODES].sort());
  });

  it("无 paths 视为失败", () => {
    expect(checkErrorCodes({}).ok).toBe(false);
  });

  it("跳过非 HTTP 方法键", () => {
    const doc = {
      paths: {
        "/x": {
          summary: "desc",  // 非 HTTP 方法，应跳过
          parameters: [],    // 非 HTTP 方法，应跳过
          get: { responses: { "400": {}, "401": {}, "404": {}, "500": {} } },
        },
      },
    };
    const r = checkErrorCodes(doc);
    expect(r.checkedPaths).toBe(1);
    expect(r.ok).toBe(true);
  });

  it("多 path 多方法都检查", () => {
    const doc = {
      paths: {
        "/a": {
          get: { responses: { "400": {}, "401": {}, "404": {}, "500": {} } },
          post: { responses: { "400": {}, "401": {}, "404": {}, "500": {} } },
        },
      },
    };
    expect(checkErrorCodes(doc).checkedPaths).toBe(2);
  });
});

describe("analyzeOpenApiDoc", () => {
  it("合格文档无 issues", () => {
    const doc = {
      openapi: "3.0.0",
      paths: {
        "/login": {
          post: {
            responses: { "200": {}, "400": {}, "401": {}, "404": {}, "500": {} },
          },
        },
      },
      components: {
        schemas: { LoginReq: { properties: { email: {}, password: {} } } },
      },
    };
    const r = analyzeOpenApiDoc(doc);
    expect(r.hasOpenapiField).toBe(true);
    expect(r.hasPaths).toBe(true);
    expect(r.camelCase.rate).toBe(1);
    expect(r.errorCodes.ok).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it("缺 openapi 字段报告 issue", () => {
    const r = analyzeOpenApiDoc({ paths: {} });
    expect(r.issues).toContain("缺少 openapi 版本字段");
  });

  it("camelCase 不达标报告 issue", () => {
    const doc = {
      openapi: "3.0.0",
      paths: { "/x": { get: { responses: { "400": {}, "401": {}, "404": {}, "500": {} } } } },
      components: { schemas: { A: { properties: { bad_name: {}, good: {} } } } },
    };
    const r = analyzeOpenApiDoc(doc);
    expect(r.issues.some((s) => s.includes("字段命名规范率"))).toBe(true);
  });

  it("错误码不全报告 issue", () => {
    const doc = {
      openapi: "3.0.0",
      paths: { "/x": { get: { responses: { "200": {} } } } },
    };
    const r = analyzeOpenApiDoc(doc);
    expect(r.issues.some((s) => s.includes("错误码不完整"))).toBe(true);
  });
});

describe("nextVersionNumber", () => {
  it("无版本时返回 1", () => {
    expect(nextVersionNumber([])).toBe(1);
  });

  it("取最大版本号 +1", () => {
    expect(nextVersionNumber([{ version_number: 1 }, { version_number: 3 }, { version_number: 2 }])).toBe(4);
  });

  it("单个版本 +1", () => {
    expect(nextVersionNumber([{ version_number: 5 }])).toBe(6);
  });
});

// ============ seam 6：按 Requirement 分组 API 草稿（07 工单）============

/** 构造最小可测 ApiDraft（只填分组关心的字段） */
function makeDraft(
  id: string,
  source_requirement_id: string | null,
  extra: Partial<ApiDraft> = {}
): ApiDraft {
  return {
    id,
    user_id: "u1",
    project_id: "p1",
    title: `API ${id}`,
    business_requirement: "br",
    api_spec_context: null,
    current_yaml: null,
    current_version_id: null,
    status: "completed",
    error_message: null,
    is_edited: false,
    source_requirement_id,
    llm_usage: null,
    completed_at: null,
    created_at: "2026-08-03T00:00:00Z",
    updated_at: "2026-08-03T00:00:00Z",
    ...extra,
  };
}

/** 构造最小可测 RequirementDraft */
function makeRequirement(
  id: string,
  extra: Partial<RequirementDraft> = {}
): RequirementDraft {
  return {
    id,
    user_id: "u1",
    project_id: "p1",
    source_type: "manual",
    source_topic_id: null,
    source_meeting_item_id: null,
    title: `需求 ${id}`,
    content: "c",
    status: "completed",
    priority: "medium",
    lifecycle: "confirmed",
    is_edited: false,
    deleted_at: null,
    created_at: "2026-08-03T00:00:00Z",
    updated_at: "2026-08-03T00:00:00Z",
    ...extra,
  };
}

describe("groupApiDraftsByRequirement", () => {
  it("有归属：把带 source_requirement_id 的草稿归入对应需求组", () => {
    const drafts = [makeDraft("a1", "r1"), makeDraft("a2", "r2")];
    const requirements = [makeRequirement("r1"), makeRequirement("r2")];

    const groups = groupApiDraftsByRequirement(drafts, requirements);

    expect(groups).toHaveLength(2);
    // 都应有归属
    expect(groups.every((g) => g.requirement !== null)).toBe(true);
    // 找到 r1 组
    const g1 = groups.find((g) => g.requirement?.id === "r1");
    expect(g1?.drafts.map((d) => d.id)).toEqual(["a1"]);
    expect(g1?.requirement?.title).toBe("需求 r1");
  });

  it("无归属：source_requirement_id 为空的草稿归入「未归属」组（在最后）", () => {
    const drafts = [makeDraft("a1", null), makeDraft("a2", null)];
    const requirements: RequirementDraft[] = [];

    const groups = groupApiDraftsByRequirement(drafts, requirements);

    expect(groups).toHaveLength(1);
    const last = groups[groups.length - 1];
    expect(last.requirement).toBeNull();
    expect(last.drafts.map((d) => d.id)).toEqual(["a1", "a2"]);
  });

  it("多接口同需求：同一 source_requirement_id 的多个草稿并入同一组", () => {
    const drafts = [
      makeDraft("a1", "r1"),
      makeDraft("a2", "r1"),
      makeDraft("a3", "r1"),
    ];
    const requirements = [makeRequirement("r1")];

    const groups = groupApiDraftsByRequirement(drafts, requirements);

    expect(groups).toHaveLength(1);
    expect(groups[0].drafts.map((d) => d.id)).toEqual(["a1", "a2", "a3"]);
  });

  it("单接口单需求：一个草稿一个需求的最小场景", () => {
    const drafts = [makeDraft("a1", "r1")];
    const requirements = [makeRequirement("r1")];

    const groups = groupApiDraftsByRequirement(drafts, requirements);

    expect(groups).toHaveLength(1);
    expect(groups[0].requirement?.id).toBe("r1");
    expect(groups[0].drafts).toHaveLength(1);
  });

  it("孤儿 source_requirement_id（需求被软删/跨项目）归入「未归属」而非报错", () => {
    // 草稿指向 r_orphan，但 requirements 列表里没有（被删/跨项目）
    const drafts = [
      makeDraft("a1", "r_real"),
      makeDraft("a2", "r_orphan"),
    ];
    const requirements = [makeRequirement("r_real")];

    const groups = groupApiDraftsByRequirement(drafts, requirements);

    // r_real 组 + 未归属组
    expect(groups).toHaveLength(2);
    const unattached = groups[groups.length - 1];
    expect(unattached.requirement).toBeNull();
    expect(unattached.drafts.map((d) => d.id)).toEqual(["a2"]);
  });

  it("混合场景：归属组在前、未归属组恒在最后", () => {
    const drafts = [
      makeDraft("a_unattached", null),
      makeDraft("a_r1", "r1"),
      makeDraft("a_orphan", "r_ghost"),
      makeDraft("a_r2", "r2"),
    ];
    const requirements = [makeRequirement("r1"), makeRequirement("r2")];

    const groups = groupApiDraftsByRequirement(drafts, requirements);

    // 两个归属组 + 一个未归属组
    expect(groups).toHaveLength(3);
    // 最后一组恒为未归属
    expect(groups[groups.length - 1].requirement).toBeNull();
    expect(groups[groups.length - 1].drafts.map((d) => d.id)).toEqual(["a_unattached", "a_orphan"]);
  });

  it("空 drafts 返回空数组（不出「未归属」空组）", () => {
    expect(groupApiDraftsByRequirement([], [])).toEqual([]);
  });
});

// ============ seam 7：extractFirstPathMethod（07 工单）============

describe("extractFirstPathMethod", () => {
  it("返回首个 path + 首个 method", () => {
    const doc = {
      paths: {
        "/login": { post: { responses: {} } },
      },
    };
    expect(extractFirstPathMethod(doc)).toEqual({ path: "/login", method: "post" });
  });

  it("多个 path 取 Object 插入顺序的第一个", () => {
    const doc = {
      paths: {
        "/users": { get: {} },
        "/users/{id}": { delete: {} },
      },
    };
    expect(extractFirstPathMethod(doc)).toEqual({ path: "/users", method: "get" });
  });

  it("同 path 多 method 取 HTTP_METHODS 声明顺序靠前的", () => {
    // get 在 HTTP_METHODS 里排在 post 之前
    const doc = { paths: { "/x": { post: {}, get: {} } } };
    expect(extractFirstPathMethod(doc)).toEqual({ path: "/x", method: "get" });
  });

  it("跳过非 HTTP 方法键（parameters/summary）", () => {
    const doc = {
      paths: {
        "/x": {
          summary: "desc",
          parameters: [],
          get: {},
        },
      },
    };
    expect(extractFirstPathMethod(doc)).toEqual({ path: "/x", method: "get" });
  });

  it("无 paths 返回 null", () => {
    expect(extractFirstPathMethod({})).toBeNull();
  });

  it("paths 为空对象返回 null", () => {
    expect(extractFirstPathMethod({ paths: {} })).toBeNull();
  });

  it("path 对象里没有 HTTP method 返回 null", () => {
    expect(extractFirstPathMethod({ paths: { "/x": { summary: "s" } } })).toBeNull();
  });

  it("输入非对象返回 null", () => {
    expect(extractFirstPathMethod(null)).toBeNull();
    expect(extractFirstPathMethod("yaml string")).toBeNull();
    expect(extractFirstPathMethod(undefined)).toBeNull();
  });
});

// ============ seam 8：draftOriginLabel（07 工单）============

describe("draftOriginLabel", () => {
  it("命名组内返回 null（组头已标需求，origin 冗余）", () => {
    expect(draftOriginLabel(false, "r1")).toBeNull();
  });

  it("命名组内即使 source_requirement_id 为空也返回 null", () => {
    // 防御：命名组里按定义 source_requirement_id 必非空，但函数不假设这一点
    expect(draftOriginLabel(false, null)).toBeNull();
  });

  it("未归属组 + source_requirement_id 为空 → 自由创建", () => {
    expect(draftOriginLabel(true, null)).toBe("自由创建");
  });

  it("未归属组 + source_requirement_id 非空 → 原属需求已删除（orphan）", () => {
    expect(draftOriginLabel(true, "r_ghost")).toBe("原属需求已删除");
  });
});
