# 09 — Phase 1 灰度开关与上线就绪

**What to build:** Phase 1 上线前的最后准备。基于 profiles.feature_flags 配置需求模块新功能的灰度白名单（需求 CRUD / 确认关卡 / 会议转入 等新入口按 feature_flags 控制渲染，server action 二次校验防绕过）；确认 Vercel 部署为最新代码；走完上线 checklist。功能开关就绪后可灰度发布（先白名单，第 2 周全量）。

**Blocked by:** 08 — Phase 1 回归验证（质量门禁通过才能上线）, 02 — v1 遗留修复（PostHog/OAuth/CI 是上线前提）。

**Status:** ready-for-human（代码与本地验证完成；剩余为环境恢复与上线操作，见 Note）

- [x] feature_flags 灰度机制：前端读 profiles.feature_flags 决定渲染哪些新入口；server action 二次校验（防绕过前端直接调 API）
- [ ] 灰度白名单配置：首批白名单用户/项目的 feature_flags 就位（`scripts/whitelist-requirement-hub.sql` 已就位；对测试账号的实际执行被远程 DB 不可达阻断，恢复后由集成 check 15c 自动化执行）
- [ ] Vercel 部署确认：生产环境为 Phase 1 最新代码（按约定属用户操作，见 09-上线就绪报告.md §7）
- [ ] 上线 checklist 全绿：K-1/K-2/K-3/K-5 修复项验证 + typecheck 0 错误 + 单测全通过 + 集成测试通过 + v1 评测集回归通过（typecheck 0 错 / vitest 223/223 / build 成功 / eval 5/5 已绿；**集成测试被远程 DB 不可达阻断**——项目域名 NXDOMAIN，恢复步骤见报告 §7 第 0 步）
- [x] 灰度发布就绪：可对白名单用户开放需求模块新功能（三层 gate 代码侧就绪；新增发现 profiles 表未开 RLS，已写 009 迁移待上线时执行）

**Branch:** feat/09-feature-flag-release（commit 见 git log）
**Note:** 分支未 push——按约定只 commit 到当前分支，未做 git push，也未开 PR。合并时需先合 03（feat/03-requirement-crud-filter）再合 04，再合 feat/08-regression（已含 05/06/07），最后合本分支。两个上线前必办项：① 恢复/重建 Supabase 项目（kcpcqocxtkaygtcpmmfp 域名已 NXDOMAIN，08 时点尚可用）；② 执行 009_profiles_rls.sql（profiles 表此前从未开 RLS 的疏漏补丁，未执行时集成 check 15b/15e 会红）。完整上线操作手册（push 顺序、环境变量、白名单、回滚）见 09-上线就绪报告.md。至此 Phase 1 九工单的代码工作全部完成，剩余为用户侧环境与上线操作。
