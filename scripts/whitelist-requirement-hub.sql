-- ============================================================
-- 09 工单：需求模块（requirement_hub）灰度白名单
-- 用法：把下方邮箱替换为白名单用户，在 Supabase Dashboard →
--       SQL Editor 粘贴执行（服务端执行，绕过 RLS）。
-- 效果：jsonb_set 只置 requirement_hub=true，保留其他 key；
--       回滚 = 把 'true' 改 'false' 再跑一次。
-- ============================================================

update profiles
set feature_flags = jsonb_set(feature_flags, '{requirement_hub}', 'true'::jsonb, true)
where email in (
  '<白名单邮箱1>'
  -- , '<白名单邮箱2>'
);
