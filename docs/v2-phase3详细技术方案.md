# v2 Phase 3 详细技术方案：第三方接入（外发 → 内嵌）

> 版本：v2.1-P3-draft | 日期：2026-08-01（v2.1 关联 v1 技术债 TD-1/K-9/K-10）
> 母文档：`docs/v2统一技术方案.md`
> 目标：从"仅文件导出"升级为"第三方系统回写 + Agent 执行引擎"。按用户决策**两者都做**，分两阶段：先外发（保守、单向），再内嵌（激进、带审批）。
> 预计工期：3-4 周。
> 前置依赖：Phase 2 用户配置页（凭证加密机制 `src/lib/crypto.ts` 在本 Phase 复用）、Phase 1 需求模块（外发对象）。

---

## 0. Phase 3 范围与路线

用户已选"两者都做"。按风险升序分两阶段。下表标注每项来源（v2 新增 vs v1 候选/技术债）。

| 阶段 | 功能 | 风险 | 来源 | 与 v1 原则关系 |
|---|---|---|---|---|
| **3.A 外发回写** | Webhook + Jira/飞书/Linear/Swagger 单向推送 | 低 | v2 新增（含 v1 §P2-11 候选） | 不破坏"人确认"（人点按钮触发） |
| **3.B 内嵌执行** | MCP Server 接入层 + Agent 执行引擎 | 高 | v2 新增 | 改变原则，需 Propose-Approve-Execute 三段式 |
| **3.C 安全与可观测（横切）** | 凭证鉴权层（TD-1）+ 监控告警（K-9）+ 日志聚合（K-10） | 中 | v1 技术债 | 开放第三方时必须加固 |

```
3.1 Webhook 通用外发（基础设施）           ← 外发阶段起点
3.2 Jira / 飞书 / Linear 单向回写（需求）   ← 复用 3.1 抽象
3.3 Swagger 单向外发（API 草稿）           ← 同上
───── 外发完成，开始内嵌 ─────
3.4 MCP Server 接入层                      ← 把需求桥能力封装为 MCP 工具
3.5 Agent 执行引擎（带审批）               ← ZCode agent/skills 调 MCP，AI 提议→人审批→执行
───── 横切：第三方开放后的安全加固（v1 TD-1）─────
3.6 EF 鉴权层（TD-1）                      ← v1 用 service_role 直连 DB；开放 MCP/第三方时必须加
3.7 监控告警（K-9）+ 结构化日志聚合（K-10） ← Phase 3 可选，视灰度情况
```

---

## 1. 数据模型变更（迁移文件）

### 1.1 `supabase/migrations/011_v2_external_integration.sql`

