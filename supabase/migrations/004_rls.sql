-- ============================================================
-- 004_rls.sql
-- RLS 策略（对应《数据模型设计文档 v1.1 §5》）
-- 原则：全表 RLS，策略统一 user_id = auth.uid()
-- ============================================================

-- 开启 RLS
alter table projects             enable row level security;
alter table meetings             enable row level security;
alter table meeting_items        enable row level security;
alter table api_drafts           enable row level security;
alter table api_versions         enable row level security;
alter table feedback_analyses    enable row level security;
alter table feedback_items       enable row level security;
alter table feedback_topics      enable row level security;
alter table requirement_drafts   enable row level security;
alter table export_logs          enable row level security;

-- projects（四策略示例）
create policy "projects_select_own" on projects for select using (user_id = auth.uid());
create policy "projects_insert_own" on projects for insert with check (user_id = auth.uid());
create policy "projects_update_own" on projects for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "projects_delete_own" on projects for delete using (user_id = auth.uid());

-- meetings
create policy "meetings_select_own" on meetings for select using (user_id = auth.uid());
create policy "meetings_insert_own" on meetings for insert with check (user_id = auth.uid());
create policy "meetings_update_own" on meetings for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "meetings_delete_own" on meetings for delete using (user_id = auth.uid());

-- meeting_items
create policy "items_select_own" on meeting_items for select using (user_id = auth.uid());
create policy "items_insert_own" on meeting_items for insert with check (user_id = auth.uid());
create policy "items_update_own" on meeting_items for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "items_delete_own" on meeting_items for delete using (user_id = auth.uid());

-- api_drafts
create policy "api_drafts_select_own" on api_drafts for select using (user_id = auth.uid());
create policy "api_drafts_insert_own" on api_drafts for insert with check (user_id = auth.uid());
create policy "api_drafts_update_own" on api_drafts for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "api_drafts_delete_own" on api_drafts for delete using (user_id = auth.uid());

-- api_versions
create policy "api_versions_select_own" on api_versions for select using (user_id = auth.uid());
create policy "api_versions_insert_own" on api_versions for insert with check (user_id = auth.uid());
create policy "api_versions_update_own" on api_versions for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "api_versions_delete_own" on api_versions for delete using (user_id = auth.uid());

-- feedback_analyses
create policy "fb_analyses_select_own" on feedback_analyses for select using (user_id = auth.uid());
create policy "fb_analyses_insert_own" on feedback_analyses for insert with check (user_id = auth.uid());
create policy "fb_analyses_update_own" on feedback_analyses for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "fb_analyses_delete_own" on feedback_analyses for delete using (user_id = auth.uid());

-- feedback_items
create policy "fb_items_select_own" on feedback_items for select using (user_id = auth.uid());
create policy "fb_items_insert_own" on feedback_items for insert with check (user_id = auth.uid());
create policy "fb_items_update_own" on feedback_items for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "fb_items_delete_own" on feedback_items for delete using (user_id = auth.uid());

-- feedback_topics
create policy "fb_topics_select_own" on feedback_topics for select using (user_id = auth.uid());
create policy "fb_topics_insert_own" on feedback_topics for insert with check (user_id = auth.uid());
create policy "fb_topics_update_own" on feedback_topics for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "fb_topics_delete_own" on feedback_topics for delete using (user_id = auth.uid());

-- requirement_drafts
create policy "req_drafts_select_own" on requirement_drafts for select using (user_id = auth.uid());
create policy "req_drafts_insert_own" on requirement_drafts for insert with check (user_id = auth.uid());
create policy "req_drafts_update_own" on requirement_drafts for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "req_drafts_delete_own" on requirement_drafts for delete using (user_id = auth.uid());

-- export_logs（仅 insert + select）
create policy "export_select_own" on export_logs for select using (user_id = auth.uid());
create policy "export_insert_own" on export_logs for insert with check (user_id = auth.uid());
