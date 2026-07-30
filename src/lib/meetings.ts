/**
 * 会议模块服务层（M1）。
 *
 * 设计（mattpocock TDD）：可测纯逻辑 seam 与 Edge Function / DB 调用分离。
 * - validateMeetingInput / parseExtractionResponse / computeQuoteOffset /
 *   groupItemsByCategory 是纯函数（seam），可单测。
 * - Edge Function（转录/提取）与 DB 操作是框架集成 seam，靠集成测试。
 *
 * 对应《前后端接口契约 §1.5》Qwen 提取输出 Schema + 后处理。
 */

import type {
  MeetingItemCategory,
  PriorityLevel,
} from "@/types/database";

/** 合法的条目分类与优先级（与 Edge Function 提取约束一致） */
const VALID_CATEGORIES: MeetingItemCategory[] = [
  "decision",
  "todo",
  "requirement",
  "issue",
];
const VALID_PRIORITIES: PriorityLevel[] = ["high", "medium", "low"];

/** 音频约束（需求清单 §4.1 / 接口契约 §0.3） */
export const MAX_AUDIO_BYTES = 50 * 1024 * 1024; // 50MB
export const SUPPORTED_AUDIO_TYPES = ["audio/mpeg", "audio/wav", "audio/x-wav", "audio/mp4", "audio/x-m4a", "audio/m4a"];
export const SUPPORTED_AUDIO_EXTS = ["mp3", "wav", "m4a"];

// ============ seam 1：会议输入校验 ============

export type MeetingInputValidation =
  | { ok: true; title: string; rawText: string; mode: "text" }
  | { ok: true; title: string; mode: "audio"; file: { name: string; size: number; type: string } }
  | { ok: false; error: string };

/** 校验会议标题 */
export function validateTitle(title: unknown): string | null {
  const t = typeof title === "string" ? title.trim() : "";
  if (!t) return null;
  if (t.length > 200) return null;
  return t;
}

/** 校验音频文件（纯函数 seam，前端上传前拦截） */
export function validateAudioFile(file: {
  name: string;
  size: number;
  type: string;
}): { ok: true } | { ok: false; error: string } {
  if (file.size > MAX_AUDIO_BYTES) {
    return { ok: false, error: `音频超过 50MB 限制（当前 ${(file.size / 1024 / 1024).toFixed(1)}MB）` };
  }
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const typeOk = SUPPORTED_AUDIO_TYPES.includes(file.type);
  const extOk = SUPPORTED_AUDIO_EXTS.includes(ext);
  // 宽容判断：type 或 ext 任一匹配即可（部分浏览器 audio/mpeg3 等怪异 type）
  if (!typeOk && !extOk) {
    return { ok: false, error: `仅支持 mp3/wav/m4a（当前 .${ext || "?"}）` };
  }
  return { ok: true };
}

/** 校验文本模式输入 */
export function validateTextMeetingInput(input: {
  title?: unknown;
  rawText?: unknown;
}): MeetingInputValidation {
  const title = validateTitle(input.title);
  if (!title) return { ok: false, error: "会议标题不能为空" };

  const rawText = typeof input.rawText === "string" ? input.rawText.trim() : "";
  if (!rawText) return { ok: false, error: "会议内容不能为空" };
  if (rawText.length < 10) return { ok: false, error: "会议内容过短（至少 10 字）" };

  return { ok: true, title, rawText, mode: "text" };
}

// ============ seam 2：Qwen 提取响应解析 + 后处理 ============

/** Qwen 提取返回的单条原始结构（接口契约 §1.5） */
export interface RawExtractedItem {
  category?: string;
  content?: string;
  assignee?: string | null;
  priority?: string;
  quote?: string | null;
}

export interface RawExtractionResult {
  summary?: string;
  items?: RawExtractedItem[];
}

/** 解析后的规范条目 */
export interface ParsedMeetingItem {
  category: MeetingItemCategory;
  content: string;
  assignee: string | null;
  priority: PriorityLevel;
  quote: string | null;
  quoteOffset: number | null;
}

/** 把 Qwen 返回的 category/priority 归一化为合法枚举值 */
export function normalizeCategory(raw?: string): MeetingItemCategory {
  const c = (raw ?? "").toLowerCase().trim();
  // 容忍中英文变体
  const map: Record<string, MeetingItemCategory> = {
    decision: "decision",
    决策: "decision",
    todo: "todo",
    待办: "todo",
    任务: "todo",
    requirement: "requirement",
    需求: "requirement",
    issue: "issue",
    问题: "issue",
    遗留问题: "issue",
  };
  return map[c] ?? "issue"; // 无法归类默认落"问题"
}

export function normalizePriority(raw?: string): PriorityLevel {
  const p = (raw ?? "").toLowerCase().trim();
  if (p.startsWith("high") || p === "高" || p === "高优") return "high";
  if (p.startsWith("low") || p === "低") return "low";
  return "medium";
}