```sql
-- ============================================================
-- 011_v2_external_integration.sql
-- v2 Phase 3：第三方接入 + 执行引擎审计
-- ============================================================

-- ① 第三方服务凭证（用户级，加密存储）
create table external_integrations (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  type          text not null,                         -- jira | feishu | linear | swagger | webhook | mcp
  name          text not null,                         -- 用户自定义名称
  credentials   jsonb not null,                        -- 加密凭证（OAuth token / API key / webhook url）
  config        jsonb not null default '{}'::jsonb,    -- 非敏感配置（如 Jira base_url、项目 key）
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, type, name),
  check (length(btrim(name)) > 0)
);
-- credentials 结构（应用层加密敏感字段）：
-- {"apiKeyEnc":"enc:...","apiTokenEnc":"enc:...","webhookUrl":"https://..."}（webhookUrl 非敏感不加密）

create index idx_external_integrations_user on external_integrations(user_id, type) where is_active = true;

-- ② 外发审计日志（不可改删，只 insert + select）
create table external_push_logs (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  integration_id    uuid references external_integrations(id) on delete set null,
  source_type       text not null,                     -- requirement | api_draft
  source_id         uuid not null,                     -- requirement_drafts.id 或 api_drafts.id（无 FK，应用层保证）
  target_type       text not null,                     -- jira_issue | feishu_task | linear_issue | swagger_spec | webhook
  external_id       text,                              -- 外部系统返回的 ID（如 JIRA-123）
  external_url      text,                              -- 外部系统可访问 URL
  status            text not null default 'pending',   -- pending | success | failed
  error_message     text,
  request_payload   jsonb,                             -- 发送内容快照（脱敏后）
  response_payload  jsonb,                             -- 外部返回快照
  created_at        timestamptz not null default now()
);

create index idx_external_push_logs_user on external_push_logs(user_id, created_at desc);
create index idx_external_push_logs_source on external_push_logs(source_type, source_id);

-- ③ Agent 执行引擎审计（Phase 3.5）
create table agent_execution_logs (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  project_id        uuid references projects(id) on delete cascade,
  agent_id          text,                              -- 执行的 agent/skill 标识
  proposal_type     text not null,                     -- create_jira | update_feishu | split_tasks | ...
  target_type       text not null,                     -- jira | feishu | linear | ...
  proposal_payload  jsonb not null,                    -- AI 提议内容（要做什么）
  status            text not null default 'pending',   -- pending | approved | rejected | executed | failed | reverted
  approver_id       uuid references auth.users(id),    -- 审批人（null = 待审批）
  approved_at       timestamptz,
  executed_at       timestamptz,
  execution_result  jsonb,                             -- 执行结果（external_id/external_url 或 error）
  revertable_until  timestamptz,                       -- 可撤销截止时间（默认 created_at + 24h）
  reverted_at       timestamptz,
  created_at        timestamptz not null default now()
);

create index idx_agent_exec_logs_user_status on agent_execution_logs(user_id, status, created_at desc);
create index idx_agent_exec_logs_pending on agent_execution_logs(project_id, status) where status = 'pending';

-- ④ 触发器：updated_at
create trigger trg_external_integrations_set_updated_at
  before update on external_integrations
  for each row execute function fn_set_updated_at();

-- ⑤ RLS（统一 user_id = auth.uid()）
create policy "ext_int_select_own" on external_integrations for select using (user_id = auth.uid());
create policy "ext_int_insert_own" on external_integrations for insert with check (user_id = auth.uid());
create policy "ext_int_update_own" on external_integrations for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "ext_int_delete_own" on external_integrations for delete using (user_id = auth.uid());

-- 审计表：只 select + insert（不可改删）
create policy "ext_push_select_own" on external_push_logs for select using (user_id = auth.uid());
create policy "ext_push_insert_own" on external_push_logs for insert with check (user_id = auth.uid());

create policy "agent_exec_select_own" on agent_execution_logs for select using (user_id = auth.uid());
create policy "agent_exec_insert_own" on agent_execution_logs for insert with check (user_id = auth.uid());
create policy "agent_exec_update_own" on agent_execution_logs for update using (user_id = auth.uid()) with check (user_id = auth.uid());
-- 注：update 允许是因为要改 status（pending→approved→executed），但由 server action 严格控制流转
```

---

## 2. 阶段 3.A：外发回写

### 2.1 IntegrationProvider 抽象（核心）

```typescript
// src/lib/integrations/provider.ts（新建）
export type IntegrationType = "jira" | "feishu" | "linear" | "swagger" | "webhook";

export interface IntegrationCreds {
  apiKey?: string;          // 解密后
  apiToken?: string;        // 解密后
  webhookUrl?: string;
  [key: string]: unknown;
}

export interface PushRequirementPayload {
  title: string;
  content: string;
  priority: string;         // high/medium/low
  sourceLabel?: string;     // "来自需求桥"
}

export interface PushApiDraftPayload {
  title: string;
  yamlContent: string;
  sourceLabel?: string;
}

export interface PushResult {
  externalId: string;       // 如 JIRA-123
  externalUrl: string;      // 可访问 URL
}

export interface IntegrationProvider {
  readonly type: IntegrationType;
  authenticate(credentials: IntegrationCreds, config: Record<string, unknown>): Promise<boolean>;
  pushRequirement(payload: PushRequirementPayload, ctx: IntegrationContext): Promise<PushResult>;
  pushApiDraft?(payload: PushApiDraftPayload, ctx: IntegrationContext): Promise<PushResult>;
}

export interface IntegrationContext {
  credentials: IntegrationCreds;
  config: Record<string, unknown>;
}
```

### 2.2 各 Provider 实现

