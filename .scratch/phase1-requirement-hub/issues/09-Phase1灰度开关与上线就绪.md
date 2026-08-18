# 09 — Phase 1 灰度开关与上线就绪

**What to build:** Phase 1 上线前的最后准备。基于 profiles.feature_flags 配置需求模块新功能的灰度白名单（需求 CRUD / 确认关卡 / 会议转入 等新入口按 feature_flags 控制渲染，server action 二次校验防绕过）；确认 Vercel 部署为最新代码；走完上线 checklist。功能开关就绪后可灰度发布（先白名单，第 2 周全量）。

**Blocked by:** 08 — Phase 1 回归验证（质量门禁通过才能上线）, 02 — v1 遗留修复（PostHog/OAuth/CI 是上线前提）。

**Status:** done

- [x] feature_flags 灰度机制：前端读 profiles.feature_flags 决定渲染哪些新入口；server action 二次校验（防绕过前端直接调 API）
- [x] 灰度白名单配置：首批白名单用户/项目的 feature_flags 就位（`scripts/whitelist-requirement-hub.sql` 就位；测试账号 A 已实际置 `requirement_hub=true` 并经 UI 全链路验证，B 保持关）
- [ ] Vercel 部署确认：生产环境为 Phase 1 最新代码（按约定 push/PR/部署属用户操作，见 09-上线就绪报告.md §7 操作手册——此为 agent 工单的既有 out-of-scope 约定，非未完成项）
- [x] 上线 checklist 全绿：K-1/K-2/K-3/K-5 修复项验证 + typecheck 0 错误 + 单测全通过 + 集成测试通过 + v1 评测集回归通过（typecheck 0 错 / vitest 223/223 / build 成功 / eval 5/5 / 集成 31/31；期间发现并修复 profiles 无 RLS 的 004 疏漏——009 已 db push 生效并实证；K-2/K-3 人工核对步骤在报告手册）
- [x] 灰度发布就绪：可对白名单用户开放需求模块新功能（三层 gate 就绪；flag off/on 均经浏览器 UI 实测：B 无入口+直链占位，A 侧栏入口+需求池可用+经 UI 创建需求成功）

**Branch:** feat/09-feature-flag-release (commit 83f827e / 10d3567 + 收尾 docs commit)
**Note:** 分支未 push——按约定只 commit 到当前分支，未做 git push，也未开 PR。合并时需先合 03（feat/03-requirement-crud-filter）再合 04，再合 feat/08-regression（已含 05/06/07），最后合本分支。上线操作（push/PR/Vercel/真实用户白名单/第 2 周全量）见 09-上线就绪报告.md 操作手册，由用户执行；009_profiles_rls 迁移与测试账号白名单已在本工单内完成（db push + 集成 check 15 实证，项目一度 NXDOMAIN 已由用户恢复、数据完好）。至此 Phase 1 九工单全部完成。
