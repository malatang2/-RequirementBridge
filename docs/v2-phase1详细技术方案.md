# v2 Phase 1 详细技术方案：需求统一中枢主线贯通

> 版本：v2.1-P1-draft | 日期：2026-08-01（v2.1 纳入 v1 技术债 K-1/K-2/K-3）
> 母文档：`docs/v2统一技术方案.md`（数据模型变更、模块边界、迁移策略以母文档为准）
> 目标：把"需求"从只读汇总页升级为**唯一的需求枢纽**，贯通「会议/反馈 → 需求池 → API」主线，并顺手修复 v1 阻断上线的遗留缺口。
> 预计工期：2 周。本方案是工程可执行的落地清单，每个改动点都对应到具体文件、组件、SQL。

---

## 0. Phase 1 范围与优先级

依据 PM 微调建议，Phase 1 拆为 P0（主线必须）和 P1（可降级）两档。功能 1.1-1.5 为 v2 新增主线，K-1/K-2/K-3 为 v1 遗留的上线前必修项。

| # | 功能 | 档位 | 来源 | 理由 |
|---|---|---|---|---|
| 1.1 | 需求模块 CRUD + lifecycle + priority | **P0** | v2 新增 | 统一中枢的本体，其他功能没有承接容器 |
| 1.2 | 反馈→需求确认关卡（draft→confirmed） | **P0** | v2 新增 | 改动最小、价值最大、是埋点关键 |
| 1.3 | 需求→API 一键带入 | **P0** | v2 新增 | 主线最后一公里，否则需求模块是死胡同 |
| 1.4 | 会议→反馈一键转入 | **P1** | v2 新增 | MVP 用 issue 标记，不扩枚举（降低 Prompt 重训风险） |
| 1.5 | 功能需求接口整理视图 | **P1** | v2 新增 | 研发便利功能，可后移到 Phase 2 |
| K-1 | DB check 约束（空项目名） | **P0** | v1 技术债 | 上线前必修，与 007 迁移同批落地 |
| K-2 | PostHog key 配置 | **P0** | v1 技术债 | 埋点采集依赖（v2 北极星指标的可观测基础） |
| K-3 | Google OAuth 配置 + CI 验证 | **P0** | v1 技术债 | 上线前必修，含 D-2 CI 触发验证 |

**Phase 1 MVP 最小可行集**：1.1 + 1.2 + 1.3 + 1.4(MVP) + K-1/K-2/K-3。主线贯通即成立。

---

## 1. 数据模型变更（迁移文件）

### 1.1 `supabase/migrations/007_v2_requirement_hub.sql`

```sql
-- ============================================================
-- 007_v2_requirement_hub.sql
-- v2 Phase 1：需求模块升级为统一中枢
-- 可回滚：加字段不删字段；如需回滚，drop 新增字段/约束/枚举即可
-- ============================================================

-- ① 新增需求生命周期枚举（不复用 gen_status，避免语义错位）
create type requirement_lifecycle as enum (
  'draft',       -- 草稿（AI 生成或转入后默认）
  'confirmed',   -- 已确认纳入需求池（人工把关关卡）
  'in_progress', -- 进行中（已带入 API 设计 / 开发中）
  'delivered',   -- 已交付
  'parked'       -- 搁置
);

-- ② 需求草稿表扩展
alter table requirement_drafts
  add column priority priority_level not null default 'medium',
  add column lifecycle requirement_lifecycle not null default 'draft',
  add column source_meeting_item_id uuid references meeting_items(id) on delete set null,
  add column deleted_at timestamptz;

-- source_type 保持 text 类型（v1 已是 text，兼容），
-- 应用层约束取值集合：'feedback_topic' | 'meeting_item' | 'manual'

-- ③ 保守回填：老数据统一置为 lifecycle='draft'，强制 PM 走查
--    （不自动置为 confirmed，避免噪声当 backlog）
update requirement_drafts set lifecycle = 'draft' where lifecycle is null;

-- ④ 来源一致性约束：source_type 与来源外键匹配
alter table requirement_drafts
  add constraint chk_requirement_source_consistency check (
    (source_type = 'feedback_topic' and source_topic_id is not null)
    or (source_type = 'meeting_item' and source_meeting_item_id is not null)
    or (source_type = 'manual')
    or (source_type not in ('feedback_topic', 'meeting_item', 'manual'))  -- 兜底老数据
  );

-- ⑤ 软删：列表默认不展示已删，但保留外键完整性
create index idx_requirement_drafts_project_active
  on requirement_drafts(project_id, lifecycle, priority)
  where deleted_at is null;

-- ⑥ API 草稿加来源需求关联（需求→API 一键带入）
alter table api_drafts
  add column source_requirement_id uuid references requirement_drafts(id) on delete set null;
create index idx_api_drafts_requirement on api_drafts(source_requirement_id) where source_requirement_id is not null;

-- ⑦ 修复 v1 K-1：DB 层拒绝空项目名
alter table projects
  add constraint projects_name_not_blank check (length(btrim(name)) > 0);

-- ⑧ 灰度开关（feature_flags）
alter table profiles add column feature_flags jsonb not null default '{}'::jsonb;

-- ⑨ 更新触发器：deleted_at 变更也算编辑
-- 沿用 fn_set_updated_at（005_triggers.sql 已挂 before update，无需改）

-- ⑩ RLS：新字段无需额外 policy（行级归属不变，仍是 user_id = auth.uid()）
```

