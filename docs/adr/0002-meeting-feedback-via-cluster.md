# 会议反馈经聚类中转后再进入需求池

会议里提取出的 `issue` 类条目（遗留问题、风险、用户痛点），不直接变成 Requirement，而是先转入反馈模块参与 AI 聚类，PM 从聚类后的 Feedback Topic 勾选确认，才生成 Requirement Draft 进入需求池。这保证散点的会议反馈与渠道反馈一起降噪，避免把噪音直接当成 backlog。

转入语义是 **Copy 快照，单向不可逆**：会议条目转入那一刻内容被复制为 `feedback_items`，之后会议侧与反馈侧各自独立编辑互不同步；`feedback_items.source_meta` 记录的 `meeting_item_id` 是出身溯源链接（可点击跳回原条目），不构成同步契约。

## Scope of transferred items

Phase 1 MVP 阶段，**只有 `meeting_items.category = 'issue'` 的条目**转入反馈池。`requirement` 类条目不进反馈池——真正的产品需求不降级成反馈去聚类。Phase 2 扩展 `meeting_item_category` 增加 `user_feedback` 枚举后，由 AI 把用户原话单独归类，再走同一条聚类中转路径；此时 `requirement` 类仍直奔需求池，行为与 Phase 1 一致。

## Deferred to Phase 2

Phase 1 每次转入**新建一条独立的 `feedback_analyses`**（标题标注"来自会议《X》"），独立聚类。这是已知局限：会议反馈与渠道反馈/批量导入反馈的同类主题无法跨 analysis 合并统计频次。多源合并聚类（向既有 analysis 追加 `feedback_items` 后重新聚类，含去重与频次重算）defer 到 Phase 2 反馈模块做厚时解决。

## Considered Options

- **直接转需求（跳过聚类）**：被否，因为会议提取的"需求"混杂用户噪音，未经聚类降噪直接进 backlog 会污染需求池。
- **`requirement` 类也转反馈**：被否，因为 `requirement` 类实际混杂"真产品需求"和"用户痛点转述"，全部降级成反馈聚类会让真正的需求被埋没；应等 Phase 2 用 `user_feedback` 枚举分离后再对用户反馈走聚类。
- **Reference/Move 语义（替代 Copy）**：被否，Reference 需双向同步且聚类合并后反向同步方向不明；Move 破坏"原会议条目保留不动"的承诺且失去会议上下文。
- **Phase 1 就支持多源合并聚类**：被否，重设计聚类去重与频次重算会拖垮 Phase 1 主线 2 周排期；属于反馈模块做厚范畴，归 Phase 2。