/**
 * 计算 quote 在 raw_text 中的字符偏移（纯函数 seam）。
 * 对应"原文引用可追溯率 ≥90%"验收——引用必须真实来自输入文本。
 * 找不到则返回 null（Edge Function 记日志）。
 */
export function computeQuoteOffset(
  quote: string | null | undefined,
  rawText: string
): number | null {
  if (!quote) return null;
  const q = quote.trim();
  if (!q) return null;
  const idx = rawText.indexOf(q);
  return idx >= 0 ? idx : null;
}

/** 解析 Qwen 提取响应为规范条目（纯函数 seam） */
export function parseExtractionResponse(
  raw: RawExtractionResult,
  rawText: string
): { summary: string; items: ParsedMeetingItem[] } {
  const summary = (raw.summary ?? "").trim() || "（未生成摘要）";

  const items: ParsedMeetingItem[] = (raw.items ?? [])
    .filter((it) => typeof it.content === "string" && it.content.trim())
    .map((it) => {
      const quote = it.quote?.trim() || null;
      return {
        category: normalizeCategory(it.category),
        content: it.content!.trim(),
        assignee: it.assignee?.trim() || null,
        priority: normalizePriority(it.priority),
        quote,
        quoteOffset: computeQuoteOffset(quote, rawText),
      };
    });

  return { summary, items };
}

// ============ seam 3：条目按四类分组（详情页展示用）============

export const CATEGORY_LABELS: Record<MeetingItemCategory, string> = {
  decision: "决策",
  todo: "待办",
  requirement: "需求",
  issue: "遗留问题",
};

export const CATEGORY_ORDER: MeetingItemCategory[] = [
  "decision",
  "todo",
  "requirement",
  "issue",
];

export interface ParsedMeetingItemWithId extends ParsedMeetingItem {
  id: string;
}

/** 把条目按四类分组（纯函数 seam，详情页用） */
export function groupItemsByCategory<T extends { category: MeetingItemCategory }>(
  items: T[]
): Record<MeetingItemCategory, T[]> {
  const grouped: Record<MeetingItemCategory, T[]> = {
    decision: [],
    todo: [],
    requirement: [],
    issue: [],
  };
  for (const it of items) {
    if (VALID_CATEGORIES.includes(it.category)) {
      grouped[it.category].push(it);
    }
  }
  return grouped;
}

// ============ seam 4：导出（T1.6）============

/** 导出输入数据（与 DB 行解耦，纯函数易测） */
export interface MeetingExportData {
  title: string;
  summary: string | null;
  items: ParsedMeetingItemWithId[];
  createdAt: string;
}

const PRIORITY_LABEL: Record<PriorityLevel, string> = {
  high: "高优",
  medium: "中",
  low: "低",
};

/** 转义 CSV 字段（含逗号/引号/换行需加引号并把内部引号翻倍） */
export function escapeCsvField(value: string | null): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * 生成会议导出 Markdown（纯函数 seam）。
 * 结构：标题 + 元信息 + 摘要 + 四类分组（每条含负责人/优先级/原文引用）。
 */
export function exportMeetingToMarkdown(data: MeetingExportData): string {
  const lines: string[] = [];
  lines.push(`# ${data.title}`);
  lines.push("");
  lines.push(`> 日期：${new Date(data.createdAt).toLocaleString("zh-CN")}`);
  lines.push("");

  if (data.summary) {
    lines.push("## 摘要");
    lines.push("");
    lines.push(data.summary);
    lines.push("");
  }

  const grouped = groupItemsByCategory(data.items);
  for (const cat of CATEGORY_ORDER) {
    const list = grouped[cat];
    if (list.length === 0) continue;
    lines.push(`## ${CATEGORY_LABELS[cat]}（${list.length}）`);
    lines.push("");
    for (const it of list) {
      const meta = [
        it.assignee ? `@${it.assignee}` : "@待分配",
        `[${PRIORITY_LABEL[it.priority]}]`,
      ].join(" ");
      lines.push(`- **${it.content}** ${meta}`);
      if (it.quote) {
        lines.push(`  - > ${it.quote}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd() + "\n";
}

/**
 * 生成会议导出 CSV（纯函数 seam）。
 * 列：分类,内容,负责人,优先级,原文引用。
 */
export function exportMeetingToCsv(data: MeetingExportData): string {
  const header = ["分类", "内容", "负责人", "优先级", "原文引用"]
    .map(escapeCsvField)
    .join(",");
  const rows = data.items.map((it) =>
    [
      CATEGORY_LABELS[it.category],
      it.content,
      it.assignee ?? "",
      PRIORITY_LABEL[it.priority],
      it.quote ?? "",
    ]
      .map(escapeCsvField)
      .join(",")
  );
  // BOM 让 Excel 正确识别 UTF-8
  return "\uFEFF" + [header, ...rows].join("\r\n") + "\r\n";
}


export { VALID_CATEGORIES, VALID_PRIORITIES };