**关键决策**：
- **保留 `requirement_drafts.status`（gen_status）字段不动**——它是 AI 生成时的"generating/completed/failed"语义；新增 `lifecycle` 接管业务状态。两字段并存，互不干扰（status 表征 AI 任务态，lifecycle 表征业务态）。
- **`source_type` 保持 text**：v1 已是 text，不转 enum，避免 `alter type` 重写全表。应用层（`src/lib/requirements.ts`）约束取值集合。
- **软删 `deleted_at`**：对齐 v1 数据模型文档"v2 引入 deleted_at"约定；不用 `is_archived`（那是 projects 的语义）。

### 1.2 `supabase/migrations/008_v2_feedback_source.sql`

```sql
-- ============================================================
-- 008_v2_feedback_source.sql
-- v2 Phase 1：反馈来源追溯 + 会议条目转入标记
-- ============================================================

-- ① 反馈条目加来源（会议转入 / 批量导入 / 粘贴 / 文件）
alter table feedback_items
  add column source_type text not null default 'paste',
  add column source_meta jsonb;
-- source_meta 示例：{"meeting_id":"...","meeting_item_id":"...","row":3}

-- ② 反馈分析加来源标注（标题显示"来自会议《X》"）
alter table feedback_analyses
  add column source_label text;

-- ③ 会议条目加"已转入反馈"标记（防重复转入 + 可追溯角标）
alter table meeting_items
  add column transferred_to_feedback boolean not null default false;

-- ④ 索引：按来源筛选会议条目
create index idx_meeting_items_transferred
  on meeting_items(meeting_id) where transferred_to_feedback = true;

-- ⑤ 来源一致性注释（不加强约束，保持灵活）
comment on column feedback_items.source_type is 'paste | file | meeting | batch_import';
```

---

## 2. 功能 1.1：需求模块 CRUD + lifecycle + priority（P0）

### 2.1 服务层：`src/lib/requirements.ts`（新建，仿 `src/lib/projects.ts` 模式）

```typescript
// src/lib/requirements.ts
import type { RequirementDraft, PriorityLevel } from "@/types/database";

/** 需求来源类型（应用层约束 source_type text 字段的取值） */
export type RequirementSource = "feedback_topic" | "meeting_item" | "manual";

/** 需求生命周期（对应 requirement_lifecycle 枚举） */
export type RequirementLifecycle =
  | "draft" | "confirmed" | "in_progress" | "delivered" | "parked";

/** 创建/更新需求的输入 */
export interface RequirementInput {
  title: string;
  content: string;
  priority?: PriorityLevel;
  lifecycle?: RequirementLifecycle;
}

export type RequirementValidation =
  | { ok: true; value: RequirementInput }
  | { ok: false; error: string };

/** 校验需求输入（纯函数 seam，可单测） */
export function validateRequirementInput(input: {
  title?: unknown;
  content?: unknown;
  priority?: unknown;
  lifecycle?: unknown;
}): RequirementValidation {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!title) return { ok: false, error: "需求标题不能为空" };
  if (title.length > 200) return { ok: false, error: "需求标题不能超过 200 字" };

  const content = typeof input.content === "string" ? input.content : "";
  if (!content.trim()) return { ok: false, error: "需求内容不能为空" };

  const priority = input.priority as PriorityLevel;
  if (!["high", "medium", "low"].includes(priority)) {
    // 默认 medium，不报错
  }

  return {
    ok: true,
    value: {
      title,
      content,
      priority: (["high", "medium", "low"].includes(priority) ? priority : "medium") as PriorityLevel,
      lifecycle: (input.lifecycle as RequirementLifecycle) ?? "draft",
    },
  };
}

/** 判断需求是否已删除（纯函数 seam） */
export function isDeleted(req: Pick<RequirementDraft, "deleted_at">): boolean {
  return req.deleted_at !== null;
}

/** lifecycle 的展示配置（纯函数，UI 复用） */
export const LIFECYCLE_LABELS: Record<RequirementLifecycle, string> = {
  draft: "草稿",
  confirmed: "已确认",
  in_progress: "进行中",
  delivered: "已交付",
  parked: "搁置",
};

export const LIFECYCLE_ORDER: RequirementLifecycle[] = [
  "draft", "confirmed", "in_progress", "delivered", "parked",
];

/** 来源展示配置 */
export const SOURCE_LABELS: Record<string, string> = {
  feedback_topic: "💬 来自反馈",
  meeting_item: "📅 来自会议",
  manual: "✍️ 手动创建",
};
```

