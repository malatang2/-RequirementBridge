# 08 — Phase 1 回归验证：单测 + 集成测试 + v1 评测集回归

**What to build:** Phase 1 的质量门禁。新增纯函数单测（Requirement 校验/lifecycle 流转合法性/接口分组）；RLS 跨用户隔离与数据流联调的集成测试（覆盖 CRUD 隔离、转入链路、带入链路、软删）；v1 三模块 AI 评测集回归确认 Phase 1 的 additive change 未引入质量回退（会议提取/反馈聚类/API 生成准确率仍达标）。这是 Phase 1 上线前的最后一道质量关。

**Blocked by:** 05 — Requirement 一键带入 API（主线三功能完成，才有完整链路可验证）, 06 — 会议转入（转入链路需验证）。

**Status:** done

- [x] requirements 校验纯函数单测：空标题/超长标题/空内容/非法优先级/默认 lifecycle 全覆盖
- [x] canTransition 单测：全部合法流转（draft→confirmed→in_progress→delivered 等）与非法流转（delivered→draft 等）
- [x] groupApiDraftsByRequirement 单测：分组逻辑边界
- [x] 集成测试：Requirement CRUD 跨用户 RLS 隔离（A 的需求 B 看不到/改不了/删不了）
- [x] 集成测试：会议 issue 转入后 feedback_items 带 source_meta + 聚类触发 + 防重复
- [x] 集成测试：需求→API 带入后 source_requirement_id 正确 + 越权防护
- [x] 集成测试：软删后列表不展示 + 详情页直链处理
- [x] v1 评测集回归：会议提取/反馈聚类/API 生成三模块跑 run-eval.mjs，准确率仍 100%（无回退）
- [x] v1 RLS 集成测试回归：integration-check.mjs 仍 10/10 通过

---

**Branch:** `feat/08-regression`（集成分支，不 push、不开 PR，与 01-07 一致）

**Note:**
- ✅ Phase 1 质量门禁全部达标：纯函数单测 211/211、集成测试 25/25（含 v1 RLS 10/10 + Phase 1 新增 14 项）、v1 AI 评测 5/5。详见 `08-回归报告.md`。
- **集成测试设计**：用 service_role 调 `/auth/v1/admin/users` 幂等创建真实用户 B（`rb08-test-b@example.com`），取代 v1 的"伪造 user_id"——因为 Phase 1 新表的 user_id 有 FK → auth.users，伪造 UUID 写不进。RLS 验证一律走 anon+access_token 真实登录会话。
- **本轮解决一个脚本侧写法问题**（非 feature bug）：PostgREST 不会自动把 `auth.uid()` 填入插入行，所有业务表的 insert policy 是 `with check (user_id = auth.uid())`，所以 anon 会话的 insert body 必须显式带 user_id。已在 `integration-check.mjs` 顶部从 JWT 解出 uidA/uidB 并补到所有 AUTH 插入 body。
- **顺带完成 01 遗留的 DB 执行**：用 Supabase access token 跑 `supabase db push --linked`，007/008 的 10 个新字段已在远程 DB 就位（工单 01 的 DB 执行态相应更新）。access token 按约定用完到 dashboard 撤销。
- **未发现需新开工单的 bug**；08 只在集成分支验证，未回头改 feature 分支代码。
