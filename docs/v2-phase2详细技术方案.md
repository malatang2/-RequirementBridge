# v2 Phase 2 详细技术方案：模块做厚 + 配置化 + 平台增强

> 版本：v2.0-P2-draft | 日期：2026-08-01
> 母文档：`docs/v2统一技术方案.md`（数据模型变更、模块边界、迁移策略以母文档为准）
> 目标：在 Phase 1 主线贯通后，把各模块做厚（反馈批量导入、自定义 API、模板库）+ 引入用户配置页 + **补齐 v1 遗留的平台增强（Landing/Dark/用量看板/大音频）+ 偿还技术债**。
> 预计工期：3-3.5 周（含 v1 技术债纳入）。本方案承接母文档 §4 技术债清理、§5 扩展机制设计，并落实 `docs/v1版本总结与技术债.md` 中明确归入 v2 的全部遗留项。

---

## 0. Phase 2 范围

本 Phase 共 14 项，分三类：**模块做厚**（v2 新能力）、**平台增强**（v1 遗留 K-4/K-6/K-7/K-8）、**技术债清理**（TD-2/TD-4/TD-5 + 统一化）。

| # | 功能 | 类别 | 优先级 | 价值 | 来源 |
|---|---|---|---|---|---|
| 2.1 | 反馈批量导入 CSV/Excel | 模块做厚 | P0 | 解决"几千条反馈靠粘贴"的痛点 | v2 新增 |
| 2.2 | 反馈文件上传扩容 | 模块做厚 | P1 | 大体量反馈支持 | v2 新增 |
| 2.3 | 自定义/手工 API 管理 | 模块做厚 | P0 | 覆盖"先有接口再补文档"场景 | v2 新增 |
| 2.4 | API 模板库 | 模块做厚 | P1 | 降低 AI 生成不一致 | v2 新增 |
| 2.5 | 用户配置页（模型/Key/Provider） | 模块做厚 | P0 | B 端刚需，解锁私有化 | v2 新增 |
| 2.6 | meeting_item_category 扩展 user_feedback | 模块做厚 | P1 | Phase 1 MVP 的正式化 | v2 新增 |
| 2.7 | LLM 调用统一 + gen types + 文档约定 | 技术债 | P0 | 债不滚大 | v2 新增 |
| **2.8** | **大音频断点续查强化** | 平台增强 | P1 | 防 EF 150s 超时丢任务 | **v1 K-4** |
| **2.9** | **Landing Page 完整化** | 平台增强 | P1 | 首屏/获客 | **v1 K-6** |
| **2.10** | **用量看板（llm_usage 可视化）** | 平台增强 | P1 | 成本可见 | **v1 K-8** |
| **2.11** | **Dark 模式切换** | 平台增强 | P2 | 体验补齐 | **v1 K-7** |
| **2.12** | **转录→提取共享函数重构** | 技术债 | P1 | 减少网络跳 | **v1 TD-2** |
| **2.13** | **反馈聚类批量 update 优化** | 技术债 | P2 | 量大性能 | **v1 TD-4** |
| **2.14** | **Edge Function 单测** | 技术债 | P1 | EF 可测性 | **v1 TD-5** |

---

## 1. 数据模型变更（迁移文件）

### 1.1 `supabase/migrations/009_v2_api_origin.sql`

```sql
-- ============================================================
-- 009_v2_api_origin.sql
-- v2 Phase 2：API 草稿来源 + 自定义管理 + 模板库
-- ============================================================

-- ① API 草稿来源枚举
create type api_draft_origin as enum ('ai_generated', 'manual', 'imported');

-- ② api_drafts 加 origin（Phase 1 已加 source_requirement_id）
alter table api_drafts
  add column origin api_draft_origin not null default 'ai_generated';

-- ③ API 模板库（项目级，可跨草稿复用）
create table api_templates (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  project_id  uuid not null references projects(id) on delete cascade,
  name        text not null,
  description text,
  yaml_snippet text not null,            -- OpenAPI 片段（如鉴权 schema、分页参数）
  category    text not null default 'custom',  -- auth | pagination | error | crud | custom
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (length(btrim(name)) > 0),
  check (length(btrim(yaml_snippet)) > 0)
);

create index idx_api_templates_project on api_templates(project_id, category);

-- ④ 触发器：updated_at（复用 fn_set_updated_at）
create trigger trg_api_templates_set_updated_at
  before update on api_templates
  for each row execute function fn_set_updated_at();

-- ⑤ RLS（统一模板）
create policy "api_templates_select_own" on api_templates for select using (user_id = auth.uid());
create policy "api_templates_insert_own" on api_templates for insert with check (user_id = auth.uid());
create policy "api_templates_update_own" on api_templates for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "api_templates_delete_own" on api_templates for delete using (user_id = auth.uid());
```