**对应单测**：`src/lib/__tests__/requirements.test.ts`（新建），仿 `projects.test.ts` 覆盖：空标题/超长标题/空内容/非法 priority/lifecycle 默认值。

### 2.2 Server Actions：`src/app/dashboard/requirements/actions.ts`（新建）

仿 `src/app/dashboard/projects/actions.ts` 的五段式结构。**关键差异**：需求模块的 lifecycle 状态流转要校验合法性（不能从 delivered 回到 draft 等，由 `canTransition` 纯函数把关）。

```typescript
// src/app/dashboard/requirements/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseActionClient } from "@/lib/supabase/action-client";
import {
  validateRequirementInput,
  canTransition,
  type RequirementLifecycle,
} from "@/lib/requirements";
import { track } from "@/lib/analytics";
import type { RequirementDraft } from "@/types/database";

export type RequirementActionResult =
  | { ok: true; requirement: RequirementDraft }
  | { ok: false; error: string };

/** 列表查询（含筛选：lifecycle / priority / source_type） */
export async function listRequirements(filters: {
  projectId: string;
  lifecycle?: RequirementLifecycle;
  priority?: string;
}): Promise<RequirementDraft[]> {
  const supabase = await createSupabaseActionClient();
  let query = supabase
    .from("requirement_drafts")
    .select("*")
    .eq("project_id", filters.projectId)
    .is("deleted_at", null)                       // 排除软删
    .order("lifecycle", { ascending: true })      // draft 在前
    .order("priority", { ascending: false })      // high 在前
    .order("updated_at", { ascending: false });
  if (filters.lifecycle) query = query.eq("lifecycle", filters.lifecycle);
  if (filters.priority) query = query.eq("priority", filters.priority);
  const { data } = await query;
  return (data as RequirementDraft[]) ?? [];
}

/** 手动创建需求 */
export async function createRequirement(
  projectId: string,
  input: Parameters<typeof validateRequirementInput>[0]
): Promise<RequirementActionResult> {
  const validation = validateRequirementInput(input);
  if (!validation.ok) return { ok: false, error: validation.error ?? "输入无效" };

  const supabase = await createSupabaseActionClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "未登录" };

  const { data, error } = await supabase
    .from("requirement_drafts")
    .insert({
      user_id: user.id,
      project_id: projectId,
      source_type: "manual",
      title: validation.value!.title,
      content: validation.value!.content,
      priority: validation.value!.priority,
      lifecycle: "draft",
      status: "completed",                         // AI 态：非 AI 生成，直接 completed
    })
    .select().single();
  if (error) return { ok: false, error: "创建需求失败，请重试" };

  revalidatePath("/dashboard/requirements");
  return { ok: true, requirement: data as RequirementDraft };
}

/** 更新需求（标题/内容/优先级） */
export async function updateRequirement(
  id: string,
  input: Parameters<typeof validateRequirementInput>[0]
): Promise<RequirementActionResult> {
  const validation = validateRequirementInput(input);
  if (!validation.ok) return { ok: false, error: validation.error ?? "输入无效" };

  const supabase = await createSupabaseActionClient();
  const { data, error } = await supabase
    .from("requirement_drafts")
    .update({
      title: validation.value!.title,
      content: validation.value!.content,
      priority: validation.value!.priority,
      is_edited: true,
    })
    .eq("id", id).is("deleted_at", null).select().single();
  if (error || !data) return { ok: false, error: "更新需求失败" };

  revalidatePath("/dashboard/requirements");
  return { ok: true, requirement: data as RequirementDraft };
}

/** 状态流转（关键：校验合法性 + 埋点） */
export async function transitionRequirementLifecycle(
  id: string,
  to: RequirementLifecycle
): Promise<RequirementActionResult> {
  const supabase = await createSupabaseActionClient();
  const { data: current } = await supabase
    .from("requirement_drafts")
    .select("lifecycle, title")
    .eq("id", id).is("deleted_at", null).single();
  if (!current) return { ok: false, error: "需求不存在" };

  if (!canTransition(current.lifecycle as RequirementLifecycle, to)) {
    return { ok: false, error: `不允许从 ${current.lifecycle} 转为 ${to}` };
  }

  const { data, error } = await supabase
    .from("requirement_drafts")
    .update({ lifecycle: to, is_edited: true })
    .eq("id", id).select().single();
  if (error) return { ok: false, error: "状态更新失败" };

  // 埋点：北极星指标
  if (to === "confirmed") {
    void track("requirement_confirmed", { requirement_id: id, source: "manual" });
  }
  revalidatePath("/dashboard/requirements");
  revalidatePath(`/dashboard/requirements/${id}`);
  return { ok: true, requirement: data as RequirementDraft };
}

/** 软删除 */
export async function deleteRequirement(id: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createSupabaseActionClient();
  const { error } = await supabase
    .from("requirement_drafts")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id).is("deleted_at", null);
  if (error) return { ok: false, error: "删除失败" };
  revalidatePath("/dashboard/requirements");
  return { ok: true };
}
```

