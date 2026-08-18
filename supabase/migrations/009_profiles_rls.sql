-- ============================================================
-- 009_profiles_rls.sql
-- 补漏：profiles 表开启 RLS（09 工单发现）。
--
-- 背景：002 建表、004 全表 RLS 时均遗漏 profiles（004 注释声称
-- "全表 RLS"，实际 profiles 未 enable）。该表含 email 与 007 的
-- feature_flags——RLS 关闭意味着持有 anon key 即可经 PostgREST
-- 读取全部用户资料，属上线前必须修复的暴露面。
--
-- 影响：fn_handle_new_user（security definer）不受影响，注册建行照常；
--       白名单 update 走 SQL Editor / service_role（bypass RLS），不受影响；
--       应用侧 loadFeatureFlags 以自身会话读自己一行，select own 策略放行。
-- ============================================================

alter table profiles enable row level security;

create policy "profiles_select_own" on profiles
  for select using (id = auth.uid());
