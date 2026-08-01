# RequirementBridge 上线 Checklist

| 项 | 内容 |
|---|---|
| 文档版本 | v1.0 |
| 日期 | 2026-07-30（Day 6） |
| 文档类型 | 发布级验收清单（对应《开发工作流规范 §5.4》发布级 DoD） |
| 适用 | v1 首次上线 + 预发布复测 |

> 每项须实地验证（脚本/手动），打勾方可发布。对应排期阶段五"预发布与上线"。

---

## 1. 功能验收（三模块端到端可走通）

### 模块一·会议纪要
- [ ] 音频上传（mp3/wav/m4a，≤50MB）能发起分析，超限被拦截
- [ ] 粘贴文本能发起分析
- [ ] status 进度提示正常（uploading→transcribing→analyzing→completed）
- [ ] 四类条目分组展示（决策/待办/需求/问题）+ 整体摘要
- [ ] 条目可编辑/删除/改优先级/改负责人/手动新增
- [ ] 条目带原文引用，且引用能追溯到原文（quote_offset 命中）
- [ ] 可导出 Markdown、CSV，可复制
- [ ] 转录失败/提取失败有明确提示 + 可重试

### 模块二·API 设计器
- [ ] 业务需求（必填）+ 规范上下文（选填）能发起生成
- [ ] 生成进度提示正常（generating→completed）
- [ ] 产出 OpenAPI 3.0 YAML，含 openapi/paths/components/schemas
- [ ] 字段 camelCase，每操作含 400/401/404/500
- [ ] 代码视图可编辑 + 实时 YAML 校验（合法绿条/问题黄条）
- [ ] 可视化视图（Swagger 卡片）正常渲染
- [ ] 版本保存/历史可查看/重新生成
- [ ] 可导出 YAML、JSON，可复制

### 模块三·反馈洞察
- [ ] 粘贴文本（每行一条）能发起分析
- [ ] 统计卡（总数/主题数/高优数/负面占比）正确
- [ ] 横向条形图（按 frequency 降序）+ 情感饼图渲染正常
- [ ] 主题卡可编辑/合并/删除
- [ ] 每主题含样本反馈（2-3 条）
- [ ] 勾选主题能生成需求草稿，草稿可查看/复制

### 通用
- [ ] Landing / 登录 / 注册页可访问
- [ ] 邮箱密码登录、登出正常
- [ ] Google OAuth 登录正常（需配置 OAuth provider）
- [ ] 未登录访问 /dashboard/* 重定向登录
- [ ] 项目 CRUD（创建/切换/归档）
- [ ] Light/Dark 切换
- [ ] 移动端响应式（侧栏折叠）

---

## 2. 准确度验收（AI 评测门禁）

> 运行 `DASHSCOPE_API_KEY=xxx node scripts/run-eval.mjs`，须全 PASS。

- [ ] 模块一·会议：条目数达标、分类覆盖、**原文引用可追溯率 ≥90%**
- [ ] 模块二·API：含 openapi/paths、**错误码完整率 100%**、**camelCase ≥95%**
- [ ] 模块三·反馈：主题数达标、**聚类覆盖率 ≥70%**、**频次一致性**
- [ ] 评测脚本输出 "✅ PASS — 准确度门槛达标"

---

## 3. 安全与隔离

> 运行 `node scripts/integration-check.mjs`，须 10/10 通过。

- [ ] **全表 RLS 生效**：无登录态查询返回 0 行
- [ ] 登录后仅能查到自己的数据
- [ ] **伪造 user_id 查询被拦截**（返回 0 行）
- [ ] **伪造 user_id 插入被拒绝**（403）
- [ ] Storage bucket 按用户目录隔离
- [ ] DashScope key 仅在服务端（Edge Function），不进前端

---

## 4. 环境与密钥

- [ ] Supabase 生产项目 URL / anon key / service_role key 已配置（Vercel 环境变量）
- [ ] DashScope API Key 已配置（Edge Function secrets）
- [ ] `.env.local` 不入库（.gitignore 生效）
- [ ] service_role key 不暴露到前端（仅 NEXT_PUBLIC_* 进客户端）

---

## 5. 合规口径（CP0 B8）

- [ ] 会议/反馈新建页有"数据将发送至阿里云百炼（国内）处理"提示
- [ ] 不做强脱敏（CP0 决议：v1 加提示 + 建议，不强脱敏）
- [ ] 保留期随业务数据可删

---

## 6. 可观测性

- [ ] PostHog key 已配置（选填，无 key 静默降级不影响功能）
- [ ] 关键事件埋点就位（meeting_created / api_generation_started / feedback_analysis_started）
- [ ] 登录后关联 PostHog userId
- [ ] status=failed 落库可查（Edge Function 写 error_message）

---

## 7. 部署（Vercel）

- [ ] 仓库已连接 Vercel
- [ ] 环境变量已在 Vercel 配置（NEXT_PUBLIC_SUPABASE_* / SUPABASE_SERVICE_ROLE_KEY / DASHSCOPE_API_KEY）
- [ ] 预览部署（Preview Deployment）可访问
- [ ] 生产构建无错误（`npm run build` 通过）
- [ ] 回滚预案就绪（Vercel 即时回滚到上一版本）

---

## 8. 发布前最终复测

- [ ] 预发布环境跑一次 `run-eval.mjs` 确认无回归
- [ ] 预发布环境跑一次 `integration-check.mjs` 确认 RLS 有效
- [ ] 手动走一遍三模块核心链路（注册→登录→建项目→三模块各一次操作→导出）
- [ ] 无 P0 缺陷；P1 缺陷有处理计划

---

## 附录：Day 6 Sprint 验收记录（2026-07-30）

| 验收项 | 结果 | 证据 |
|---|---|---|
| AI 评测门禁（T5.2） | ✅ 5/5 PASS | `node scripts/run-eval.mjs` 输出 |
| 集成联调（T5.1） | ✅ 10/10 PASS | `node scripts/integration-check.mjs` 输出 |
| RLS 隔离 | ✅ 有效 | 伪造 user_id 插入返回 403 |
| PostHog 埋点（T4.2） | ✅ 就位（可选启用） | analytics.ts + 三模块 track |
| typecheck | ✅ 0 错误 | `npm run typecheck` |
| 单元测试 | ✅ 148 通过 | `npm run test` |
| 生产构建 | ✅ 成功 | `npm run build` |

**CP5 结论：Sprint 核心目标达成，三大模块全链路就绪，准确度门槛达标。**