### 2.3 前端页面改动

#### 2.3.1 列表页 `src/app/dashboard/requirements/page.tsx`（重构）

**改动**：从只读卡片列表 → 带 CRUD 的管理页。

```typescript
// 关键改动点（基于现有 page.tsx）：
// 1. 顶部加"新建需求"按钮 + 筛选器（lifecycle / priority）
// 2. 卡片增加 lifecycle 标签 + priority 颜色 + 来源标签（已有 feedback_topic，扩展 meeting_item/manual）
// 3. 卡片右侧加"确认/搁置"快捷按钮（lifecycle 流转）
// 4. 新建/编辑用对话框（新建 RequirementsCreateDialog / RequirementsEditDialog 组件）
```

卡片改动示意（基于现有 L50-72）：
```tsx
<div className="flex items-center justify-between">
  <h3 className="font-medium">{d.title}</h3>
  <div className="flex items-center gap-2">
    {/* lifecycle 标签（新） */}
    <span className={lifecycleBadgeClass(d.lifecycle)}>
      {LIFECYCLE_LABELS[d.lifecycle]}
    </span>
    {/* 来源标签（扩展） */}
    {SOURCE_LABELS[d.source_type] && (
      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
        {SOURCE_LABELS[d.source_type]}
      </span>
    )}
  </div>
</div>
{/* priority 指示条（新） */}
<div className={`mt-1 h-0.5 ${priorityBarColor(d.priority)}`} />
```

#### 2.3.2 详情页 `src/app/dashboard/requirements/[requirementId]/page.tsx`（重构）

**改动**：从只读 Markdown 展示 → 可编辑 + 状态机 + 操作入口。

新增元素：
- **状态切换器**：lifecycle 下拉（draft→confirmed→in_progress→delivered / parked），调用 `transitionRequirementLifecycle`
- **优先级切换器**：priority 下拉，调用 `updateRequirement`
- **编辑模式**：标题 + content（Markdown textarea）切换编辑，仿 `MeetingItemCard` 的 editing 模式
- **"生成 API 草稿"按钮**（功能 1.3，见 §4）
- **来源追溯区**：显示 `source_type` 对应的源（反馈主题链接 / 会议条目链接）
- **关联接口区**（功能 1.5，见 §6）：列出 `api_drafts where source_requirement_id = this`

### 2.4 新增组件清单

```
src/components/dashboard/
├── requirements-create-dialog.tsx     # 新建需求对话框（仿 project-create-dialog.tsx）
├── requirements-edit-dialog.tsx       # 编辑需求（标题/content/priority）
├── requirements-filter-bar.tsx        # 筛选器（lifecycle/priority/source_type）
├── requirements-lifecycle-badge.tsx   # lifecycle 标签组件
└── requirements-confirm-button.tsx    # 详情页"确认纳入需求池"按钮
```

