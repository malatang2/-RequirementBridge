/**
 * 项目 CRUD 服务层（T0.4）。
 *
 * 设计：把「可测的纯逻辑」与「DB 调用」分离。
 * - validateProjectInput / isArchived 等是纯函数（seam），可单测。
 * - listProjects / createProject 等是 DB 薄封装，靠 RLS 隔离 + 集成测试。
 *
 * 对应 DoD：项目可创建/读取/更新/删除；切换项目后各模块数据按项目隔离。
 */

import type { Project } from "@/types/database";

/** 创建/更新项目的输入 */
export interface ProjectInput {
  name: string;
  description?: string | null;
  api_spec_context?: string | null;
}

export type ProjectValidation = {
  ok: boolean;
  error?: string;
  value?: ProjectInput;
};

/** 校验项目输入（纯函数 seam） */
export function validateProjectInput(input: {
  name?: unknown;
  description?: unknown;
  api_spec_context?: unknown;
}): ProjectValidation {
  const name = typeof input.name === "string" ? input.name.trim() : "";

  if (!name) {
    return { ok: false, error: "项目名称不能为空" };
  }
  if (name.length > 100) {
    return { ok: false, error: "项目名称不能超过 100 字" };
  }

  return {
    ok: true,
    value: {
      name,
      description:
        typeof input.description === "string" ? input.description.trim() || null : null,
      api_spec_context:
        typeof input.api_spec_context === "string"
          ? input.api_spec_context.trim() || null
          : null,
    },
  };
}

/** 判断项目是否已归档（纯函数 seam） */
export function isArchived(project: Pick<Project, "archived_at">): boolean {
  return project.archived_at !== null;
}

/** 从项目列表中筛选未归档的（纯函数 seam，列表页用） */
export function filterActive(projects: Pick<Project, "archived_at">[]): typeof projects {
  return projects.filter((p) => !isArchived(p));
}
