-- ============================================================
-- 002_tables.sql
-- 建表（对应《数据模型设计文档 v1.1 §3》）
-- 含 CP0 #1a 五处修复 + 千问字段（asr_task_id / llm_usage）
-- 建表顺序遵循 §9：处理 feedback_topics↔items、api_drafts↔versions 循环依赖
-- ============================================================

-- ---------- profiles（#1a① email 加 unique） ----------
create table profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text not null unique,
  display_name text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
comment on table profiles is '用户扩展信息，注册时由触发器自动创建';

-- ---------- projects ----------
create table projects (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  name              text not null,
  description       text,
  api_spec_context  text,
  archived_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
comment on column projects.api_spec_context is '项目级默认 API 规范上下文，模块二可复用';

-- ---------- meetings（CP0：asr_task_id / llm_usage） ----------
create table meetings (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  project_id        uuid not null references projects(id) on delete cascade,
  title             text not null,
  input_mode        input_mode not null,
  audio_path        text,
  audio_filename    text,
  audio_size_bytes  integer,
  asr_task_id       text,                           -- CP0：Paraformer/fun-asr 异步任务 ID
  raw_text          text,
  summary           text,
  status            task_status not null default 'uploading',
  error_message     text,
  is_edited         boolean not null default false,
  llm_usage         jsonb,                          -- CP0：{asr:{...}, llm:{...}}（原 openai_usage）
  completed_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint meetings_size_limit check (
    audio_size_bytes is null or audio_size_bytes <= 52428800
  )
);
comment on table meetings is '模块一·会议主表，承载转录与结构化的状态流转';

-- ---------- meeting_items ----------
create table meeting_items (
  id           uuid primary key default gen_random_uuid(),
  meeting_id   uuid not null references meetings(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  category     meeting_item_category not null,
  content      text not null,
  assignee     text,
  priority     priority_level not null default 'medium',
  quote        text,
  quote_offset integer,
  is_edited    boolean not null default false,
  is_manual    boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
comment on column meeting_items.quote_offset is '原文引用在转录文本中的字符偏移，用于程序化校验引用可追溯率（验收门槛 ≥90%）';

-- ---------- feedback_analyses（须先于 topics/items 建，二者引用本表） ----------
create table feedback_analyses (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  project_id      uuid not null references projects(id) on delete cascade,
  title           text not null,
  input_mode      input_mode not null,
  source_filename text,
  feedback_column text,
  total_count     integer not null default 0,
  status          task_status not null default 'uploading',
  error_message   text,
  llm_usage       jsonb,                            -- CP0：{llm:{...}}
  completed_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ---------- feedback_topics（引用 feedback_analyses，不带反向引用 items） ----------
create table feedback_topics (
  id              uuid primary key default gen_random_uuid(),
  analysis_id     uuid not null references feedback_analyses(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  name            text not null,
  summary         text,
  frequency       integer not null default 0,
  sentiment       sentiment_label,
  priority        priority_level not null default 'medium',
  sample_feedback jsonb,
  is_edited       boolean not null default false,
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
comment on column feedback_topics.frequency is '频次需与 feedback_items.topic_id 计数严格一致（验收门槛 100%）；合并/删除时触发器同步刷新';

-- ---------- feedback_items（引用 feedback_analyses + topic_id 指向 feedback_topics） ----------
create table feedback_items (
  id           uuid primary key default gen_random_uuid(),
  analysis_id  uuid not null references feedback_analyses(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  content      text not null,
  topic_id     uuid references feedback_topics(id) on delete set null,
  sentiment    sentiment_label,
  created_at   timestamptz not null default now()
);
comment on table feedback_items is '保留原始反馈，支撑频次精确统计（验收门槛 100%）与主题合并/删除联动';

-- ---------- api_drafts（先建，不带 current_version_id 的 FK） ----------
create table api_drafts (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users(id) on delete cascade,
  project_id           uuid not null references projects(id) on delete cascade,
  title                text not null,
  business_requirement text not null,
  api_spec_context     text,
  current_yaml         text,
  current_version_id   uuid,
  status               gen_status not null default 'generating',
  error_message        text,
  is_edited            boolean not null default false,
  llm_usage            jsonb,                       -- CP0：{llm:{...}}（原 openai_usage）
  completed_at         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- ---------- api_versions ----------
create table api_versions (
  id             uuid primary key default gen_random_uuid(),
  draft_id       uuid not null references api_drafts(id) on delete cascade,
  user_id        uuid not null references auth.users(id) on delete cascade,
  version_number integer not null,
  yaml_content   text not null,
  is_auto        boolean not null default false,
  generated_at   timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  unique (draft_id, version_number)
);

-- api_drafts ↔ api_versions 循环依赖后置补 FK
alter table api_drafts
  add constraint api_drafts_current_version_fk
  foreign key (current_version_id) references api_versions(id) on delete set null;

-- ---------- requirement_drafts ----------
create table requirement_drafts (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  project_id      uuid not null references projects(id) on delete cascade,
  source_type     text not null default 'manual',
  source_topic_id uuid references feedback_topics(id) on delete set null,
  title           text not null,
  content         text not null,
  status          gen_status not null default 'completed',
  is_edited       boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
comment on table requirement_drafts is '由反馈主题生成的需求草稿，PM 校对后可手动带入 API 设计器（不自动串联，符合 v1 边界）';

-- ---------- export_logs ----------
create table export_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  module      export_module not null,
  source_id   uuid not null,
  format      export_format not null,
  created_at  timestamptz not null default now()
);
comment on table export_logs is '记录导出行为，支撑"导出外溢"指标与成本分析';
comment on column export_logs.source_id is '多源（meetings/api_drafts/feedback_analyses/requirement_drafts）无单外键，应用层保证有效性；删除不级联（孤儿记录用于成本审计）';