---

## 3. 功能 1.2：反馈→需求确认关卡（P0）

### 3.1 改动点：升级现有 `feedback-gen-requirement` EF + 前端按钮

**现状**：`supabase/functions/feedback-gen-requirement/index.ts` 生成需求时 `status='completed'`（直接完成态），前端按钮成功后直接跳详情页。

**改动**：
1. EF 写入时 `lifecycle='draft'`（草稿态，等人工确认）——这是本功能的**全部 DB 层改动**，零新增代码。
2. 前端 `generate-requirement-button.tsx` 成功跳转后，详情页提示"此需求为草稿，请确认后纳入需求池"。

### 3.2 埋点扩展

```typescript
// src/app/dashboard/feedback/[analysisId]/generate-requirement-button.tsx
// 在现有 track 基础上扩展：
void track("requirement_draft_generated", {
  source_type: "feedback_topic",
  topic_count: selected.size,
});
```

### 3.3 详情页确认关卡

需求详情页（§2.3.2）的"确认纳入需求池"按钮：
- 调 `transitionRequirementLifecycle(id, "confirmed")`
- `lifecycle='draft'` 时按钮高亮提示；`confirmed` 后隐藏或变为"重新打开"

---

## 4. 功能 1.3：需求→API 一键带入（P0）

### 4.1 入口设计

**两个入口**（覆盖不同场景）：

| 入口 | 位置 | 行为 |
|---|---|---|
| A | 需求详情页"生成 API 草稿"按钮 | 校验 `lifecycle='confirmed'`，跳转 API 设计器并预填 |
| B | API 设计器新建页"从需求选择"下拉 | 列出项目下 confirmed 需求，选中后预填 |

### 4.2 API 设计器新建页改动：`src/app/dashboard/api-designer/new/page.tsx`

**接受 query param 预填**：
```typescript
// 新建页读取 ?requirement_id=xxx
const searchParams = await props.searchParams;
const requirementId = searchParams.requirement_id as string | undefined;

// 如有 requirementId，查需求并预填 business_requirement + title
// 同时在创建 api_drafts 时写入 source_requirement_id
```

**"从需求选择"下拉**（入口 B）：
- 新建 `src/components/dashboard/api-designer/requirement-picker.tsx`
- 调 `listRequirements({ projectId, lifecycle: "confirmed" })` 列出可选需求
- 选中后填充表单

### 4.3 Server Action 改动：`src/app/dashboard/api-designer/actions.ts`

```typescript
// createApiDraft 增加可选参数 source_requirement_id
// 写入 api_drafts 时带上：
//   source_requirement_id: input.sourceRequirementId ?? null
// 埋点：
//   void track("requirement_to_api_triggered", {
//     requirement_id: input.sourceRequirementId,
//     draft_id: data.id,
//   });
```

### 4.4 校验

- 入口 A：需求 `lifecycle !== 'confirmed'` 时按钮置灰，tooltip "请先确认需求"
- API 设计器接受 `source_requirement_id` 时校验该需求属于当前项目且未删除（防越权）

---

## 5. 功能 1.4：会议→反馈一键转入（P1，MVP 版本）

### 5.1 MVP 策略（重要：不扩枚举）

**决策**：Phase 1 **不扩展 `meeting_item_category` 枚举**（避免重训 Prompt + 评测集）。MVP 复用现有 `issue`（遗留问题）和 `requirement`（需求）两类条目——这两类天然包含用户反馈信息。

**用户操作**：会议详情页，选中 `requirement` 或 `issue` 类条目 → 点"转入反馈模块" → 创建新的 feedback_analysis 参与聚类。

### 5.2 会议详情页按钮

**挂载点**：`src/components/dashboard/meeting-item-card.tsx` L122-137 的 hover 操作区，在"编辑/删除"旁加"转反馈"按钮。

```typescript
// src/components/dashboard/meeting-item-card.tsx
// 在 hover 操作区（L122）添加：
{item.category !== "decision" && item.category !== "todo" && (
  <ConvertToFeedbackButton meetingItem={item} />
)}
```

### 5.3 新组件：`src/components/dashboard/convert-to-feedback-button.tsx`

仿 `generate-requirement-button.tsx` 模式（弹窗 + 多选 + useTransition）：

