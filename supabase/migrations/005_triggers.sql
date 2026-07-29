-- ============================================================
-- 005_triggers.sql
-- 触发器与函数（对应《数据模型设计文档 v1.1 §6》）
-- 含 CP0 #1a② 频次同步触发器修复（跨主题 UPDATE 同时刷 old+new）
-- 含 CP0 #1a③ 编辑联动扩展（改/增/删 三类）
-- ============================================================

-- ---------- 6.1 updated_at 自动维护 ----------
create or replace function fn_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;

create trigger trg_profiles_updated     before update on profiles           for each row execute function fn_set_updated_at();
create trigger trg_projects_updated     before update on projects           for each row execute function fn_set_updated_at();
create trigger trg_meetings_updated     before update on meetings           for each row execute function fn_set_updated_at();
create trigger trg_items_updated        before update on meeting_items      for each row execute function fn_set_updated_at();
create trigger trg_api_drafts_updated   before update on api_drafts         for each row execute function fn_set_updated_at();
create trigger trg_fb_analyses_updated  before update on feedback_analyses  for each row execute function fn_set_updated_at();
create trigger trg_fb_topics_updated    before update on feedback_topics    for each row execute function fn_set_updated_at();
create trigger trg_req_drafts_updated   before update on requirement_drafts for each row execute function fn_set_updated_at();

-- ---------- 6.2 注册时自动建 profile ----------
create or replace function fn_handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email,'@',1)));
  return new;
end; $$;

create trigger trg_on_auth_user_created
  after insert on auth.users
  for each row execute function fn_handle_new_user();

-- ---------- 6.3 频次一致性（#1a② 修复版） ----------
-- 原实现 coalesce(new.topic_id, old.topic_id) 在跨主题 UPDATE 时只刷 new，
-- 导致 old 主题计数虚高，违反"频次 100%"验收。
-- 修复：INSERT→刷 new；UPDATE→同时刷 old（若变化）和 new；DELETE→刷 old。
create or replace function fn_sync_topic_frequency()
returns trigger language plpgsql as $$
declare
  old_topic uuid := case when (tg_op = 'UPDATE' or tg_op = 'DELETE') then old.topic_id else null end;
  new_topic uuid := case when (tg_op = 'UPDATE' or tg_op = 'INSERT') then new.topic_id else null end;
begin
  if old_topic is not null and old_topic is distinct from new_topic then
    update feedback_topics
       set frequency = (select count(*) from feedback_items where topic_id = old_topic)
     where id = old_topic;
  end if;
  if new_topic is not null then
    update feedback_topics
       set frequency = (select count(*) from feedback_items where topic_id = new_topic)
     where id = new_topic;
  end if;
  return coalesce(new, old);
end; $$;

create trigger trg_sync_topic_freq
  after insert or update of topic_id or delete
  on feedback_items
  for each row execute function fn_sync_topic_frequency();

-- ---------- 6.4 编辑标记联动（#1a③ + F9 PM 口径：改/增/删 三类） ----------
-- is_edited 含 改/增/删 三类人工干预：
--   INSERT 仅 is_manual=true 触发（AI 批量写入 is_manual=false 不触发）
--   UPDATE content/assignee/priority/category 任一列变更即触发
--   DELETE 一律触发
create or replace function fn_mark_meeting_edited()
returns trigger language plpgsql as $$
declare
  m_id uuid;
begin
  m_id := coalesce(new.meeting_id, old.meeting_id);
  if m_id is not null then
    update meetings set is_edited = true where id = m_id;
  end if;
  return coalesce(new, old);
end; $$;

create trigger trg_mark_meeting_edited_update
  after update of content, assignee, priority, category on meeting_items
  for each row execute function fn_mark_meeting_edited();

create trigger trg_mark_meeting_edited_insert
  after insert on meeting_items
  for each row when (new.is_manual = true)
  execute function fn_mark_meeting_edited();

create trigger trg_mark_meeting_edited_delete
  after delete on meeting_items
  for each row execute function fn_mark_meeting_edited();
