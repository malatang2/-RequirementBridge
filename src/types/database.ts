/**
 * 数据库类型骨架（对应《数据模型设计文档 v1.1》）。
 * 后续接入 Supabase CLI 生成精确类型（supabase gen types typescript），
 * 本文件为开发期占位，确保模块开发有类型依据。
 */

export type TaskStatus =
  | "uploading"
  | "transcribing"
  | "analyzing"
  | "completed"
  | "failed";

export type GenStatus = "generating" | "completed" | "failed";

/**
 * Requirement 生命周期（对应 requirement_lifecycle 枚举，007 迁移）。
 * 与 GenStatus 并存：GenStatus 表征 AI 任务态（generating/completed/failed），
 * RequirementLifecycle 接管业务态。
 */
export type RequirementLifecycle =
  | "draft"
  | "confirmed"
  | "in_progress"
  | "delivered"
  | "parked";

export type MeetingItemCategory = "decision" | "todo" | "requirement" | "issue";
export type PriorityLevel = "high" | "medium" | "low";
export type SentimentLabel = "positive" | "negative" | "neutral";
export type InputMode = "audio" | "text" | "paste" | "file";
export type ExportFormat = "md" | "csv" | "yaml" | "json" | "png";
export type ExportModule = "meeting" | "api" | "feedback" | "requirement";

export interface Profile {
  id: string; // = auth.users.id（注册触发器自动建行）
  email: string;
  display_name: string | null;
  feature_flags: Record<string, unknown>; // 007：灰度开关（requirement_hub 等，见 src/lib/feature-flags.ts）
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  api_spec_context: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Meeting {
  id: string;
  user_id: string;
  project_id: string;
  title: string;
  input_mode: InputMode;
  audio_path: string | null;
  audio_filename: string | null;
  audio_size_bytes: number | null;
  asr_task_id: string | null; // CP0：Paraformer 任务 ID
  raw_text: string | null;
  summary: string | null;
  status: TaskStatus;
  error_message: string | null;
  is_edited: boolean;
  llm_usage: { asr?: unknown; llm?: unknown } | null; // CP0：原 openai_usage
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MeetingItem {
  id: string;
  meeting_id: string;
  user_id: string;
  category: MeetingItemCategory;
  content: string;
  assignee: string | null;
  priority: PriorityLevel;
  quote: string | null;
  quote_offset: number | null;
  is_edited: boolean;
  is_manual: boolean;
  transferred_to_feedback: boolean; // 008：会议条目转入反馈标记（防重复转入 + 角标）
  created_at: string;
  updated_at: string;
}

export interface ApiDraft {
  id: string;
  user_id: string;
  project_id: string;
  title: string;
  business_requirement: string;
  api_spec_context: string | null;
  current_yaml: string | null;
  current_version_id: string | null;
  status: GenStatus;
  error_message: string | null;
  is_edited: boolean;
  source_requirement_id: string | null; // 007：需求→API 一键带入的来源 Requirement（null=未关联）
  llm_usage: { llm?: unknown } | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApiVersion {
  id: string;
  draft_id: string;
  user_id: string;
  version_number: number;
  yaml_content: string;
  is_auto: boolean;
  generated_at: string;
  created_at: string;
}

export interface FeedbackAnalysis {
  id: string;
  user_id: string;
  project_id: string;
  title: string;
  input_mode: InputMode;
  source_filename: string | null;
  feedback_column: string | null;
  total_count: number;
  status: TaskStatus;
  error_message: string | null;
  llm_usage: { llm?: unknown } | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  source_label: string | null; // 008：来源标注（如"来自会议《X》"）
}

export interface FeedbackItem {
  id: string;
  analysis_id: string;
  user_id: string;
  content: string;
  topic_id: string | null;
  sentiment: SentimentLabel | null;
  created_at: string;
  source_type: string; // 008：来源类型（paste | file | meeting | batch_import），默认 'paste'
  source_meta: Record<string, unknown> | null; // 008：出身溯源（如 {meeting_id, meeting_item_id}），非同步契约
}

export interface FeedbackTopic {
  id: string;
  analysis_id: string;
  user_id: string;
  name: string;
  summary: string | null;
  frequency: number;
  sentiment: SentimentLabel | null;
  priority: PriorityLevel;
  sample_feedback: string[] | null;
  is_edited: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface RequirementDraft {
  id: string;
  user_id: string;
  project_id: string;
  source_type: string; // 'feedback_topic' | 'meeting_item' | 'manual'（应用层约束）
  source_topic_id: string | null;
  source_meeting_item_id: string | null; // 007：来自会议条目（source_type='meeting_item' 时非空）
  title: string;
  content: string;
  status: GenStatus; // AI 任务态（generating/completed/failed），保留不动
  priority: PriorityLevel; // 007：优先级，默认 'medium'
  lifecycle: RequirementLifecycle; // 007：业务生命周期，默认 'draft'（与 status 并存）
  is_edited: boolean;
  deleted_at: string | null; // 007：软删（null=未删）
  created_at: string;
  updated_at: string;
}