```typescript
"use client";
// 弹窗内容：
// - 标题："将 N 条会议条目转入反馈模块"
// - 说明文案（缓解用户困惑，对应 PM 风险 R-2）：
//   "以下条目将进入反馈模块参与聚类，聚类后可能被合并/重命名，原会议条目保留不动。"
// - 勾选框（多选 requirement/issue 条目）
// - 确认按钮 → 调 server action
```

### 5.4 Server Action：`src/app/dashboard/meetings/actions.ts`（新增 action）

```typescript
/** 将会议条目转入反馈模块（创建新 analysis + 触发聚类） */
export async function transferMeetingItemsToFeedback(
  meetingId: string,
  itemIds: string[]
): Promise<MeetingToFeedbackResult> {
  const supabase = await createSupabaseActionClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "未登录" };

  // ① 取会议条目 + 会议标题（用于 source_label）
  const { data: meeting } = await supabase
    .from("meetings").select("id, title, project_id").eq("id", meetingId).single();
  if (!meeting) return { ok: false, error: "会议不存在" };

  const { data: items } = await supabase
    .from("meeting_items").select("id, content, category").in("id", itemIds);
  if (!items?.length) return { ok: false, error: "未选中有效条目" };

  // ② 防重复转入：已 transferred_to_feedback=true 的跳过
  const newItems = items.filter((it) => /* 查 transferred 标记 */);
  if (!newItems.length) return { ok: false, error: "所选条目已转入" };

  // ③ 创建 feedback_analysis（paste 模式，带 source_label）
  const { data: analysis, error } = await supabase
    .from("feedback_analyses").insert({
      user_id: user.id, project_id: meeting.project_id,
      input_mode: "paste",
      source_label: `来自会议《${meeting.title}》`,
      status: "analyzing",
      total_count: newItems.length,
    }).select().single();
  if (error) return { ok: false, error: "创建反馈分析失败" };

  // ④ 写 feedback_items（带来源追溯）
  await supabase.from("feedback_items").insert(
    newItems.map((it) => ({
      analysis_id: analysis.id,
      content: it.content,
      source_type: "meeting",
      source_meta: { meeting_id: meetingId, meeting_item_id: it.id },
    }))
  );

  // ⑤ 标记会议条目已转入（防重复）
  await supabase.from("meeting_items")
    .update({ transferred_to_feedback: true }).in("id", newItems.map((it) => it.id));

  // ⑥ 触发 feedback-analyze EF（复用现有聚类）
  // fetch ${publicEnv.supabaseUrl}/functions/v1/feedback-analyze
  //   body: { analysisId, items: newItems.map(content) }

  // ⑦ 埋点
  void track("meeting_feedback_transferred", {
    meeting_id: meetingId, item_count: newItems.length,
  });

  revalidatePath(`/dashboard/meetings/${meetingId}`);
  return { ok: true, analysisId: analysis.id };
}
```

### 5.5 feedback-analyze EF 改造（轻量）

现有 `feedback-analyze` EF 已支持 paste 模式（前端粘贴文本 split 成 items）。Phase 1 改造：
- 增加入参 `sourceItems?: { content: string; sourceMeta?: object }[]`（已预置 items 时跳过文本 split）
- items 写入时带 `source_type` 和 `source_meta`
- 聚类结果主题卡的 `sample_feedback` 保留来源信息（便于显示"含 N 条来自会议"）

### 5.6 已转入条目的可追溯角标

`meeting-item-card.tsx` 渲染时：
```tsx
{item.transferred_to_feedback && (
  <Link
    href={`/dashboard/feedback/${analysisIdOfItem}`}  // 需查 source_meta 获取
    className="mt-1 inline-block rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-600"
  >
    已转入反馈 →
  </Link>
)}
```

---

## 6. 功能 1.5：功能需求接口整理视图（P1，可后移）

### 6.1 视图位置

API 设计器列表页（`src/app/dashboard/api-designer/page.tsx`）增加"按需求分组"视图切换。

### 6.2 数据查询

```typescript
// 列表页查询：左联 requirement_drafts
const { data } = await supabase
  .from("api_drafts")
  .select(`
    id, title, origin, updated_at,
    source_requirement_id,
    requirement:requirement_drafts(id, title, lifecycle, priority)
  `)
  .eq("project_id", projectId);

// 前端纯函数分组（src/lib/api.ts 新增 groupApiDraftsByRequirement）
// - 有 source_requirement_id 的按需求分组
// - 无的归入"未归属"组
```

### 6.3 渲染

