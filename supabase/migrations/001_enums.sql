-- ============================================================
-- 001_enums.sql
-- 枚举类型定义（对应《数据模型设计文档 v1.1 §2》）
-- ============================================================

-- 通用状态机（长任务）
create type task_status as enum (
  'uploading',    -- 上传中（音频/文件）
  'transcribing', -- 语音转写中（fun-asr/Paraformer，仅会议模块）
  'analyzing',    -- LLM 分析中（Qwen）
  'completed',    -- 完成
  'failed'        -- 失败（含 A2.3 超时僵尸态自动落 failed）
);

-- 简化状态机（API 草稿 / 需求草稿，无转写环节）
create type gen_status as enum (
  'generating',
  'completed',
  'failed'
);

-- 会议条目分类（需求清单 §4.1：决策/待办/需求/问题）
create type meeting_item_category as enum (
  'decision',    -- 决策
  'todo',        -- 待办
  'requirement', -- 需求
  'issue'        -- 遗留问题
);

-- 优先级
create type priority_level as enum (
  'high',
  'medium',
  'low'
);

-- 情感（需求清单 §4.3：正/负/中）
create type sentiment_label as enum (
  'positive',
  'negative',
  'neutral'
);

-- 输入方式
create type input_mode as enum (
  'audio',  -- 会议：音频
  'text',   -- 会议：粘贴文本
  'paste',  -- 反馈：粘贴
  'file'    -- 反馈：上传文件
);

-- 导出格式与模块
create type export_format as enum ('md', 'csv', 'yaml', 'json', 'png');
create type export_module as enum ('meeting', 'api', 'feedback', 'requirement');