### 1.2 `supabase/migrations/010_v2_user_llm_config.sql`

```sql
-- ============================================================
-- 010_v2_user_llm_config.sql
-- v2 Phase 2：用户级 LLM 配置（模型/Key/Provider）+ 用量快照
-- ============================================================

-- ① profiles 加 llm_config（加密 Key 存这里）
alter table profiles add column llm_config jsonb not null default '{}'::jsonb;
-- llm_config 结构（应用层加密 apiKey）：
-- {
--   "provider": "dashscope" | "openai" | "custom",
--   "apiKeyEnc": "enc:aes-256:xxxx",        -- 应用层加密，UI 只显示后4位
--   "modelOverrides": { "extract": "qwen-max", "draft": "qwen-plus" },
--   "baseUrl": "https://..."
-- }
comment on column profiles.llm_config is '用户级 LLM 配置；apiKey 应用层 AES 加密，service_role 才能解密';

-- ② 用量看板（2.10）：按日聚合的用量快照表（避免每次实时聚合 jsonb）
--    注：明细仍在各表 llm_usage jsonb 留痕；本表是看板的预聚合加速
create table usage_daily (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  project_id    uuid references projects(id) on delete cascade,
  day           date not null,                       -- 自然日（用户本地时区，应用层写入）
  module        text not null,                       -- meeting | api | feedback | asr
  model         text,                                -- qwen-max | qwen-plus | paraformer-v2 ...
  call_count    integer not null default 0,
  input_tokens  integer not null default 0,
  output_tokens integer not null default 0,
  asr_seconds   integer not null default 0,          -- 语音转写秒数（仅 asr 行）
  created_at    timestamptz not null default now(),
  unique (user_id, project_id, day, module, model)
);
create index idx_usage_daily_user_day on usage_daily(user_id, day desc);

-- 触发器：每次 meetings/feedback_analyses/api_drafts 完成时，增量累加当日用量
-- （用 plpgsql 函数解析 llm_usage jsonb 后 upsert 到 usage_daily）
create or replace function fn_accumulate_usage()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  m text; mod text; tok int; secs int; pid uuid; uid uuid; d date;
begin
  uid := coalesce(new.user_id, old.user_id);
  pid := coalesce(new.project_id, old.project_id);
  d := (now() at time zone 'Asia/Shanghai')::date;
  -- 会议：llm_usage 含 {asr:{seconds}, llm:{model,tokens}}
  if tg_table_name = 'meetings' and new.status = 'completed' then
    if new.llm_usage ? 'asr' then
      secs := coalesce((new.llm_usage->'asr'->>'seconds')::int, 0);
      insert into usage_daily(user_id,project_id,day,module,model,asr_seconds)
      values(uid,pid,d,'asr','paraformer-v2',secs)
      on conflict (user_id,project_id,day,module,model)
      do update set asr_seconds = usage_daily.asr_seconds + excluded.asr_seconds;
    end if;
    if new.llm_usage ? 'llm' then
      mod := new.llm_usage->'llm'->>'model'; tok := coalesce((new.llm_usage->'llm'->>'tokens')::int,0);
      insert into usage_daily(user_id,project_id,day,module,model,output_tokens)
      values(uid,pid,d,'meeting',mod,tok)
      on conflict (user_id,project_id,day,module,model)
      do update set output_tokens = usage_daily.output_tokens + excluded.output_tokens, call_count = usage_daily.call_count + 1;
    end if;
  end if;
  -- api / feedback 类似（略，按各自 llm_usage 结构）
  return coalesce(new, old);
end; $$;
-- 挂载到三张主表 after update（status 变 completed 时触发）
create trigger trg_meetings_usage after update of status on meetings
  for each row when (new.status = 'completed' and old.status <> 'completed')
  execute function fn_accumulate_usage();

create policy "usage_daily_select_own" on usage_daily for select using (user_id = auth.uid());
-- insert/update 由触发器（security definer）完成，不对客户端开放 insert/update policy

-- ③ system_api_templates（系统预置模板，跨用户共享）
--    决策：系统模板硬编码在 src/lib/api-templates.ts（常量），用户自定义模板存 api_templates 表。
--    （避免 system 行的 user_id 归属问题，保持全表 user_id = auth.uid() 的 RLS 纯净）
```

### 1.3 meeting_item_category 扩展（功能 2.6）