```
src/lib/integrations/providers/
├── jira.ts          # Jira Cloud REST API（POST /rest/api/3/issue）
├── feishu.ts        # 飞书开放平台任务 API（多维表格 or 任务）
├── linear.ts        # Linear GraphQL API
├── swagger.ts       # Swagger Hub / 本地 swagger.json 外发
└── webhook.ts       # 通用 Webhook（POST JSON 到自定义 URL）
```

**Jira 示例**（最常用）：
```typescript
// src/lib/integrations/providers/jira.ts
export class JiraProvider implements IntegrationProvider {
  readonly type = "jira" as const;

  async authenticate(creds: IntegrationCreds, config): Promise<boolean> {
    // GET /rest/api/3/myself with Basic Auth（email:apiToken）
    // 200 → true，401 → false
  }

  async pushRequirement(payload: PushRequirementPayload, ctx): Promise<PushResult> {
    const baseUrl = ctx.config.baseUrl as string;        // https://xxx.atlassian.net
    const projectKey = ctx.config.projectKey as string;
    const priorityMap = { high: "Highest", medium: "Medium", low: "Low" };

    const res = await fetch(`${baseUrl}/rest/api/3/issue`, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${btoa(`${ctx.config.email}:${ctx.credentials.apiToken}`)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        fields: {
          project: { key: projectKey },
          summary: payload.title,
          description: payload.content,
          issuetype: { name: "Story" },
          priority: { name: priorityMap[payload.priority] ?? "Medium" },
        },
      }),
    });
    if (!res.ok) throw new Error(`Jira 错误: ${res.status}`);
    const data = await res.json();
    return { externalId: data.key, externalUrl: `${baseUrl}/browse/${data.key}` };
  }
}
```

### 2.3 Provider 注册表

```typescript
// src/lib/integrations/registry.ts
import { JiraProvider } from "./providers/jira";
import { FeishuProvider } from "./providers/feishu";
// ...

const REGISTRY: Record<string, () => IntegrationProvider> = {
  jira: () => new JiraProvider(),
  feishu: () => new FeishuProvider(),
  linear: () => new LinearProvider(),
  swagger: () => new SwaggerProvider(),
  webhook: () => new WebhookProvider(),
};

export function getIntegrationProvider(type: string): IntegrationProvider {
  const factory = REGISTRY[type];
  if (!factory) throw new Error(`不支持的集成类型: ${type}`);
  return factory();
}
```

### 2.4 外发 Server Action（统一入口）

```typescript
// src/app/dashboard/integrations/actions.ts
"use server";

export async function pushRequirementToIntegration(
  requirementId: string,
  integrationId: string
): Promise<PushActionResult> {
  const supabase = await createSupabaseActionClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "未登录" };

  // ① 取集成配置（含解密凭证）
  const { data: integration } = await supabase
    .from("external_integrations").select("*").eq("id", integrationId).single();
  if (!integration) return { ok: false, error: "集成不存在" };

  const credentials = decryptCredentials(integration.credentials);  // 解密
  const ctx = { credentials, config: integration.config };

  // ② 取需求数据
  const { data: requirement } = await supabase
    .from("requirement_drafts").select("title, content, priority")
    .eq("id", requirementId).is("deleted_at", null).single();
  if (!requirement) return { ok: false, error: "需求不存在" };

  // ③ 写审计日志（pending）
  const { data: log } = await supabase.from("external_push_logs").insert({
    user_id: user.id, integration_id: integrationId,
    source_type: "requirement", source_id: requirementId,
    target_type: integration.type, status: "pending",
  }).select().single();

  // ④ 调 Provider
  try {
    const provider = getIntegrationProvider(integration.type);
    const result = await provider.pushRequirement({
      title: requirement.title, content: requirement.content,
      priority: requirement.priority, sourceLabel: "来自需求桥",
    }, ctx);

    // ⑤ 更新审计（success）
    await supabase.from("external_push_logs").update({
      status: "success", external_id: result.externalId,
      external_url: result.externalUrl, response_payload: { url: result.externalUrl },
    }).eq("id", log.id);

    void track("external_push_succeeded", {
      target: integration.type, source_type: "requirement",
    });

    revalidatePath(`/dashboard/requirements/${requirementId}`);
    return { ok: true, externalId: result.externalId, externalUrl: result.externalUrl };
  } catch (e) {
    await supabase.from("external_push_logs").update({
      status: "failed", error_message: (e as Error).message,
    }).eq("id", log.id);
    void track("external_push_attempted", { target: integration.type, result: "fail" });
    return { ok: false, error: (e as Error).message };
  }
}
```

