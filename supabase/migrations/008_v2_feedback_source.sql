-- ============================================================
-- 008_v2_feedback_source.sql
-- v2 Phase 1：Feedback 来源追溯 + 会议条目转入标记
-- 服务于 ADR-0002（会议 issue 经反馈聚类中转后再进入需求池）
-- 策略：additive change——仅加字段/索引，不破坏 v1 既有功能
-- 注：本迁移只落地 schema；会议转入反馈的业务逻辑见 06 工单，此处不实现
-- ============================================================

-- ① Feedback Item 加来源（会议转入 / 批量导入 / 粘贴 / 文件）
--    source_type 保持 text（v1 feedback_items 无此字段，新增默认 'paste' 兼容老数据）
--    source_meta 记录出身溯源（如 meeting_item_id），是 Copy 快照的溯源链接，非同步契约
alter table feedback_items
  add column source_type text  not null default 'paste',
  add column source_meta jsonb;
-- source_meta 示例：{"meeting_id":"...","meeting_item_id":"...","row":3}

-- ② Feedback Analysis 加来源标注（标题显示"来自会议《X》"）
alter table feedback_analyses
  add column source_label text;

-- ③ 会议条目加"已转入反馈"标记（防重复转入 + 可追溯角标）
alter table meeting_items
  add column transferred_to_feedback boolean not null default false;

-- ④ 索引：按来源筛选已转入的会议条目
create index idx_meeting_items_transferred
  on meeting_items(meeting_id) where transferred_to_feedback = true;

-- ⑤ 来源注释（不加强约束，保持灵活；应用层约束取值集合）
comment on column feedback_items.source_type is 'paste | file | meeting | batch_import';