```
┌─ 需求：《用户登录优化》（已确认·高优）─────────────┐
│  • POST /api/auth/login          [manual]        │
│  • POST /api/auth/refresh        [ai_generated]  │
└──────────────────────────────────────────────────┘
┌─ 需求：《反馈主题：响应慢》（草稿·中优）──────────┐
│  • GET /api/performance/metrics  [ai_generated]  │
└──────────────────────────────────────────────────┘
┌─ 未归属 ─────────────────────────────────────────┐
│  • GET /api/users               [ai_generated]   │
└──────────────────────────────────────────────────┘
```

---

## 6.5 v1 遗留修复：K-1 / K-2 / K-3（上线前必修）

> 本节落实母文档 §4.4 中归入 Phase 1 的 v1 技术债。与主线功能并行，但必须在 Phase 1 上线前完成。

### 6.5.1 K-1：DB check 约束（空项目名）

已在 §1.1 007 迁移的 ⑦ 段落地：
```sql
alter table projects
  add constraint projects_name_not_blank check (length(btrim(name)) > 0);
```
**验证**：直接向 DB insert 空名项目应被拒（前端 v1 已拦截，DB 层兜底防绕过）。

### 6.5.2 K-2：PostHog key 配置

**现状**：`src/lib/analytics.ts` 埋点代码就位，但无 key 静默降级——v2 引入的北极星指标（`requirement_confirmed` 等）无法采集。

**落地**（非代码，配置动作）：
1. PostHog 注册项目，取 Project API key
2. Vercel 环境变量加 `NEXT_PUBLIC_POSTHOG_KEY=<key>`
3. Supabase EF 环境（如需服务端埋点）同步配置
4. 上线后验证：DevTools Network 看到 PostHog 请求 200

**关联**：v2 全部 6 个埋点指标（母文档 §6）依赖此项。

### 6.5.3 K-3：Google OAuth 配置 + CI 验证（D-2）

**现状**：v1 Google 登录按钮不可用（provider 未配置）；`.github/workflows/ci.yml` 已写但未验证触发（D-2）。

**落地步骤**：
1. **Google OAuth Provider 配置**（非代码）：
   - Google Cloud Console 创建 OAuth 2.0 客户端，Authorized redirect URI 填 `<supabase-url>/auth/v1/callback`
   - Supabase Dashboard → Authentication → Providers → Google，填 Client ID / Secret，启用
   - 验证：登录页点 Google 登录能跳转授权并回跳
2. **CI 验证（D-2）**：
   - `.github/workflows/ci.yml` 内容已核对完整（lint + typecheck + test + build）
   - Phase 1 首次 push 到 main 后，GitHub Actions 触发，确认 4 个 step 全绿
   - 如 CI 因环境变量缺失失败，补 Vercel/CI secrets（`NEXT_PUBLIC_SUPABASE_URL` 等占位已在 ci.yml 配置）

**注**：Google OAuth 与 CI 验证相互独立，可并行；CI 验证不依赖 OAuth 配置。

---

## 7. 类型定义更新：`src/types/database.ts`

新增/更新类型（保持与迁移同步）：

```typescript
export interface RequirementDraft {
  // ... v1 既有字段
  priority: PriorityLevel;
  lifecycle: RequirementLifecycle;
  source_meeting_item_id: string | null;
  deleted_at: string | null;
}

export type RequirementLifecycle =
  | "draft" | "confirmed" | "in_progress" | "delivered" | "parked";

export interface ApiDraft {
  // ... v1 既有字段
  origin?: ApiDraftOrigin;
  source_requirement_id: string | null;
}

export interface MeetingItem {
  // ... v1 既有字段
  transferred_to_feedback: boolean;
}

export interface FeedbackItem {
  // ... v1 既有字段
  source_type: string;
  source_meta: Record<string, unknown> | null;
}

export interface FeedbackAnalysis {
  // ... v1 既有字段
  source_label: string | null;
}
```

---

## 8. 测试计划

### 8.1 单元测试（Vitest，仿 `src/lib/__tests__/projects.test.ts`）

- `src/lib/__tests__/requirements.test.ts`（新）：
  - `validateRequirementInput`：空标题/超长标题/空内容/非法 priority/默认 lifecycle
  - `canTransition`：合法流转（draft→confirmed ✓）/非法流转（delivered→draft ✗）
  - `isDeleted` / `filterActive`（软删过滤）

### 8.2 集成测试（仿 `scripts/integration-check.mjs`）

