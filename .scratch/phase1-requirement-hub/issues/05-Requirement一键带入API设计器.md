# 05 — Requirement 一键带入 API 设计器

**What to build:** 打通 Requirement → API 的最后一公里。两个入口：PM 在 confirmed 的 Requirement 详情页点"生成 API 草稿"（入口 A），或在 API 设计器新建页"从需求选择"下拉中选一条 confirmed 需求（入口 B）；两者都跳转到 API 设计器并预填业务需求字段（title + content），创建的 api_draft 记录 source_requirement_id 反向关联到源 Requirement。未确认的需求按钮置灰并提示"请先确认需求"。这条路径让结构化需求直接驱动技术定义生成。

**Blocked by:** 04 — Confirm 关卡（需要 confirmed 状态作为前置条件）。

**Status:** done
**Commit:** 9d32491 (feat/05-requirement-to-api)

- [x] 入口 A：Requirement 详情页"生成 API 草稿"按钮，confirmed 时可点，跳转 API 设计器新建页并预填 business_requirement + title
- [x] 入口 B：API 设计器新建页"从需求选择"下拉，列出当前项目下 confirmed 的 Requirement，选中后预填
- [x] 创建的 api_draft.source_requirement_id 正确指向源 Requirement（集成测试验证，08 工单覆盖）
- [x] 未确认需求（lifecycle≠confirmed）的"生成 API"按钮置灰，tooltip 提示"请先确认需求"
- [x] 跨项目越权防护：source_requirement_id 指向的 Requirement 必须属于当前项目且未软删
- [x] requirement_to_api_triggered 埋点触发（带 requirement_id + draft_id）

**验证：** typecheck 0 错误 / 186 测试全过 / build 成功 / 工作树干净。

**关键设计点：**
- 越权校验集中在 server action `createApiDraft`：校验 source requirement 存在 + 同 project_id + lifecycle='confirmed' + 未软删，任一不过即拒绝（前端置灰仅体验优化，服务端才是安全边界）
- 入口 A 走 `router.push('/dashboard/api-designer/new?requirementId=xxx')`，入口 B 走下拉选择，两路在 new/page.tsx 汇合：`useSearchParams` 读 `?requirementId=` 预填 + `createApiDraft(sourceRequirementId)` 写入
- 埋点由客户端组件触发（server runtime 无 `window`，PostHog `track` 在服务端静默失效），仅在 `sourceRequirementId` 非空时上报
- 严格遵守 out-of-scope：未改 api-generate EF、未做其他 lifecycle 流转 UI、未引入新下拉组件（原生 `<select>`）、详情页只跳转不直接生成 API