```sql
-- 在 009 或单独迁移中：
alter type meeting_item_category add value if not exists 'user_feedback';
-- ⚠️ 注意：alter type add value 不能在事务内执行（Supabase 迁移默认每文件一事务）
-- 如报错，拆为独立迁移并加 begin; ... commit; 手动控制（或用 supabase 的 raw 执行）
```

---

## 2. 功能 2.1：反馈批量导入 CSV/Excel（P0）

### 2.1 解析层：`src/lib/feedback-import.ts`（新建，纯函数）

```typescript
// src/lib/feedback-import.ts

/** CSV 解析（支持引号包裹、换行） */
export function parseCsv(text: string): string[][] { /* ... */ }

/** Excel 解析（用 xlsx 库，需装 npm i xlsx） */
export async function parseExcel(file: File): Promise<string[][]> { /* ... */ }

export interface FeedbackImportRow {
  content: string;
  channel?: string;       // 反馈渠道（选填）
  timestamp?: string;     // 反馈时间（选填）
}

export type ImportValidation =
  | { ok: true; rows: FeedbackImportRow[]; skipped: number; headers: string[] }
  | { ok: false; error: string };

/** 列映射 + 校验（纯函数 seam） */
export function mapAndValidate(
  matrix: string[][],
  columnMapping: { content: number; channel?: number; timestamp?: number }
): ImportValidation {
  // 跳过空行、去重、上限校验（沿用 validateFeedbackInput 的 2000 条上限）
  // 返回 { ok: true, rows, skipped, headers }
}
```

### 2.2 前端：`src/app/dashboard/feedback/new/page.tsx`（扩展）

新增"批量导入"tab：
1. **上传文件**（CSV/Excel）→ 解析预览前 10 行
2. **列映射**：用户指定哪列是"反馈内容"（必选）、哪列是"渠道"/"时间"（可选）
3. **确认导入**：调 server action，创建 feedback_analysis + 批量写 feedback_items
4. **触发聚类**：复用 feedback-analyze EF（`source_type='batch_import'`）

### 2.3 Server Action

```typescript
// src/app/dashboard/feedback/actions.ts 新增：
export async function importFeedbackBatch(
  projectId: string,
  rows: FeedbackImportRow[]
): Promise<FeedbackActionResult> {
  // 校验 + 创建 feedback_analyses(input_mode='file', source_label='批量导入')
  // 批量 insert feedback_items（source_type='batch_import', source_meta: {row, channel}）
  // 触发 feedback-analyze EF
}
```

### 2.4 容量与性能

- 单次导入上限 **2000 条**（沿用 v1 `validateFeedbackInput` 上限）
- 批量 insert 用 `supabase.from('feedback_items').insert(batch)`，分片 500/次防超长
- 大文件解析在前端 Web Worker（xlsx 解析阻塞 UI）

---

## 3. 功能 2.3：自定义/手工 API 管理（P0）

### 3.1 入口

API 设计器列表页加"新建空白草稿"按钮（区别于现有的"从业务需求生成"）。

### 3.2 新建空白草稿

```typescript
// src/app/dashboard/api-designer/actions.ts 新增：
export async function createBlankApiDraft(
  projectId: string,
  input: { title: string; initialYaml?: string }
): Promise<ApiDraftActionResult> {
  // 创建 api_drafts（origin='manual'）
  // initialYaml 可选：粘贴导入时用；空则预置最小 OpenAPI 骨架
  const skeletonYaml = `openapi: 3.0.0\ninfo:\n  title: ${input.title}\n  version: "1.0.0"\npaths: {}\n`;
}
```

### 3.3 YAML 粘贴导入

新建页加"粘贴 OpenAPI"tab：
- textarea 接受 YAML/JSON
- 实时校验（复用 v1 `validateOpenApiYaml` 纯函数，`src/lib/api.ts`）
- 通过校验后创建 `origin='imported'` 的草稿

### 3.4 UI 区分来源

API 草稿列表卡片显示 origin 标签：
- `ai_generated` → 🤖 AI 生成
- `manual` → ✍️ 手动创建
- `imported` → 📥 导入

---

## 4. 功能 2.4：API 模板库（P1）

### 4.1 系统模板（应用层常量）