新增 RLS + 数据流联调用例：
- 需求 CRUD 跨用户隔离（A 用户的 demand B 看不到）
- lifecycle 流转埋点落表
- 会议→反馈转入后，原条目 `transferred_to_feedback=true`，feedback_items 带 source_meta
- 需求→API 带入后，`api_drafts.source_requirement_id` 正确
- 软删：删除后列表不展示，但详情页直链 404 或显示"已删除"

### 8.3 AI 评测（Golden Set，仿 `tests/eval/`）

Phase 1 MVP 不改 Prompt（不扩枚举），**无需新增评测样例**。如后续 1.4 正式化（扩 `user_feedback` 枚举），需在 `tests/eval/` 补 meeting-extract 的五类输出样例。

### 8.4 验收标准对齐（Given-When-Then）

完整 AC 见 PM 补充材料 §2。技术实现须保证可验证：

| AC | 验证方式 |
|---|---|
| AC-1.1 会议转入 | 转入后查 feedback_analyses 有新记录 + source_label 含会议标题；二次点击提示已转入 |
| AC-1.2 确认关卡 | 生成需求默认 lifecycle='draft'，需点"确认"才变 confirmed |
| AC-1.3 需求 CRUD | 列表支持创建/编辑/删除/筛选；软删后不显示 |
| AC-1.4 需求→API | confirmed 需求点"生成 API"跳转并预填；api_drafts.source_requirement_id 有值 |
| AC-1.5 接口整理视图 | API 设计器按需求分组渲染；无关联需求归"未归属" |

---

## 9. 实施顺序与依赖

```
Week 1
├─ D1-2: 007/008 迁移（含 K-1 DB check）+ types 更新 + src/lib/requirements.ts(含单测)
├─ D3-4: 功能 1.1 需求 CRUD actions + 列表页重构 + 详情页重构
└─ D5:   功能 1.2 确认关卡（EF 写入改 lifecycle='draft' + 详情页按钮）

Week 2
├─ D6-7: 功能 1.3 需求→API 带入（两入口 + action 改造）
├─ D8-9: 功能 1.4 会议→反馈转入 MVP（convert-to-feedback-button + action + EF 改造）
├─ D10:  功能 1.5 接口整理视图（若资源足；否则移 Phase 2）+ 集成测试 + 联调
└─ 上线前（v1 遗留修复，§6.5）:
    ├─ K-1 DB check（已在 007 迁移，验证生效）
    ├─ K-2 PostHog key 配置 + 埋点验证
    ├─ K-3 Google OAuth provider 配置 + 登录验证
    ├─ D-2 CI 触发验证（首次 push 后确认 GitHub Actions 全绿）
    ├─ K-5 Vercel 部署确认
    └─ 灰度开关白名单配置
```

**依赖关系**：
- 1.2 依赖 1.1（确认关卡需要 lifecycle 字段）
- 1.3 依赖 1.1（API 带入需要 confirmed 状态）
- 1.4 独立（可并行），但依赖 008 迁移
- 1.5 依赖 1.3（需要 source_requirement_id 数据）
- K-1 与 007 迁移同批（同一 SQL）
- K-2/K-3 相互独立，可与 D6-D10 并行（不阻塞主线代码）

---

## 10. Phase 1 完成定义（DoD）

**主线功能**：
- [ ] 007/008 迁移在 Supabase 执行成功，老数据回填 lifecycle='draft'
- [ ] `src/lib/requirements.ts` + 单测通过
- [ ] 需求模块 CRUD 全流程可用（创建/编辑/删除/改优先级/改状态/筛选）
- [ ] 反馈生成需求默认 draft，需确认才变 confirmed
- [ ] 需求→API 一键带入两入口可用
- [ ] 会议→反馈转入 MVP 可用（issue/requirement 条目）
- [ ] 埋点事件（requirement_confirmed / requirement_draft_generated / requirement_to_api_triggered / meeting_feedback_transferred）正确触发

**v1 遗留修复**：
- [ ] K-1 DB check 生效（绕过前端建空名项目被拒）
- [ ] K-2 PostHog key 配置，DevTools 验证埋点请求上报
- [ ] K-3 Google OAuth 可登录 + D-2 CI 首次触发全绿
- [ ] K-5 Vercel 部署为最新

**质量门禁**：
- [ ] typecheck 0 错误 + 单测全通过 + 集成测试通过
- [ ] 功能开关灰度配置就绪