### 2.5 集成管理页：`src/app/dashboard/integrations/page.tsx`

- 列出已配置的集成（按 type 分组）
- "添加集成"：选类型 → 填凭证（加密存储）→ "测试连接"（调 `authenticate`）
- 集成卡显示：名称、类型、状态、上次推送时间

### 2.6 推送入口（在需求/API 详情页）

需求详情页加"推送到外部"按钮组：
- 下拉显示已配置的集成（Jira / 飞书 / Linear / Webhook）
- 点击 → 确认弹窗（"将创建一条 Jira Story，标题：xxx"）→ 调 `pushRequirementToIntegration`
- 成功后显示"✓ 已推送：[JIRA-123](url)"（读 external_push_logs）

API 草稿详情页同理加"推送到 Swagger/Webhook"。

### 2.7 错误码扩展

`docs/前后端接口契约.md §0.3` 新增：
```
INTEGRATION_AUTH_FAILED(401)    // 第三方凭证无效
INTEGRATION_RATE_LIMITED(429)   // 第三方限流
INTEGRATION_ERROR(502)          // 第三方返回错误
INTEGRATION_NOT_CONFIGURED(422) // 未配置该集成
```

---

## 3. 阶段 3.B：内嵌执行引擎（带审批）

### 3.1 核心原则：Propose-Approve-Execute 三段式

```
[Agent（ZCode skills/mcp）]
  │  读取已确认需求 / API 草稿
  │  生成"提议"（create_jira / split_tasks / update_feishu）
  ▼
[agent_execution_logs status='pending']
  │
  ▼
[人工审批队列 /dashboard/agent-approvals]
  │  PM 审批：approve / reject
  ▼
[approved → 执行]               [rejected → 归档]
  │  调 IntegrationProvider
  ▼
[executed → 记录 external_id]
  │  24h 内可 revert
  ▼
[reverted → 撤销外部动作（尽力）]
```

**默认配置（PM 已确认）**：
- 审批流**默认开启且首月不可关闭**（白名单内测期强制）
- 仅 Owner 角色可开启（v2 单用户阶段即本人）
- 每次执行落审计（提议内容、审批人、执行结果）

### 3.2 MCP Server 接入层

把需求桥的能力封装为标准 MCP（Model Context Protocol）工具，供外部 agent（如 ZCode）调用：

```typescript
// supabase/functions/mcp-server/index.ts（新 EF）
// 暴露 MCP 工具：
const tools = [
  {
    name: "list_confirmed_requirements",
    description: "列出项目中已确认的需求（lifecycle=confirmed）",
    inputSchema: { projectId: string },
    handler: async (args) => { /* 查 requirement_drafts */ },
  },
  {
    name: "propose_create_jira",
    description: "提议为需求创建 Jira 任务（需人工审批）",
    inputSchema: { requirementId: string, integrationId: string },
    handler: async (args) => {
      // 写 agent_execution_logs status='pending'
      // 返回 proposal_id，不立即执行
    },
  },
  {
    name: "propose_split_tasks",
    description: "提议将需求拆分为多个子任务",
    inputSchema: { requirementId: string },
    handler: async (args) => {
      // AI 拆分 → 写 proposal_payload → status='pending'
    },
  },
];
```

**安全约束**：
- MCP 工具**只暴露"提议"动作**（propose_*），不暴露"执行"动作
- 执行动作（execute）只能通过 Web UI 的审批按钮触发（防 agent 自主执行）
- MCP Server 调用需鉴权（携带用户的 access_token）

### 3.3 审批队列页：`src/app/dashboard/agent-approvals/page.tsx`

- 列出 `agent_execution_logs where status='pending'`
- 每条提议展示：类型、目标、提议内容（diff 预览）、AI 置信度（可选）
- 操作：批准（→ 执行）/ 拒绝（→ 归档）
- 历史页：查看已执行/已拒绝/已撤销的记录