```typescript
// src/lib/api-templates.ts
export const SYSTEM_TEMPLATES = [
  {
    id: "sys-auth-bearer",
    name: "Bearer Token 鉴权",
    category: "auth",
    description: "标准化 Bearer Token 鉴权 schema",
    yamlSnippet: `components:\n  securitySchemes:\n    bearerAuth:\n      type: http\n      scheme: bearer\nsecurity:\n  - bearerAuth: []`,
  },
  {
    id: "sys-pagination-cursor",
    name: "游标分页参数",
    category: "pagination",
    description: "cursor-based 分页查询参数",
    yamlSnippet: `parameters:\n  - name: cursor\n    in: query\n    schema: { type: string }\n  - name: limit\n    in: query\n    schema: { type: integer, default: 20 }`,
  },
  {
    id: "sys-error-standard",
    name: "标准错误响应",
    category: "error",
    description: "400/401/404/500 统一错误格式",
    yamlSnippet: `components:\n  responses:\n    BadRequest: { description: 参数错误, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }\n    Unauthorized: { description: 未授权 }\n    NotFound: { description: 资源不存在 }\n    ServerError: { description: 服务器错误 }\n  schemas:\n    Error:\n      type: object\n      properties:\n        code: { type: string }\n        message: { type: string }`,
  },
] as const;
```

### 4.2 用户自定义模板

CRUD on `api_templates` 表（仿 projects 模式）：
- `src/lib/api-templates.ts`：纯函数 + 校验
- `src/app/dashboard/api-designer/templates/`：模板管理页（列表/新建/编辑/删除）

### 4.3 AI 生成时引用模板

`api-generate` EF 的 prompt 增强：
```
参考以下团队规范片段（如适用）：
{用户勾选的模板 yamlSnippet 合并}

请基于业务需求生成 OpenAPI 3.0，并融入上述规范片段。
```

前端 `new/page.tsx` 加模板多选勾选框（系统 + 用户自定义合并展示），勾选后传入 EF。

---

## 5. 功能 2.5：用户配置页（P0）

### 5.1 路由：`src/app/dashboard/settings/page.tsx`（新建）

侧栏 `sidebar.tsx` 加"设置"入口（底部，gear icon）。

### 5.2 配置项

```
设置
├─ 模型配置
│  ├─ Provider 选择：[DashScope ▾]（默认）/ OpenAI / 自定义
│  ├─ API Key：[sk-****1234] [更新] [测试连接]    ← 加密存储，UI 脱敏
│  ├─ Base URL：[https://...]（自定义端点，私有化用）
│  └─ 模型映射（高级，折叠默认收起）：
│     - 提取/生成 → [qwen-max ▾]
│     - 聚类/草稿 → [qwen-plus ▾]
├─ 外观（2.11 Dark 模式入口也放这里，或放 header）
│  └─ 主题：[浅色 / 深色 / 跟随系统]
├─ 账户
│  ├─ 邮箱、登出
│  └─ Google OAuth（如已配置）
└─ 关于
   └─ 版本号、文档链接
```

### 5.3 Key 加密存储

```typescript
// src/lib/crypto.ts（新建）
// AES-256-GCM 加密，密钥来自环境变量 LLM_CONFIG_ENCRYPTION_KEY（32字节）

export function encryptApiKey(plaintext: string): string {
  // 返回 "enc:aes-256:<iv>:<ciphertext>"
}

export function decryptApiKey(encrypted: string): string {
  // 解密；失败返回空串
}

export function maskApiKey(key: string): string {
  // "sk-abcd...1234"
  return key.length > 8 ? `${key.slice(0, 6)}...${key.slice(-4)}` : "****";
}
```

**环境变量**：`.env.local` 加 `LLM_CONFIG_ENCRYPTION_KEY=<32字节随机串>`；`src/lib/env.ts` 加 `get llmConfigEncryptionKey()`。

### 5.4 Server Actions：`src/app/dashboard/settings/actions.ts`

```typescript
"use server";
export async function saveLlmConfig(input: {
  provider?: string;
  apiKey?: string;        // 明文，service 层加密后存
  baseUrl?: string;
  modelOverrides?: Record<string, string>;
}): Promise<SettingsActionResult> {
  // ① 校验
  // ② apiKey 加密
  // ③ 写 profiles.llm_config
  // ④ 不返回明文 apiKey
}

export async function testLlmConnection(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
  // 用当前配置发一个最小请求，验证连通性
}

export async function getLlmConfigMasked(): Promise<MaskedConfig> {
  // 读 profiles.llm_config，apiKey 用 maskApiKey 脱敏后返回
}
```

### 5.5 LLM 调用链改造（结合技术债清理 §8）

详见 §8.1。核心：EF 和 server action 读 LLM 配置时，优先用用户 `profiles.llm_config`，否则 fallback 到环境变量。

---

## 6. 功能 2.6：meeting_item_category 扩展 user_feedback（P1）

