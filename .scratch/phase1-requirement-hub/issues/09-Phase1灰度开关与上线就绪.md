# 09 — Phase 1 灰度开关与上线就绪

**What to build:** Phase 1 上线前的最后准备。基于 profiles.feature_flags 配置需求模块新功能的灰度白名单（需求 CRUD / 确认关卡 / 会议转入 等新入口按 feature_flags 控制渲染，server action 二次校验防绕过）；确认 Vercel 部署为最新代码；走完上线 checklist。功能开关就绪后可灰度发布（先白名单，第 2 周全量）。

**Blocked by:** 08 — Phase 1 回归验证（质量门禁通过才能上线）, 02 — v1 遗留修复（PostHog/OAuth/CI 是上线前提）。

**Status:** done

- [x] feature_flags 灰度机制：前端读 profiles.feature_flags 决定渲染哪些新入口；server action 二次校验（防绕过前端直接调 API）
- [x] 灰度白名单配置：首批白名单用户/项目的 feature_flags 就位（`scripts/whitelist-requirement-hub.sql` 就位；测试账号 A 已实际置 `requirement_hub=true` 并经 UI 全链路验证，B 保持关）
- [x] Vercel 部署确认：生产环境为 Phase 1 最新代码（main 85f0d2c 已推送 GitHub；Vercel Git 集成自动部署 Production **Ready**，requirement-bridge.vercel.app）
- [x] 上线 checklist 全绿：K-1/K-2/K-3/K-5 修复项验证 + typecheck 0 错误 + 单测全通过 + 集成测试通过 + v1 评测集回归通过（typecheck 0 错 / vitest 223/223 / build 成功 / eval 5/5 / 集成 31/31；期间发现并修复 profiles 无 RLS 的 004 疏漏——009 已 db push 生效并实证；K-2/K-3 人工核对步骤在报告手册）
- [x] 灰度发布就绪：可对白名单用户开放需求模块新功能（三层 gate 就绪；flag off/on 均经浏览器 UI 实测：B 无入口+直链占位，A 侧栏入口+需求池可用+经 UI 创建需求成功）

**Branch:** feat/09-feature-flag-release (commit 83f827e / 10d3567 / 739be7d；已合并 main 85f0d2c)
**Note:** 09 完成后经用户授权执行上线：四条分支按序推送 GitHub（03→04→08→09），本地按序合并进 main（四个合并零冲突，合并后回归全绿：typecheck 0 错 / vitest 223 / build 成功），main 推送后 Vercel 自动部署 Production Ready。剩余用户侧操作：K-2 PostHog 环境变量、K-3 Google OAuth、真实用户白名单 SQL、第 2 周全量——见 09-上线就绪报告.md §7。至此 Phase 1 九工单全部完成并上线。
