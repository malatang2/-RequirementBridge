/**
 * API 设计器服务层（M2）。
 *
 * 设计（mattpocock TDD）：可测纯逻辑 seam 与 Edge Function / DB 调用分离。
 * 这些纯函数对应 SOW §6.2 的"程序化校验项必须 100%"验收门槛：
 *   - validateApiInput：业务需求输入校验
 *   - checkCamelCase：字段命名规范率 ≥95%
 *   - checkErrorCodes：错误码完整率 100%（每 path 含 400/401/404/500）
 *   - analyzeOpenApiYaml：综合分析（前端实时校验 + 服务端权威校验共用）
 *
 * 对应《前后端接口契约 §2.4》《设计评审 F11》：前端 js-yaml 语法实时校验 +
 * 服务端 swagger-parser 权威校验双层分工。
 */

import type { GenStatus, ApiDraft, PriorityLevel, RequirementLifecycle } from "@/types/database";

/** 必填错误码（每个 path 至少含这四个，验收门槛 100%） */
export const REQUIRED_ERROR_CODES = ["400", "401", "404", "500"] as const;

// ============ seam 1：业务需求输入校验 ============

export type ApiInputValidation =
  | { ok: true; businessRequirement: string; apiSpecContext: string | null }
  | { ok: false; error: string };

/** 校验 API 设计输入（业务需求必填，规范上下文选填） */
export function validateApiInput(input: {
  businessRequirement?: unknown;
  apiSpecContext?: unknown;
}): ApiInputValidation {
  const br =
    typeof input.businessRequirement === "string"
      ? input.businessRequirement.trim()
      : "";
  if (!br) return { ok: false, error: "业务需求不能为空" };
  if (br.length < 10)
    return { ok: false, error: "业务需求过短（至少 10 字），请补充细节" };
  if (br.length > 5000)
    return { ok: false, error: "业务需求过长（不超过 5000 字）" };

  const ctx =
    typeof input.apiSpecContext === "string" && input.apiSpecContext.trim()
      ? input.apiSpecContext.trim()
      : null;

  return { ok: true, businessRequirement: br, apiSpecContext: ctx };
}

// ============ seam 2：camelCase 字段命名检查 ============

/**
 * 判断单个字段名是否 camelCase。
 * 规则：首字母小写，仅含字母数字，不含下划线/连字符/空格。
 * 允许全小写单词（如 id、name）。
 */
export function isCamelCase(name: string): boolean {
  if (!name) return false;
  // 含 _、-、空格 → 非 camelCase（snake_case / kebab-case）
  if (/[_\-\s]/.test(name)) return false;
  // 必须以小写字母开头（数字开头不符合）
  if (!/^[a-z]/.test(name)) return false;
  // 仅含字母数字
  if (!/^[a-zA-Z0-9]+$/.test(name)) return false;
  return true;
}

/**
 * 扫描 OpenAPI 文档的字段命名规范率。
 * 输入：所有需要校验的字段名（schema 属性 + 参数名）。
 * 返回：{ compliant, total, rate, violations }
 */
export function checkCamelCase(fieldNames: string[]): {
  compliant: number;
  total: number;
  rate: number;
  violations: string[];
} {
  const violations: string[] = [];
  let compliant = 0;
  for (const name of fieldNames) {
    if (isCamelCase(name)) {
      compliant++;
    } else {
      violations.push(name);
    }
  }
  const total = fieldNames.length;
  const rate = total === 0 ? 1 : compliant / total;
  return { compliant, total, rate, violations };
}

/**
 * 从 OpenAPI 文档对象中提取所有需校验的字段名（schema 属性 + 参数）。
 * 纯函数，供 checkCamelCase 使用。
 */
export function extractFieldNames(doc: Record<string, unknown>): string[] {
  const names: string[] = [];
  const seen = new Set<string>();

  // components/schemas 的属性
  const schemas = (doc.components as Record<string, unknown> | undefined)?.schemas as
    | Record<string, { properties?: Record<string, unknown> }>
    | undefined;
  if (schemas) {
    for (const schema of Object.values(schemas)) {
      const props = schema?.properties;
      if (props && typeof props === "object") {
        for (const key of Object.keys(props)) {
          if (!seen.has(key)) {
            seen.add(key);
            names.push(key);
          }
        }
      }
    }
  }

  // paths 下每个操作的 parameters.name
  const paths = doc.paths as Record<string, Record<string, unknown>> | undefined;
  if (paths) {
    for (const pathObj of Object.values(paths)) {
      if (!pathObj || typeof pathObj !== "object") continue;
      for (const op of Object.values(pathObj)) {
        const params = (op as { parameters?: Array<{ name?: string }> })?.parameters;
        if (Array.isArray(params)) {
          for (const p of params) {
            if (p?.name && !seen.has(p.name)) {
              seen.add(p.name);
              names.push(p.name);
            }
          }
        }
      }
    }
  }

  return names;
}