### 6.1 Prompt 改造（meeting-extract EF）

现有 prompt 提取四类（decision/todo/requirement/issue）。改为五类：

```
请将会议内容结构化为以下五类条目：
- decision：明确达成的决策
- todo：分配给具体人的待办事项
- requirement：提到的产品/技术需求
- issue：遗留问题、风险、阻塞点
- user_feedback：转述的用户反馈、用户原话、用户痛点（新增）
```

### 6.2 评测集补充

`tests/eval/meeting-extract/` 新增样例，验证：
- 用户原话被正确归为 `user_feedback` 而非 `requirement`
- 五类输出格式稳定

### 6.3 前端适配

- `src/lib/meetings.ts` 的 `CATEGORY_LABELS` / `CATEGORY_ORDER` 加 `user_feedback`
- `meeting-item-card.tsx` 的类目下拉加选项
- `ConvertToFeedbackButton`（Phase 1 MVP）改为对 `user_feedback` 类目默认选中（不再依赖 issue 标记）

---

## 7. 平台增强功能（v1 遗留 K-4/K-6/K-7/K-8）

> 本节落实 `docs/v1版本总结与技术债.md` §3 明确归入 v2 的平台级遗留项。

### 7.1 功能 2.8：大音频断点续查强化（K-4，P1）

**问题**：Edge Function 单次执行 150s 上限，接近上限的音频可能超时（v1 已有 `asr_task_id` 断点续查降级，但前端在 EF 失败后可能放弃）。

**强化方案**：

1. **EF 失败不等于任务失败**：`meeting-transcribe` EF 若因 150s 超时，但已拿到 Paraformer `asr_task_id`，则把 `meetings.status` 置为 `transcribing`（而非 `failed`），保留 `asr_task_id`。
2. **前端轮询增强**：`src/hooks/use-task-status.ts` 增加"EF 失败但 asr_task_id 存在"的分支——不再依赖 EF 续跑，改为前端定期调一个新的轻量 EF `meeting-asr-poll`，用 asr_task_id 主动查 Paraformer 任务状态。
3. **新增 `meeting-asr-poll` EF**（轻量，<5s）：
   ```typescript
   // supabase/functions/meeting-asr-poll/index.ts
   // 入参：{ meetingId }
   // 查 meetings.asr_task_id → 调 DashScope 查询任务状态
   //   - SUCCEEDED → 取 transcription_url → 调 meeting-extract
   //   - RUNNING → 返回 { status: 'transcribing' }，前端继续轮询
   //   - FAILED → 落 meetings.status='failed'
   ```
4. **僵尸态兜底**：asr_task_id 存在但超过 30 分钟仍 RUNNING 的，落 failed 并提示用户"转写超时，请重试或改用文本输入"。

**工作量**：1 天。

### 7.2 功能 2.9：Landing Page 完整化（K-6，P1）

**问题**：`src/app/page.tsx` 是占位（仅标题+按钮，有 TODO 指向 `docs/UI线框稿.md §2`）。

**实现**：按 UI 线框稿补完整首屏：
- **Hero 区**：产品价值主张（"会议决策 → 结构化需求 → 可执行 API"）+ CTA 按钮（登录/进入工作台）
- **三模块演示区**：会议/反馈/API 三栏卡片，每栏一句话价值 + 缩略示意图
- **价值锚点区**：解决"会议决策不落地、反馈难聚类、需求转接口靠反复对齐"三痛点
- **流程图区**：黄金路径可视化（会议/反馈 → 需求 → API → 外发）
- **Footer**：链接（GitHub/文档/关于）

**实现方式**：Server Component（静态，无需交互），复用 shadcn/ui 组件。内容从 `docs/需求说明清单.md §1` 产品定位提炼。

**工作量**：1 天。

### 7.3 功能 2.10：用量看板（K-8，P1）

**问题**：`llm_usage` 已在 meetings/feedback_analyses/api_drafts 留痕（jsonb），但无可视化。引入用户配置页（2.5）后，用户需看到"自己 Key 的消耗"。

**实现**：`/dashboard/usage` 页面，读 §1.2 新增的 `usage_daily` 预聚合表。

```typescript
// src/app/dashboard/usage/page.tsx
// 查询：select * from usage_daily where user_id = ? and day >= now()-30 order by day desc
// 可视化（复用 recharts，与反馈模块同栈）：
//   - 30 天用量趋势折线图（tokens 按日）
//   - 按模块占比饼图（meeting/api/feedback/asr）
//   - 按模型占比（qwen-max vs qwen-plus）
//   - 累计统计卡：总 tokens / 总调用数 / 总 ASR 秒数
```

