import { describe, it, expect } from "vitest";
import {
  validateApiInput,
  isCamelCase,
  checkCamelCase,
  extractFieldNames,
  checkErrorCodes,
  analyzeOpenApiDoc,
  nextVersionNumber,
  REQUIRED_ERROR_CODES,
} from "@/lib/api-designer";

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