// ============ seam 3：错误码完整性检查 ============

export interface ErrorCodeCheck {
  ok: boolean;
  missing: string[]; // 缺失的错误码
  checkedPaths: number;
}

/**
 * 检查 OpenAPI 文档中每个 path 的每个操作是否包含必需错误码。
 * 验收门槛 100%（接口契约 §2.4）。
 */
export function checkErrorCodes(doc: Record<string, unknown>): ErrorCodeCheck {
  const allMissing: string[] = [];
  let checkedPaths = 0;

  const paths = doc.paths as Record<string, Record<string, unknown>> | undefined;
  if (!paths) return { ok: false, missing: ["paths"], checkedPaths: 0 };

  for (const pathObj of Object.values(paths)) {
    if (!pathObj || typeof pathObj !== "object") continue;
    for (const [method, op] of Object.entries(pathObj)) {
      // 跳过非 HTTP 方法键（如 parameters、summary）
      if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
      if (!op || typeof op !== "object") continue;

      checkedPaths++;
      const responses = (op as { responses?: Record<string, unknown> }).responses;
      if (!responses) {
        allMissing.push(...REQUIRED_ERROR_CODES);
        continue;
      }
      const present = new Set(Object.keys(responses));
      for (const code of REQUIRED_ERROR_CODES) {
        if (!present.has(code)) {
          allMissing.push(code);
        }
      }
    }
  }

  return {
    ok: allMissing.length === 0 && checkedPaths > 0,
    missing: allMissing,
    checkedPaths,
  };
}

// ============ seam 4：YAML 综合分析（前端实时校验用）============

export interface YamlAnalysis {
  /** YAML 语法是否能解析（js-yaml 层） */
  parseable: boolean;
  /** 解析后的文档对象（不可解析时为 null） */
  doc: Record<string, unknown> | null;
  /** 是否含 openapi 字段 */
  hasOpenapiField: boolean;
  /** 是否含 paths */
  hasPaths: boolean;
  /** camelCase 规范率 */
  camelCase: { rate: number; violations: string[] };
  /** 错误码完整性 */
  errorCodes: ErrorCodeCheck;
  /** 综合问题（供前端高亮显示） */
  issues: string[];
}

/** 分析已解析的 OpenAPI 文档对象（前端实时校验用，非 YAML 解析） */
export function analyzeOpenApiDoc(doc: Record<string, unknown>): YamlAnalysis {
  const issues: string[] = [];
  const hasOpenapiField = "openapi" in doc;
  const hasPaths = "paths" in doc;

  if (!hasOpenapiField) issues.push("缺少 openapi 版本字段");
  if (!hasPaths) issues.push("缺少 paths 定义");

  const camelCase = checkCamelCase(extractFieldNames(doc));
  if (camelCase.rate < 0.95) {
    issues.push(
      `字段命名规范率 ${(camelCase.rate * 100).toFixed(0)}%（门槛 ≥95%）：${camelCase.violations.slice(0, 5).join(", ")}`
    );
  }

  const errorCodes = checkErrorCodes(doc);
  if (!errorCodes.ok) {
    issues.push(`错误码不完整：缺失 ${errorCodes.missing.join(", ")}`);
  }

  return {
    parseable: true,
    doc,
    hasOpenapiField,
    hasPaths,
    camelCase,
    errorCodes,
    issues,
  };
}

// ============ seam 5：版本号计算 ============

/** 计算下一个版本号（基于已有版本列表） */
export function nextVersionNumber(existingVersions: { version_number: number }[]): number {
  if (existingVersions.length === 0) return 1;
  return Math.max(...existingVersions.map((v) => v.version_number)) + 1;
}

// ============ 共享：生成状态机 ============

export type ApiGenStatus = GenStatus;

export const API_STATUS_META: Record<ApiGenStatus, { label: string; color: string }> = {
  generating: { label: "生成中…", color: "text-blue-600" },
  completed: { label: "完成", color: "text-green-600" },
  failed: { label: "失败", color: "text-red-600" },
};

// ============ seam 6：按 Requirement 分组 API 草稿（07 工单）============