**数据来源**：`usage_daily` 表由 §1.2 的 `fn_accumulate_usage` 触发器自动累加（每次 AI 任务完成时增量写入），看板只读不写。

**工作量**：1 天（含触发器调试）。

### 7.4 功能 2.11：Dark 模式切换（K-7，P2）

**问题**：`tailwind.config.ts` 已定义 CSS 变量（深浅两套），但无切换入口。

**实现**：
- 新建 `src/components/dashboard/theme-toggle.tsx`（"use client"）：sun/moon icon 按钮
- 持久化：`localStorage`（避免 FOUC，在 `<html>` 加 inline script 读 localStorage 设 class）
- 挂载点：header 右侧（用户信息旁）+ 设置页"外观"区（§5.2）
- 三态：浅色 / 深色 / 跟随系统（`prefers-color-scheme`）

**工作量**：0.5 天。

---

## 8. 技术债清理

### 8.1 LLM 调用入口统一（功能 2.7，P0）

**现状问题**（母文档 §4.1）：
- 前端 `provider.ts` + `dashscope.ts` 的 `LLMProvider` 抽象未被使用
- EF 内 `_shared/supabase.ts` 的 `dashscopeChat` 是实际在用的
- `MODEL_BY_PURPOSE` 三处重复

**清理方案**：

```
统一为单一来源：
supabase/functions/_shared/
├── model-config.ts       # MODEL_BY_PURPOSE 唯一定义（EF import）
└── supabase.ts           # dashscopeChat（读用户 llm_config 覆盖默认）

src/lib/llm/
├── provider.ts           # LLMProvider 接口（保持，供 server action 用）
├── dashscope.ts          # DashScopeProvider 实现（读用户 llm_config）
└── model-config.ts       # 与 _shared/model-config.ts 同步（或用共享包）
```

**关键改动**：
1. `dashscopeChat`（EF）增加可选参数 `userLlmConfig?`，覆盖 `modelByPurpose`
2. EF 入口先查 `profiles.llm_config`（service_role），解密 apiKey，传入 `dashscopeChat`
3. 前端 `getLLMProvider()` 在用户配置存在时返回带用户配置的 `DashScopeProvider`，否则默认
4. 消除各 EF 本地的 modelByPurpose 重复定义

```typescript
// supabase/functions/_shared/model-config.ts（新建，唯一定义）
export const DEFAULT_MODEL_BY_PURPOSE = {
  extract: "qwen-max", openapi: "qwen-max",
  cluster: "qwen-plus", draft: "qwen-plus",
} as const;

export function resolveModel(purpose: string, userOverrides?: Record<string, string>): string {
  return userOverrides?.[purpose] ?? DEFAULT_MODEL_BY_PURPOSE[purpose] ?? "qwen-plus";
}
```

### 8.2 数据库类型生成

```bash
# 接入 supabase gen types
npx supabase login
npx supabase gen types typescript --project-id <ref> > src/types/database.ts
```

- 在 `package.json` 加 script：`"gen:types": "supabase gen types typescript --project-id $SUPABASE_REF > src/types/database.ts"`
- CI 里迁移后自动跑（保证类型与 schema 同步）
- 移除 `src/types/database.ts` 的手写占位注释

### 8.3 文档约定对齐

- 建立 `CONTEXT.md`（仓库根）：沉淀 v2 架构总览 + 模块边界图（从母文档 §1 提炼）
- 建立 `docs/adr/`：
  - `0001-llm-provider-abstraction.md`（CP0 决议，从需求清单 §9 迁移）
  - `0002-meeting-feedback-via-cluster.md`（v2 决策：会议反馈走聚类中转）
  - `0003-propose-approve-execute.md`（v2 决策：AI 执行三段式）
  - `0004-user-llm-config.md`（v2 决策：用户级 LLM 配置加密）

### 8.4 功能 2.12：转录→提取共享函数重构（TD-2，P1）

**问题**：`meeting-transcribe` EF 内用 `fetch` 调用自己的 `meeting-extract` EF，多一跳网络。

**重构**：
- 把 `meeting-extract/index.ts` 的核心逻辑抽到 `_shared/meeting-extract-logic.ts`（纯函数：输入 text → 输出 items/summary/llm_usage）
- `meeting-extract` EF 变为薄壳（参数校验 + 调共享逻辑 + 写库）
- `meeting-transcribe` EF 转录完成后**直接 import 共享逻辑**（同进程调用），不再 fetch
- `meeting-asr-poll` EF（§7.1 新增）也复用此共享逻辑

