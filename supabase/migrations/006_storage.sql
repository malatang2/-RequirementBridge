-- ============================================================
-- 006_storage.sql
-- Storage Buckets 与策略（对应《数据模型设计文档 v1.1 §7》）
-- ============================================================

-- 会议音频 bucket（私有）
insert into storage.buckets (id, name, public) values ('meeting-audio','meeting-audio', false)
on conflict (id) do nothing;

-- 反馈文件 bucket（私有）
insert into storage.buckets (id, name, public) values ('feedback-files','feedback-files', false)
on conflict (id) do nothing;

-- Storage 策略：仅本人读写本人目录（路径约定：<bucket>/<user_id>/<file>）
create policy "audio_own_rw" on storage.objects
  for all using (bucket_id in ('meeting-audio','feedback-files')
                 and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id in ('meeting-audio','feedback-files')
              and (storage.foldername(name))[1] = auth.uid()::text);