/**
 * Requirement 元信息投影——只取分组视图需要的字段。
 * 故意不直接复用 RequirementDraft，避免把整个实体塞进纯函数的输入
 * （requirements 由调用方批量查好后传入，可能来自 select 子集）。
 *
 * lifecycle / priority 用枚举类型而非 string：避免每个使用点都要 `as` 反复 cast
 * （Primitive Obsession——primitive 包装了 domain concept 却丢了类型约束）。
 */
export interface RequirementProjection {
  id: string;
  title: string;
  lifecycle: RequirementLifecycle;
  priority: PriorityLevel;
}

/** 分组结果：有归属（按需求聚合）+ 未归属组（requirement === null，恒在最后） */
export interface ApiDraftGroup {
  requirement: RequirementProjection | null;
  drafts: ApiDraft[];
}

/**
 * 把 API 草稿按 source_requirement_id 分组。
 * - 有 source_requirement_id 且能在 requirements 里找到对应需求的 → 归到该需求组
 * - 没关联（null）或关联的需求不在 requirements 列表里（被软删/跨项目）→ 归「未归属」组
 *
 * 纯函数，不查 DB——requirements 由调用方先查好传入，避免 N+1。
 * 分组顺序：按 requirements 传入顺序（调用方排序后传入），未归属组恒在最后。
 * 组内 drafts 顺序保持传入顺序（页面查询时已 order by created_at desc）。
 */
export function groupApiDraftsByRequirement(
  drafts: ApiDraft[],
  requirements: RequirementProjection[]
): ApiDraftGroup[] {
  const reqMap = new Map(requirements.map((r) => [r.id, r]));
  const grouped = new Map<string, ApiDraft[]>();
  const unattached: ApiDraft[] = [];

  for (const d of drafts) {
    const rid = d.source_requirement_id;
    if (rid && reqMap.has(rid)) {
      const arr = grouped.get(rid) ?? [];
      arr.push(d);
      grouped.set(rid, arr);
    } else {
      unattached.push(d);
    }
  }

  const groups: ApiDraftGroup[] = Array.from(grouped.entries()).map(
    ([rid, ds]) => {
      const r = reqMap.get(rid)!;
      return {
        requirement: {
          id: r.id,
          title: r.title,
          lifecycle: r.lifecycle,
          priority: r.priority,
        },
        drafts: ds,
      };
    }
  );

  // 未归属组恒在最后；空时不出现（避免空「未归属」组干扰 UI）
  if (unattached.length > 0) {
    groups.push({ requirement: null, drafts: unattached });
  }
  return groups;
}

// ============ seam 8：组内草稿的 origin 标签（07 工单）============

/**
 * 分组视图里单条草稿的 origin 标签文案。
 *
 * 三态（与 groupApiDraftsByRequirement 的分组语义对齐）：
 * - 命名组内：组头已标需求，origin 是冗余信息——返回 null（调用方不渲染标签）
 * - 未归属组 + source_requirement_id 为空：纯自由创建 → "自由创建"
 * - 未归属组 + source_requirement_id 非空：关联的需求已被软删/跨项目
 *   （groupApiDraftsByRequirement 解析不到对应需求才落到未归属组）→ "原属需求已删除"
 *
 * 纯函数：便于单测；UI 只负责传入 isUnattached + source_requirement_id。
 */
export function draftOriginLabel(
  isUnattached: boolean,
  source_requirement_id: string | null
): string | null {
  if (!isUnattached) return null;
  return source_requirement_id === null ? "自由创建" : "原属需求已删除";
}

// ============ seam 7：从 OpenAPI 文档提取首个 path + method（07 工单）============

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;

/**
 * 从已解析的 OpenAPI 文档对象中提取首个 path + 首个 method（列表分组视图用）。
 * 纯函数：输入是已解析的 doc（不是 YAML 字符串），失败/空一律返回 null。
 * 「首个」= Object 插入顺序的第一个（OpenAPI doc 通常单 path 单 method，多时取代表）。
 */
export function extractFirstPathMethod(
  doc: unknown
): { path: string; method: string } | null {
  if (typeof doc !== "object" || doc === null) return null;
  const paths = (doc as { paths?: unknown }).paths;
  if (typeof paths !== "object" || paths === null) return null;

  for (const [path, pathObj] of Object.entries(paths)) {
    if (typeof pathObj !== "object" || pathObj === null) continue;
    for (const method of HTTP_METHODS) {
      if (method in (pathObj as Record<string, unknown>)) {
        return { path, method };
      }
    }
  }
  return null;
}
