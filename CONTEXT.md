# RequirementBridge（需求桥）

把散点式的会议决策与多渠道用户反馈，用 AI 转化为结构化的产品需求与可执行的 API 定义。核心是以 Requirement 为枢纽，贯通「会议/反馈 → 需求池 → API → 外部系统」的产研流转。

## Language

### Requirements

**Requirement**:
一条被管理的产品或技术需求，不论其所处的生命周期阶段。
_Avoid_: 需求草稿（当指代业务概念而非 draft 状态时）, requirement draft, demand

**Requirement Draft**:
处于 draft（草稿）生命周期的 Requirement——已生成但尚未被人工确认纳入需求池。
_Avoid_: 草稿需求, unfinished requirement

**Confirm（确认）**:
把 Requirement 从 draft 推进到 confirmed 的人关卡——把关的是"这条需求是否值得纳入 backlog"。只用于 Requirement lifecycle，不用于外发动作（外发把关见 Approve）。
_Avoid_: 批准（批准用于 Agent Proposal，语义不同）, 核实

### Feedback

**Feedback**:
用户对产品或功能的原始声音——痛点、抱怨、期待。散点式、含噪音，需聚类降噪后才值得作为需求候选。
_Avoid_: 用户意见, voice of customer（VOC 太营销化）

**Feedback Topic**:
对一批 Feedback 聚类后归并出的主题——带情感、频次、优先级，是从噪音到信号的第一层提炼。PM 从 Topic 勾选确认后，才生成 Requirement Draft。
_Avoid_: 反馈分类, feedback category（category 是分类不是聚类）

### External integration

**Push（推送）**:
人发起的单向外发动作——PM 在需求或 API 详情页主动点按钮，把内容发到外部系统（Jira/飞书/Linear/Swagger/Webhook）。无审批环节，直接执行。审计走 `external_push_logs`。
_Avoid_: 同步（是单向非双向）, export（export 指文件导出 MD/CSV，Push 指直连外部系统）

**Agent Proposal（Agent 提议）**:
Agent 自主生成的待执行外发动作——尚未执行，处于 pending 状态，须经人 Approve 后才会真正执行。审计走 `agent_execution_logs`。
_Avoid_: AI 任务（太宽泛）, suggestion（太弱，不体现"待执行"）

**Approve（批准）**:
仅指把 Agent Proposal 从 pending 推进到执行的人关卡。不用于描述人自己发起的 Push——人不需要批准自己的动作。
_Avoid_: 确认（确认用于 Requirement 的 lifecycle 关卡，语义不同）, 通过
