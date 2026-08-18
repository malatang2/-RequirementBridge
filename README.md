# 需求桥 RequirementBridge

> 会议决策 → 结构化需求 → 可执行 API：AI 一次性把会议与反馈转化为产品需求与技术接口。

## 功能模块

**v1 三模块**：会议纪要（音频/文本 → AI 提取决策/待办/需求/问题）、API 设计器（业务需求 → OpenAPI 3.0 草稿 + 版本管理）、反馈洞察（聚类/情感/频次，一键生成需求草稿）。

**v2 Phase 1 — 需求统一中枢**（`profiles.feature_flags` 的 `requirement_hub` 灰度开关控制，白名单可见）：

- **需求池**：统一管理来自反馈、会议与手动录入的产品需求（CRUD / 筛选 / 优先级 / 软删）
- **Confirm 关卡**：draft → confirmed 人工确认流转，只有 PM 拍板的需求进入 backlog
- **需求 → API 一键带入**：confirmed 需求带入 API 设计器（`source_requirement_id` 溯源）
- **会议 issue → 反馈聚类池**：issue 条目批量转入反馈参与 AI 聚类（Copy 快照 + 防重复转入）
- **按需求分组的 API 视图**：API 设计器按来源需求整理接口（只读）
- **灰度三层 gate**：入口渲染控制 + 页面占位 + server action 二次校验（白名单 SQL：`scripts/whitelist-requirement-hub.sql`）

**测试与质量**：Vitest 单测 223 用例（`npm test`）/ Supabase 集成联调 31 断言（`node scripts/integration-check.mjs`）/ AI 评测集（`node scripts/run-eval.mjs`，消费真实 DashScope token）。

## 技术栈

- **前端**：Next.js 15 (App Router, TypeScript) + Tailwind CSS + shadcn/ui
- **后端**：Supabase（Postgres / Auth / Storage / Edge Functions）
- **AI**：阿里云百炼 / DashScope（通义千问 Qwen + fun-asr/Paraformer）—— CP0 决议由 OpenAI 迁移
- **部署**：Vercel

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量
cp .env.local.example .env.local
#   编辑 .env.local，填入 Supabase 与 DashScope 配置

# 3. 启动开发服务器
npm run dev
#   访问 http://localhost:3000
```

## 环境变量

见 `.env.local.example`。关键变量：

| 变量 | 用途 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 项目 URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase 浏览器端 key（RLS 保护） |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase 服务端 key（仅服务端） |
| `DASHSCOPE_API_KEY` | 通义千问 API Key（CP0：替代原 OPENAI_API_KEY） |
| `DASHSCOPE_BASE_URL` | DashScope OpenAI 兼容端点 |

## 常用脚本

| 命令 | 说明 |
|---|---|
| `npm run dev` | 开发服务器 |
| `npm run build` | 生产构建 |
| `npm run lint` | ESLint 检查 |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run test` | 单元测试（Vitest） |
| `npm run db:push` | 推送 Supabase 迁移 |
| `npm run db:reset` | 重置本地 Supabase 数据库 |

## 目录结构

```
src/
├── app/                  # Next.js App Router 路由
│   ├── layout.tsx        # 根布局
│   ├── page.tsx          # Landing Page
│   └── dashboard/        # 工作台
├── components/           # React 组件
│   └── ui/               # shadcn/ui 组件
├── hooks/                # 自定义 Hook（如 use-task-status）
├── lib/                  # 工具与封装
│   ├── env.ts            # 环境变量
│   ├── utils.ts          # 通用工具（cn）
│   ├── supabase/         # Supabase 客户端
│   └── llm/              # LLM 封装（DashScope / LLMProvider）
└── types/                # TypeScript 类型

supabase/
└── migrations/           # 数据库迁移（IaC）

tests/
└── eval/                 # AI 评测集（Golden Set）

docs/                     # 设计与需求文档
```

## 开发工作流

见《docs/开发工作流规范.md》。要点：
- **分支**：Trunk-based，`main` + `feature/*`，PR 合并前需 CI 绿 + ≥1 人 CR
- **提交**：Conventional Commits + 任务 ID（如 `feat(meeting): ... (#T1.1)`）
- **门禁**：CI 跑 lint + typecheck + test + build；AI 链路另走评测门禁

## 文档

所有设计与需求文档在 `docs/` 目录：SOW、需求拆解与排期、数据模型、接口契约、UI 线框、设计评审清单、开发工作流规范。
