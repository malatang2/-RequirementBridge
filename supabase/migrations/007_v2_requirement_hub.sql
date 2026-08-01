-- ============================================================
-- 007_v2_requirement_hub.sql
-- v2 Phase 1：需求模块升级为统一中枢（数据地基）
-- 策略：additive change——加字段不删字段，不破坏 v1 既有功能
-- 可回滚：drop 新增字段/约束/枚举即可
-- ============================================================

-- ① 新增 Requirement 生命周期枚举
--    不复用 gen_status（那是 AI 任务的 generating/completed/failed 语义），
--    lifecycle 接管业务状态语义；两字段并存。
create type requirement_lifecycle as enum (
  'draft',       -- Requirement Draft：已生成但尚未人关确认（draft 生命周期）
  'confirmed',   -- 已确认纳入需求池（Confirm 关卡，人工把关）
  'in_progress', -- 进行中（已带入 API 设计 / 开发中）
  'delivered',   -- 已交付
  'parked'       -- 搁置
);

-- ② Requirement Draft 表扩展（requirement_drafts 是统一中枢的本体）
alter table requirement_drafts
  add column priority              priority_level       not null default 'medium',
  add column lifecycle             requirement_lifecycle not null default 'draft',
  add column source_meeting_item_id uuid references meeting_items(id) on delete set null,
  add column deleted_at            timestamptz;
-- source_type 保持 text（v1 已是 text，不转 enum，避免 alter type 重写全表）。
-- 应用层约束取值集合：'feedback_topic' | 'meeting_item' | 'manual'

-- ③ 保守回填：老数据统一置 lifecycle='draft'，强制 PM 走查（Confirm 关卡）
--    不自动置 'confirmed'，避免把未把关的散点当 backlog。
--    not null + default 已让新写入为 'draft'；此句仅兜底迁移执行瞬间已存在的行。
update requirement_drafts set lifecycle = 'draft' where lifecycle is null;

-- ④ 来源一致性约束：source_type 与来源外键必须匹配
--    feedback_topic ↔ source_topic_id；meeting_item ↔ source_meeting_item_id；manual 无来源
--    末条兜底老数据（source_type 取未知值时不阻断，保持 additive）
alter table requirement_drafts
  add constraint chk_requirement_source_consistency check (
    (source_type = 'feedback_topic' and source_topic_id is not null)
    or (source_type = 'meeting_item' and source_meeting_item_id is not null)
    or (source_type = 'manual')
    or (source_type not in ('feedback_topic', 'meeting_item', 'manual'))
  );

-- ⑤ 软删索引：列表默认不展示已删，但保留外键完整性
create index idx_requirement_drafts_project_active
  on requirement_drafts(project_id, lifecycle, priority)
  where deleted_at is null;

-- ⑥ API 草稿加来源 Requirement 关联（功能 1.3：需求→API 一键带入）
alter table api_drafts
  add column source_requirement_id uuid references requirement_drafts(id) on delete set null;
create index idx_api_drafts_requirement
  on api_drafts(source_requirement_id) where source_requirement_id is not null;

-- ⑦ 修复 v1 K-1：DB 层拒绝空项目名（前端已拦截，DB 兜底防绕过）
alter table projects
  add constraint projects_name_not_blank check (length(btrim(name)) > 0);

-- ⑧ 灰度开关（feature_flags）：Phase 1 灰度白名单的承载字段
alter table profiles
  add column feature_flags jsonb not null default '{}'::jsonb;

-- ⑨ 触发器：fn_set_updated_at 已挂在 requirement_drafts（005_triggers.sql），
--    deleted_at 变更走 before update 触发器自动刷 updated_at，无需额外加触发器。

-- ⑩ RLS：新字段无需额外 policy，行级归属不变（仍是 user_id = auth.uid()）。
