# 07 — 按需求分组的 API 接口整理视图

**What to build:** 给 API 设计器列表页增加"按需求分组"视图切换。已关联 Requirement 的 API 草稿（source_requirement_id 非空）按需求标题分组展示，每组显示需求标题 + lifecycle + 优先级 + 该需求下的接口清单（path + method + origin 标签）；未关联需求的 API 草稿归入"未归属"组。研发评审时能一眼看到"哪些接口服务于哪些需求"，而不是孤立看 YAML。这是研发视角的便利功能，不打通主线但提升 API 模块的可读性。

**Blocked by:** 05 — Requirement 一键带入 API 设计器（需要 source_requirement_id 数据填充才有意义；UI 本身可在 05 完成后立即做）。

**Status:** ready-for-agent

- [ ] API 设计器列表页增加"按需求分组"/"平铺"视图切换
- [ ] 分组视图：有 source_requirement_id 的 api_draft 按 Requirement 标题分组，组头显示需求标题 + lifecycle 标签 + 优先级
- [ ] "未归属"组：source_requirement_id 为空的 api_draft 归入此组
- [ ] 点击组内接口可跳转到对应 api_draft 详情页
- [ ] 分组纯函数（groupApiDraftsByRequirement）单测覆盖：有归属/无归属/多接口同需求/单接口单需求