**收益**：减少一次跨 EF 网络往返（约省 100-300ms）；逻辑单一来源。

**工作量**：0.5 天。

### 8.5 功能 2.13：反馈聚类批量 update 优化（TD-4，P2）

**问题**：`feedback-analyze` EF 主题回填时逐条 `update feedback_items set topic_id=...`，N 条反馈 N 次请求，量大时慢。

**优化**：按 topic_id 分组批量 update：
```typescript
// 优化前：items.forEach(it => supabase.from('feedback_items').update({topic_id}).eq('id', it.id))
// 优化后：
for (const [topicId, itemIds] of Object.entries(groupedByTopic)) {
  await supabase.from('feedback_items').update({ topic_id: topicId }).in("id", itemIds);
}
// 请求数从 N 降到 主题数（通常 5-15）
```

**注意**：`fn_sync_topic_frequency` 触发器对批量 update 仍按行触发（frequency 正确性不受影响，只是触发次数不变；如需进一步优化可改 statement-level 触发器，但 v2 不必）。

**工作量**：0.5 天。

### 8.6 功能 2.14：Edge Function 单测（TD-5，P1）

**问题**：EF 是 Deno 代码，未纳入 Vitest（v1 仅前端纯函数有单测）。

**实现**：
- 用 `deno test`（Deno 原生测试框架）为每个 EF 写单测
- 重点覆盖**纯逻辑部分**（从 EF 抽出的共享函数），不测 fetch/supabase 等副作用（那些靠集成测试）
- 优先级：
  1. `meeting-extract-logic.ts`（§8.4 抽出后，测试 prompt 拼装 + JSON 解析容错）
  2. `feedback-analyze` 的聚类结果解析逻辑
  3. `api-generate` 的 OpenAPI 校验逻辑（配合 TD-3 swagger-parser，见下）
- CI 加 `deno test` 步骤（`.github/workflows/ci.yml` 扩展）

**TD-3（swagger-parser）联动**：v1 建议"加 swagger-parser 权威校验"。Deno 环境可用 `https://esm.sh/@apidevtools/swagger-parser`，在 `api-generate` EF 内做服务端权威校验（替代 v1 的轻量正则）。作为 2.14 单测的验证对象。

**工作量**：1 天。

---

## 9. 类型定义更新

```typescript
// src/types/database.ts 新增
export interface ApiDraft {
  // ... v1 + Phase 1 字段
  origin: ApiDraftOrigin;
}

export type ApiDraftOrigin = "ai_generated" | "manual" | "imported";

export interface ApiTemplate {
  id: string;
  user_id: string;
  project_id: string;
  name: string;
  description: string | null;
  yaml_snippet: string;
  category: string;
  created_at: string;
  updated_at: string;
}

export interface Profile {
  // ... v1 字段
  llm_config: UserLlmConfig | null;
  feature_flags: Record<string, boolean>;
}

export interface UserLlmConfig {
  provider: "dashscope" | "openai" | "custom";
  apiKeyEnc?: string;
  modelOverrides?: Record<string, string>;
  baseUrl?: string;
}

// 功能 2.10：用量看板
export interface UsageDaily {
  id: string;
  user_id: string;
  project_id: string | null;
  day: string;             // ISO date
  module: "meeting" | "api" | "feedback" | "asr";
  model: string | null;
  call_count: number;
  input_tokens: number;
  output_tokens: number;
  asr_seconds: number;
  created_at: string;
}
```

---

## 10. 测试计划

### 10.1 单元测试

- `src/lib/__tests__/feedback-import.test.ts`：CSV/Excel 解析、列映射、去重、上限
- `src/lib/__tests__/crypto.test.ts`：加密/解密/脱敏（往返一致性）
- `src/lib/__tests__/api-templates.test.ts`：系统模板格式校验
- `src/lib/__tests__/usage.test.ts`（新，2.10）：用量聚合纯函数（按日/按模块分组）

### 10.2 Edge Function 单测（2.14，新）

- `supabase/functions/meeting-extract-logic_test.ts`：prompt 拼装 + JSON 容错（Deno test）
- `supabase/functions/api-generate_test.ts`：swagger-parser 校验各类非法 YAML

### 10.3 集成测试

