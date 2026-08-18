# 03 — Requirement CRUD：创建、编辑、删除、筛选

**What to build:** 把需求模块从只读汇总页升级为可管理的需求池。PM 能手动创建一条 Requirement（标题/内容/优先级，source_type='manual'），编辑标题与内容，软删除（deleted_at 标记，列表默认不展示但数据保留），并按 lifecycle/priority/source 筛选列表。这是"需求统一中枢"的本体——后续的确认关卡、API 带入、会议转入都需要这个承接容器。每个 Requirement 创建时默认 lifecycle='draft'，等待人工 Confirm。

**Blocked by:** 01 — 数据地基（需要 priority/lifecycle/source_meeting_item_id/deleted_at 字段就位 + TS 类型更新）。

**Status:** done

- [x] 手动创建 Requirement：填写标题+内容，选择优先级，source_type='manual'，lifecycle 默认 'draft'，落库成功
- [x] 编辑 Requirement：标题、内容、优先级可改，更新后 is_edited=true，updated_at 自动刷新
- [x] 软删除：删除后 deleted_at 标记，列表不展示，但详情页直链仍可访问（提示已删除）
- [x] 筛选：列表支持按 lifecycle（草稿/已确认/进行中/已交付/搁置）、priority（高/中/低）、source（反馈/会议/手动）筛选
- [x] 列表排序：按 lifecycle（draft 在前）→ priority（high 在前）→ updated_at（最新在前）
- [x] 校验纯函数（validateRequirementInput）单测覆盖：空标题/超长标题/空内容/非法优先级/默认 lifecycle
- [ ] RLS 跨用户隔离：A 用户的 Requirement B 用户看不到（集成测试验证，08 工单）