### 3.4 执行与撤销

```typescript
// src/app/dashboard/agent-approvals/actions.ts
export async function approveAndExecute(proposalId: string): Promise<ActionResult> {
  // ① 校验 status='pending' 且在 revertable_until 内
  // ② 调 IntegrationProvider.push*（复用阶段 3.A 的抽象）
  // ③ 写 execution_result（external_id, external_url）
  // ④ status='executed'
  // ⑤ 埋点 agent_proposal_executed
}

export async function rejectProposal(proposalId: string, reason?: string): Promise<ActionResult> {
  // status='rejected'
  // 埋点 agent_proposal_rejected
}

export async function revertExecution(proposalId: string): Promise<ActionResult> {
  // 仅在 revertable_until 内可撤销
  // 尽力撤销：调 Provider 的 delete/close API（如 Jira 删 issue）
  // 失败则标记 reverted_at 但提示"需手动处理"
  // status='reverted'
}
```

### 3.5 与 v1 原则的协调（向用户解释的口径）

**v1 原则**："AI 仅做转录/提取/生成/聚类，所有落地动作由人确认与导出"。

**v2 升级口径**（写入 onboarding + changelog）：
> "我们坚持所有外部动作（建 Jira、改飞书任务）必须经过你审批。
> Agent 只负责把'该做什么'整理成提议清单，点'批准'才真正执行，每一步可撤销、可审计。
> 这并非让 AI 替你做决定，而是把'导出文件后人工搬运'升级为'AI 提议时一键审批'。"

---

## 4. 类型定义更新

```typescript
// src/types/database.ts 新增
export interface ExternalIntegration {
  id: string;
  user_id: string;
  type: string;
  name: string;
  credentials: Record<string, unknown>;  // 加密后
  config: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ExternalPushLog {
  id: string;
  user_id: string;
  integration_id: string | null;
  source_type: "requirement" | "api_draft";
  source_id: string;
  target_type: string;
  external_id: string | null;
  external_url: string | null;
  status: "pending" | "success" | "failed";
  error_message: string | null;
  request_payload: Record<string, unknown> | null;
  response_payload: Record<string, unknown> | null;
  created_at: string;
}

export interface AgentExecutionLog {
  id: string;
  user_id: string;
  project_id: string | null;
  agent_id: string | null;
  proposal_type: string;
  target_type: string;
  proposal_payload: Record<string, unknown>;
  status: "pending" | "approved" | "rejected" | "executed" | "failed" | "reverted";
  approver_id: string | null;
  approved_at: string | null;
  executed_at: string | null;
  execution_result: Record<string, unknown> | null;
  revertable_until: string | null;
  reverted_at: string | null;
  created_at: string;
}
```

---

## 5. 安全设计（重点）

> Phase 3 引入第三方接入和 Agent 执行，安全面扩大。本节落实母文档 §4.4 中 TD-1（EF service_role 绕 RLS）在"开放第三方"场景下的加固要求。

### 5.1 凭证安全（复用 Phase 2 加密机制）

- 所有第三方凭证（API Key / Token）**应用层 AES-256-GCM 加密**
- **复用 Phase 2 功能 2.5 已建立的 `src/lib/crypto.ts`**（`encryptApiKey` / `decryptApiKey` / `maskApiKey`），不另起一套
- 加密后存 `external_integrations.credentials` jsonb（与 Phase 2 `profiles.llm_config.apiKeyEnc` 同加密方案，密钥同源 `LLM_CONFIG_ENCRYPTION_KEY`）
- UI 永远脱敏（`sk-****1234`），提供"测试连接"按钮验证有效性
- EF / server action 用 service_role 解密读，解密后**不写日志**

### 5.2 数据外发边界

- 外发内容**只读用户自己的数据**（RLS 保证）
- 外发前**脱敏审计**：`request_payload` 不含本系统内部敏感字段（如 user_id）
- 提供外发日志查询（用户可审计"什么被推到了哪里"）

### 5.3 Agent 执行边界

- MCP 工具**只暴露 propose_*，不暴露 execute**（执行只能 Web UI 审批触发）
- 审批流强制：`status='pending'` 必须人工 approve 才能执行
- 撤销窗口：默认 24h，超时不可撤销（但审计记录永久保留）

