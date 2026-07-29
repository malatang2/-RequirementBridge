-- ============================================================
-- 003_indexes.sql
-- 索引（对应《数据模型设计文档 v1.1 §4》）
-- ============================================================

-- profiles：email 已是 unique，自动建唯一索引

create index idx_projects_user on projects(user_id) where archived_at is null;

create index idx_meetings_project on meetings(project_id, created_at desc);
create index idx_meetings_user_status on meetings(user_id, status) where status in ('uploading','transcribing','analyzing');
create index idx_meetings_project_status on meetings(project_id, status);
create index idx_meetings_asr_task on meetings(asr_task_id) where asr_task_id is not null; -- CP0：Paraformer 任务续查

create index idx_items_meeting on meeting_items(meeting_id, category);
create index idx_items_user on meeting_items(user_id);

create index idx_api_drafts_project on api_drafts(project_id, created_at desc);
create index idx_api_versions_draft on api_versions(draft_id, version_number desc);

create index idx_feedback_analyses_project on feedback_analyses(project_id, created_at desc);
create index idx_feedback_items_analysis on feedback_items(analysis_id);
create index idx_feedback_items_topic on feedback_items(topic_id);
create index idx_feedback_topics_analysis_freq on feedback_topics(analysis_id, frequency desc);

create index idx_requirement_drafts_project on requirement_drafts(project_id, created_at desc);

create index idx_export_logs_user_time on export_logs(user_id, created_at desc);
