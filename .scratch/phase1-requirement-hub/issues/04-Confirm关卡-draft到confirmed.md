# 04 — Confirm 关卡：Requirement 从 draft 流转到 confirmed

**What to build:** 建立 Requirement 的人工确认关卡。AI 生成的或手动创建的 Requirement 默认是 draft 生命周期；PM 必须在详情页主动点"确认纳入需求池"才把它推进为 confirmed。确认动作触发 requirement_confirmed 埋点（v2 北极星指标）。lifecycle 流转有合法性校验（canTransition 纯函数把关，非法流转如 delivered→draft 被拒）。这条把关的是"内容是否值得做"，与 ADR-0002 的信号降噪原则一致——经过聚类/人工筛选的才进 backlog。同时把现有 feedback-gen-requirement 的 EF 写入改为 lifecycle='draft'（生成的草稿需人工确认）。

**Blocked by:** 03 — Requirement CRUD（需要 lifecycle 字段 + 详情页存在）。

**Status:** done

**Branch:** `feat/04-confirm-gate` (commit 9d0ca30)
**Note:** 分支未 push（按约定只 commit 到当前分支）；合并时需先合 03 再合 04，否则 04 的 PR diff 会带上 03+#02 的 commit；埋点实际上报 / server action / UI 交互靠 08 工单集成测试把关（本工单 action 层不单测，靠 RLS + 集成测试）。

- [x] 详情页"确认纳入需求池"按钮：draft 状态时高亮可点，点击后 lifecycle 变为 confirmed
- [x] canTransition 纯函数：合法流转通过（draft→confirmed ✓），非法流转拒绝（delivered→draft ✗）并返回错误提示
- [x] feedback-gen-requirement EF 写入改为 lifecycle='draft'：从反馈主题生成的需求草稿默认 draft，需人工确认
- [x] 确认动作触发 requirement_confirmed 埋点（验证 PostHog 上报，依赖 02 的 key 配置）
- [x] canTransition 单测覆盖全部合法/非法流转路径