### 5.4 防滥用

- 单用户每日外发次数上限（防异常循环）
- Agent 提议频率限制（防 agent 失控刷提议）
- 失败重试上限（防第三方限流时反复重试）

### 5.5 EF 鉴权层（v1 TD-1 加固）

**v1 现状**（技术债 TD-1）：所有 Edge Function 用 `SUPABASE_SERVICE_ROLE_KEY` 直连 DB，绕过 RLS。v1 可接受（EF 是内部可信服务端，入参由自己的 server action 构造）。

**Phase 3 风险变化**：一旦开放 MCP Server（3.4）给外部 agent 调用，EF 入口不再只来自自己的 server action——外部 agent 携带任意参数即可调用。若仍用 service_role 且不做入参鉴权，等于把"绕 RLS 的 DB 写权限"暴露给外部。

**加固方案（功能 3.6，TD-1）**：
- **MCP Server EF 独立鉴权**：调用方必须携带用户 access_token，EF 内用 `supabase.auth.getUser(token)` 验证身份，再以该用户身份执行（或显式校验 `args.userId === token.user.id` 防越权传参）
- **service_role 范围收窄**：仅在确实需要绕 RLS 的写操作（如写 audit log）用 service_role；用户数据查询改为带用户 session 的 client（受 RLS 保护）
- **入参白名单校验**：每个 MCP 工具显式校验入参（projectId 归属当前用户、requirementId 未删除等），不信任调用方传入的 userId
- **保留外发 EF 的 service_role**：外发回写（3.1-3.3）的 EF 仍可接受 service_role（入参由自己的 server action 构造，可信），但加 rate limit

**进度安排**：3.6 与 3.4（MCP Server）同步落地，**MCP Server 上线前必须完成 TD-1 加固**，否则不开放。

### 5.6 可观测性（v1 K-9 / K-10，Phase 3 可选）

第三方接入后故障面扩大（外部 API 不稳定、凭证失效、agent 失控），v1"无监控告警 + 日志靠控制台"的遗留问题（K-9/K-10）在 Phase 3 优先级提升。

**建议（非阻塞，视灰度情况纳入 3.7）**：
- **K-9 监控告警**：接入 Vercel Analytics + 关键失败率告警（外发失败率 > 阈值、agent 提议激增）
- **K-10 结构化日志**：EF 输出 JSON line（`level/ts/ef/userId/target/result`），可被 Supabase 平台日志采集；与 `docs/日志与审计基础设施开发计划.md` 的 G1 目标对齐
- **优先级**：若灰度期间出现可观测盲区导致的故障，立即提升为 Phase 3 必做项

---

## 6. 测试计划

### 6.1 单元测试

- Provider authenticate/push 的 mock 测试（mock fetch，不真实调外部）
- 加密/解密往返（复用 Phase 2 crypto 测试）
- 审批流转纯函数（canExecute / canRevert）

### 6.2 集成测试

- 真实 Jira/飞书沙箱环境（需测试账号）：authenticate → push → 验证外部创建
- Webhook 外发：本地 mock server 接收 + 验证 payload
- 审计日志完整性：每次推送/提议/审批/执行都有日志

### 6.3 安全测试

- 凭证泄露：grep 日志/响应，确保无明文 apiKey
- 越权：A 用户的 agent 提议 B 用户不能审批
- MCP 工具边界：尝试调 execute_* 应被拒绝（只允许 propose_*）

### 6.4 灰度验证

- 白名单 5-10 个团队先验 OAuth/Token 配置流程（3.A）
- Agent 执行引擎（3.B）白名单 3-5 个团队，首月强制审批流

---

## 7. 实施顺序

