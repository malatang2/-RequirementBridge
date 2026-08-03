# 06 — 会议 issue 条目转入反馈聚类池

**What to build:** 让会议里提取的 issue 类条目（遗留问题、风险、用户痛点）能一键进入反馈模块参与 AI 聚类，而不是 PM 手动复制粘贴。PM 在会议详情页选中 issue 条目，点"转入反馈"，系统创建一条新的 feedback_analysis（source_label 标注"来自会议《X》"），把条目内容作为 feedback_items 写入（source_type='meeting'，source_meta 记录 meeting_id + meeting_item_id），触发聚类。原会议条目标记 transferred_to_feedback=true 并显示"已转入反馈 →"溯源角标。遵循 ADR-0002：只转 issue 不转 requirement；Copy 快照单向不可逆（转入后双方独立编辑互不同步）；Phase 1 每次新建独立 analysis（多源合并 defer Phase 2）。

**Blocked by:** 01 — 数据地基（需要 meeting_items.transferred_to_feedback + feedback_items.source_type/source_meta + feedback_analyses.source_label）。

**Status:** done
**Commit:** 61447a5 (feat/06-meeting-to-feedback)

- [x] 会议详情页 issue 类条目（category='issue'）hover 显示"转反馈"按钮；decision/todo/requirement 类不显示
- [x] 转入弹窗：多选 issue 条目，说明文案"将进入反馈模块参与聚类，聚类后可能被合并/重命名，原条目保留不动"
- [x] 转入执行：创建 feedback_analysis（source_label="来自会议《X》"）+ 批量写 feedback_items（source_type='meeting', source_meta 含 meeting_id/meeting_item_id）+ 触发 feedback-analyze 聚类
- [x] 防重复转入：已 transferred_to_feedback=true 的条目再次转入时提示"已转入"（前端灰显 + 服务端 filterTransferableItems 双重过滤）
- [x] 溯源角标：已转入的会议条目显示"已转入反馈 →"，点击跳转到对应的 feedback_analysis 详情（page server component 反查 feedback_items.source_meta 建立 meeting_item_id → analysis_id 映射，无 schema 变更）
- [x] Copy 语义验证：转入后编辑会议条目不影响 feedback_item；删除 feedback_item 不影响会议条目（单向快照，遵循 ADR-0002）
- [x] meeting_feedback_transferred 埋点触发（带 meeting_id + item_count）
- [x] feedback-analyze EF 改造：接受预置 sourceItems 入参，写入时带 source_type/source_meta

**验证：** typecheck 0 错误 / 192 测试全过（feedback.test.ts 33 含新增 6 条）/ lint 仅旧告警 / build 15 页全过。

**关键设计点：**
- 服务端 `filterTransferableItems` 是唯一真相源（issue-only + 未转入 + 非空），前端过滤仅做体验优化
- EF 按 `created_at asc` 重新查询 feedback_items 并按位置回填 topic_id，故 action 必须保证 sourceItems 顺序与批量插入顺序一致（二者均迭代 `valid` 数组，天然一致）
- 反查机制用 `feedback_items.source_type='meeting'`（类型化列）查询后在 JS 中按 `source_meta.meeting_id` 过滤，避免 jsonb 操作符的类型歧义
- 埋点由客户端组件触发（server runtime 无 `window`，PostHog `track` 在服务端静默失效）
