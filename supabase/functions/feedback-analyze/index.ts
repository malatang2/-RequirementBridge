/**
 * 反馈聚类 Edge Function（M3 / T3.2）。
 * 对应《前后端接口契约 §3.2/§3.5》：Qwen-Plus 主题聚类 + 情感 + 频次 + 优先级 + 样本。
 *
 * 输入（两种模式二选一）：
 *   - 粘贴/文件模式：{ analysisId, items: string[] }
 *   - 会议转入模式（06 工单）：{ analysisId, sourceItems: { content, source_type?, source_meta? }[] }
 *
 * EF 不关心 items 的出身——它把任一模式归一化成 clusterItems: string[] 后送 Qwen 聚类，
 * 再按"analysis_id 下 feedback_items 按 created_at asc 重查"的位置回填 topic_id。
 * 因此调用方必须保证 sourceItems 的顺序与它自己批量插入 feedback_items 的顺序一致
 * （transferMeetingItemsToFeedback action 已保证：两者都按 valid 数组顺序迭代）。
 *
 * 流程：
 *   1) 推导 clusterItems（sourceItems 优先，回退 items）
 *   2) 调 Qwen-Plus 聚类（item_indices 归属）
 *   3) insert feedback_topics（frequency 由触发器同步）
 *   4) update feedback_items.topic_id + sentiment
 *   5) 写 sample_feedback + sort_order
 *   6) status=completed
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { dashscopeChat, corsHeaders } from "../_shared/supabase.ts";

// 会议转入模式（06 工单）传入的条目结构；EF 只用 content，source_* 仅由调用方写库时携带
interface SourceItem {
  content: string;
  source_type?: string;
  source_meta?: Record<string, unknown>;
}

const CLUSTERING_SYSTEM_PROMPT = `你是用户反馈分析专家。对一批用户反馈做主题聚类，输出严格 JSON。

要求：
1. 把语义相近的反馈归为同一主题，每个主题给一个简短中文名 + 一句摘要
2. 每个主题标注整体情感：positive（正面）/ negative（负面）/ neutral（中性）
3. 每个主题标注优先级建议：high（高优，影响大）/ medium / low
4. item_indices：归入该主题的反馈在输入数组中的下标（0-based）
5. 无法归入任何主题的反馈下标放进 unassigned_indices

仅输出 JSON，格式：
{"topics":[{"name":"...","summary":"...","sentiment":"positive|negative|neutral","priority":"high|medium|low","item_indices":[0,1]}],"unassigned_indices":[2]}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const { analysisId, items, sourceItems } = await req.json();
  if (!analysisId) {
    return json({ success: false, error: { code: "VALIDATION_ERROR", message: "缺少 analysisId" } }, 422);
  }

  // 归一化两种入参模式为 clusterItems（送 Qwen 的纯字符串数组）
  // - sourceItems 优先（会议转入模式，06 工单）
  // - 回退 items（粘贴/文件模式）
  // 顺序敏感：调用方保证 sourceItems 顺序 == 它批量插入 feedback_items 的顺序
  let clusterItems: string[];
  if (Array.isArray(sourceItems) && sourceItems.length > 0) {
    clusterItems = sourceItems
      .map((s: SourceItem) => (s && typeof s.content === "string" ? s.content : ""))
      .filter((c: string) => c.trim().length > 0);
  } else if (Array.isArray(items) && items.length > 0) {
    clusterItems = items.filter((c: unknown): c is string => typeof c === "string" && c.trim().length > 0);
  } else {
    clusterItems = [];
  }
  if (clusterItems.length === 0) {
    return json({ success: false, error: { code: "VALIDATION_ERROR", message: "缺少 items 或 sourceItems" } }, 422);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } }
  );

  try {
    // 1. 调 Qwen-Plus 聚类
    // 反馈列表带上编号，便于模型返回 item_indices
    const indexedItems = clusterItems.map((it: string, i: number) => `[${i}] ${it}`).join("\n");
    const { content, tokens } = await dashscopeChat({
      purpose: "cluster",
      messages: [
        { role: "system", content: CLUSTERING_SYSTEM_PROMPT },
        { role: "user", content: `共 ${clusterItems.length} 条反馈，按编号聚类：\n${indexedItems}` },
      ],
      jsonMode: true,
    });

    // 2. 解析
    let parsed: { topics?: any[]; unassigned_indices?: number[] };
    try {
      parsed = JSON.parse(content.replace(/^```json\s*|\s*```$/g, "").trim());
    } catch {
      await markFailed(supabase, analysisId, "AI 输出 JSON 解析失败");
      return json({ success: false, error: { code: "GENERATION_FAILED", message: "AI 输出解析失败" } }, 500);
    }

    // 3. 取 analysis user_id + 已插入的 feedback_items
    const { data: analysis } = await supabase
      .from("feedback_analyses")
      .select("user_id")
      .eq("id", analysisId)
      .single();
    const userId = analysis?.user_id;

    const { data: feedbackItems } = await supabase
      .from("feedback_items")
      .select("id, content")
      .eq("analysis_id", analysisId)
      .order("created_at", { ascending: true });
    const itemRows = feedbackItems ?? [];

    // 4. 建主题 + 回填 items
    const validTopics = (parsed.topics ?? []).filter((t: any) => t.name && t.name.trim());
    // 加上 unassigned 作为"其他"主题（如果有）
    const unassigned = (parsed.unassigned_indices ?? []).filter(
      (i: number) => i >= 0 && i < clusterItems.length
    );

    const topicsToInsert: any[] = [];
    for (const t of validTopics) {
      const indices: number[] = (t.item_indices ?? []).filter(
        (i: number) => i >= 0 && i < clusterItems.length
      );
      if (indices.length === 0) continue;
      topicsToInsert.push({
        analysis_id: analysisId,
        user_id: userId,
        name: t.name.trim(),
        summary: (t.summary ?? "").trim(),
        sentiment: normalizeSentiment(t.sentiment),
        priority: normalizePriority(t.priority),
        frequency: 0, // 触发器同步
        sample_feedback: indices.slice(0, 3).map((i) => clusterItems[i]),
      });
    }
    // "其他"主题
    if (unassigned.length > 0) {
      topicsToInsert.push({
        analysis_id: analysisId,
        user_id: userId,
        name: "其他",
        summary: "未归入明确主题的反馈",
        sentiment: "neutral",
        priority: "low",
        frequency: 0,
        sample_feedback: unassigned.slice(0, 3).map((i) => clusterItems[i]),
      });
      validTopics.push({ name: "其他", item_indices: unassigned, sentiment: "neutral" });
    }

    // 按 frequency（即 item 数）降序排 sort_order
    const topicsWithFreq = topicsToInsert.map((t, idx) => {
      const matching = validTopics[idx];
      const count = matching?.item_indices?.length ?? 0;
      return { ...t, _count: count };
    }).sort((a, b) => b._count - a._count);

    // 插入主题
    const topicIdMap: Record<string, string> = {}; // name -> id
    for (let i = 0; i < topicsWithFreq.length; i++) {
      const t = topicsWithFreq[i];
      const { data: inserted } = await supabase.from("feedback_topics").insert({
        analysis_id: t.analysis_id,
        user_id: t.user_id,
        name: t.name,
        summary: t.summary,
        sentiment: t.sentiment,
        priority: t.priority,
        frequency: t._count, // 直接写，避免触发器时序问题
        sample_feedback: t.sample_feedback,
        is_edited: false,
        sort_order: i,
      }).select().single();
      if (inserted) topicIdMap[t.name] = inserted.id;
    }

    // 回填 feedback_items.topic_id + sentiment
    for (const t of validTopics) {
      const topicId = topicIdMap[t.name.trim()];
      if (!topicId) continue;
      const indices: number[] = (t.item_indices ?? []).filter((i) => i >= 0 && i < itemRows.length);
      for (const idx of indices) {
        const row = itemRows[idx];
        if (row) {
          await supabase.from("feedback_items").update({
            topic_id: topicId,
            sentiment: normalizeSentiment(t.sentiment),
          }).eq("id", row.id);
        }
      }
    }

    // 5. 完成
    await supabase.from("feedback_analyses").update({
      status: "completed",
      llm_usage: { llm: { model: "qwen-plus", tokens } },
      completed_at: new Date().toISOString(),
    }).eq("id", analysisId);

    return json({ success: true, data: { analysisId, topicCount: topicsWithFreq.length } });
  } catch (e) {
    const msg = (e as Error).message;
    await markFailed(supabase, analysisId, msg);
    return json({ success: false, error: { code: mapErrorCode(msg), message: msg } }, 500);
  }
});

function normalizeSentiment(raw?: string): string {
  const s = (raw ?? "").toLowerCase().trim();
  const map: Record<string, string> = {
    positive: "positive", 正面: "positive", 积极: "positive",
    negative: "negative", 负面: "negative", 消极: "negative",
    neutral: "neutral", 中性: "neutral", 中立: "neutral",
  };
  return map[s] ?? "neutral";
}

function normalizePriority(raw?: string): string {
  const p = (raw ?? "").toLowerCase().trim();
  if (p.startsWith("high") || p === "高" || p === "高优") return "high";
  if (p.startsWith("low") || p === "低") return "low";
  return "medium";
}

async function markFailed(supabase: any, analysisId: string, msg: string) {
  await supabase.from("feedback_analyses").update({ status: "failed", error_message: msg }).eq("id", analysisId);
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function mapErrorCode(msg: string): string {
  if (msg.includes("RATE_LIMIT")) return "LLM_RATE_LIMIT";
  if (msg.includes("auth")) return "LLM_ERROR";
  if (msg.includes("empty") || msg.includes("GENERATION")) return "GENERATION_FAILED";
  return "INTERNAL_ERROR";
}