```
阶段 3.A 外发（约 2 周）
├─ D1-2: 011 迁移 + types + IntegrationProvider 抽象 + registry
├─ D3-4: Jira Provider（最常用）+ Webhook Provider（最通用）
├─ D5-6: 外发 Server Action + 审计日志 + 推送入口（需求/API 详情页）
├─ D7:   飞书 / Linear / Swagger Provider
├─ D8-9: 集成管理页 + 测试连接 + 凭证加密（复用 Phase 2 crypto.ts）
└─ D10:  集成测试（沙箱）+ 灰度白名单

阶段 3.B 内嵌执行（约 1.5-2 周，依赖 3.A 完成）
├─ D11-12: MCP Server EF（list_confirmed_requirements + propose_* 工具）
│           ↳ 同步落地 3.6 TD-1 鉴权层（MCP 入口 access_token 验证 + 入参白名单）
├─ D13-14: 审批队列页 + approve/reject/execute/revert action
├─ D15-16: ZCode agent/skills 接入（调用 MCP 提议）
├─ D17:   撤销机制 + 防滥用
└─ D18-20: 安全测试 + 白名单灰度 + onboarding 解释口径

阶段 3.C 横切（可选，与 3.B 并行或后置）
└─ K-9 监控告警 + K-10 结构化日志（视灰度故障情况决定是否纳入）
```

---

## 8. Phase 3 完成定义（DoD）

### 阶段 3.A（外发）
- [ ] 011 迁移成功；external_integrations + external_push_logs 表 + RLS 就绪
- [ ] IntegrationProvider 抽象 + 至少 Jira/Webhook 两个实现
- [ ] 需求/API 详情页可推送到外部系统，审计日志完整
- [ ] 集成管理页：配置/测试连接/启用禁用
- [ ] 凭证加密存储（复用 Phase 2 crypto.ts）+ UI 脱敏
- [ ] 安全测试：无凭证明文泄露

### 阶段 3.B（内嵌执行）
- [ ] MCP Server EF 暴露 list/propose 工具（不含 execute）
- [ ] **3.6 TD-1 鉴权层：MCP 入口 access_token 验证 + 入参白名单 + 越权校验**
- [ ] agent_execution_logs 表 + 审批流转（pending→approved→executed）
- [ ] 审批队列页可用
- [ ] 撤销窗口（24h）可用
- [ ] 审批流默认开启且首月不可关闭
- [ ] onboarding 解释口径上线
- [ ] 埋点（agent_proposal_created/approved/rejected/executed）正确触发
- [ ] 白名单灰度 3-5 团队验证

### 阶段 3.C（横切，可选）
- [ ] K-9 监控告警接入（外发失败率/agent 提议激增告警）
- [ ] K-10 EF 结构化 JSON 日志（与日志基建计划 G1 对齐）
- [ ] （如灰度无故障，本阶段可后置到 v2.2）

---

## 9. 风险与缓解（Phase 3 专项）

| 风险 | 等级 | 缓解 |
|---|---|---|
| 第三方 API 不稳定/限流 | 中 | 重试 + 退避 + 审计日志记录失败，不影响本系统数据 |
| 凭证泄露 | 高 | AES 加密 + UI 脱敏 + service_role 解密 + 日志审查 |
| Agent 失控刷提议 | 高 | 频率限制 + 审批流拦截（pending 不自动执行） |
| 用户对"AI 执行"恐慌 | 高 | onboarding 解释 + 强制审批首月 + 可撤销 + 完整审计可查 |
| 第三方 OAuth 配置复杂 | 中 | 提供详细配置文档 + "测试连接"按钮即时反馈 |
| Jira/飞书 API 版本变更 | 低 | Provider 隔离，单点修改不影响其他 |
| **MCP 开放后 service_role 绕 RLS（TD-1）** | **高** | **3.6 鉴权层：MCP 入口 access_token 验证 + 入参白名单 + 越权校验；MCP 上线前必须完成** |
| **第三方故障无告警盲区（K-9/K-10）** | **中** | **3.C 监控告警 + 结构化日志；灰度期间若出现故障盲区立即提升优先级** |

---

## 10. 未来展望（v3 候选，不在 Phase 3 范围）

- **双向实时同步**：Jira 状态变更回写需求桥（目前单向）
- **团队级集成配置**：组织内共享集成凭证（目前单用户）
- **更多 Provider**：钉钉、GitHub Issues、Asana、Postman
- **Agent 半自动模式**：通过率 >80% 的用户可开放"低风险动作自动执行"（目前全强制审批）
- **GraphQL/gRPC API 类型支持**（母文档 §3.2 明确 v3）