- 批量导入：CSV → feedback_items 落表 + 聚类触发
- 自定义 API：空白草稿创建 + YAML 粘贴导入校验
- 用户配置：Key 加密存储 + 读取脱敏 + 测试连接
- 模板引用：AI 生成时模板片段融入 prompt（评测集验证）
- **用量看板（2.10）**：AI 任务完成后 `usage_daily` 正确累加；看板查询返回正确聚合
- **大音频续查（2.8）**：模拟 EF 超时 + asr_task_id 存在 → 前端轮询 `meeting-asr-poll` → 最终 completed
- **转录提取共享函数（2.12）**：重构后 meeting-transcribe 不再 fetch extract EF，结果一致

### 10.4 安全测试（重点）

- **Key 泄露防护**：
  - 查 profiles 的 server action 不返回明文 apiKey（用 maskApiKey）
  - RLS 确保用户只能读自己的 profiles
  - EF 用 service_role 读 llm_config，解密后不写入日志
  - 日志/埋点中严禁出现 apiKey 明文（review 所有 `track()` 调用）
  - **用量看板**：usage_daily 不含 apiKey；按 user_id RLS 隔离

### 10.5 回归测试（v1 兼容）

- TD-2 重构后：会议音频转写→提取全流程结果与 v1 一致（用 v1 评测集跑回归）
- TD-4 优化后：反馈聚类频次统计仍 100% 准确（用 v1 integration-check 验证）
- user_feedback 枚举扩展后：老的四类会议仍正常提取

---

## 11. 实施顺序

```
Week 1（核心功能）
├─ D1-2: 009/010 迁移 + types 更新 + crypto.ts(含单测)
├─ D3-4: 功能 2.5 用户配置页（含 LLM 调用链改造 §8.1）
└─ D5:   功能 2.3 自定义 API 管理

Week 2（模块做厚 + 债清理）
├─ D6-7: 功能 2.1 反馈批量导入（CSV/Excel + 列映射）
├─ D8:   功能 2.4 API 模板库（系统常量 + 用户 CRUD）
├─ D9:   技术债清理（gen types + CONTEXT.md + ADR）
└─ D10:  功能 2.6（user_feedback 枚举 + Prompt 重训 + 评测集）

Week 3（平台增强 + EF 债 + 收尾）   ← 新增（因纳入 v1 技术债）
├─ D11:  功能 2.9 Landing Page 完整化（K-6）
├─ D12:  功能 2.10 用量看板（K-8）+ 触发器调试
├─ D13:  功能 2.8 大音频断点续查强化（K-4）+ meeting-asr-poll EF
├─ D14:  功能 2.11 Dark 模式（K-7）+ TD-2 转录提取共享函数重构 + TD-4 批量 update 优化
├─ D15:  功能 2.14 EF 单测（TD-5）+ TD-3 swagger-parser
└─ D16-17: 集成测试 + 回归测试 + v1 评测集回归 + 联调收尾
```

---

## 12. Phase 2 完成定义（DoD）

**模块做厚**：
- [ ] 009/010 迁移成功；api_templates + usage_daily 表 + RLS 就绪
- [ ] 反馈批量导入 CSV/Excel 可用（列映射 + 预览 + 去重）
- [ ] 自定义 API 草稿（空白创建 + YAML 粘贴导入）可用
- [ ] API 模板库（系统 + 用户自定义）可管理，AI 生成可引用
- [ ] 用户配置页：Provider/Key/模型映射/Base URL，Key 加密存储 + 脱敏显示 + 测试连接
- [ ] meeting_item_category 扩展 user_feedback + Prompt 重训 + 评测通过

**平台增强（v1 遗留）**：
- [ ] Landing Page 完整化（Hero + 三模块 + 痛点 + 流程图 + Footer）
- [ ] 用量看板可用（30 天趋势 + 模块/模型占比 + 累计统计），usage_daily 触发器正确累加
- [ ] 大音频续查强化：EF 超时不丢任务，asr_task_id 续查链路通
- [ ] Dark 模式切换可用（三态 + 持久化 + 无 FOUC）

**技术债清理**：
- [ ] LLM 调用入口统一（消除三处 MODEL_BY_PURPOSE 重复）
- [ ] `supabase gen types` 接入 CI
- [ ] CONTEXT.md + docs/adr/ 建立
- [ ] TD-2 转录→提取共享函数重构完成（回归 v1 评测集通过）
- [ ] TD-4 反馈聚类批量 update 优化（频次仍 100%）
- [ ] TD-5/TD-3 EF 单测 + swagger-parser 权威校验上线，CI 跑 deno test

**质量门禁**：
- [ ] 安全测试：apiKey 无明文泄露（日志/埋点/响应/看板）
- [ ] typecheck 0 错误 + 单测全通过（含新增 EF 单测）
- [ ] v1 评测集回归全 PASS（重构未引入质量回退）
