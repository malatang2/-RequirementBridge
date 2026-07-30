/**
 * 会议音频转录 Edge Function（M1 / T1.2）。
 * 对应《前后端接口契约 §1.2》：fun-asr/Paraformer 录音文件异步转写。
 *
 * 输入：{ meetingId }
 * 流程：
 *   1) 取会议记录的 audio_path + 生成签名 URL
 *   2) 调 DashScope Paraformer 异步转写（提交任务 → 轮询 → 取结果）
 *   3) 写 raw_text + asr_task_id，status=analyzing
 *   4) 调用 meeting-extract 继续结构化提取（同进程 fetch）
 *
 * DashScope 录音文件识别 API（paraformer-v2）：
 *   POST https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription
 *   header: Authorization Bearer <key>, X-DashScope-Async enable
 *   提交任务返回 task_id → GET .../tasks/<task_id> 轮询 → SUCCEEDED 后取 results
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/supabase.ts";

const DASHSCOPE_API = "https://dashscope.aliyuncs.com/api/v1";
const DASHSCOPE_BASE = Deno.env.get("DASHSCOPE_BASE_URL") ??
  "https://dashscope.aliyuncs.com/compatible-mode/v1";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const { meetingId } = await req.json();
  if (!meetingId) {
    return json({ success: false, error: { code: "VALIDATION_ERROR", message: "缺少 meetingId" } }, 422);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } }
  );

  try {
    // 1. 取会议记录 + 音频签名 URL
    const { data: meeting } = await supabase
      .from("meetings")
      .select("audio_path, user_id")
      .eq("id", meetingId)
      .single();

    if (!meeting?.audio_path) {
      await markFailed(supabase, meetingId, "缺少音频文件");
      return json({ success: false, error: { code: "VALIDATION_ERROR", message: "缺少音频文件" } }, 422);
    }

    const { data: urlData } = await supabase.storage
      .from("meeting-audio")
      .createSignedUrl(meeting.audio_path, 3600);

    const fileUrl = urlData?.signedUrl;
    if (!fileUrl) {
      await markFailed(supabase, meetingId, "生成音频访问 URL 失败");
      return json({ success: false, error: { code: "INTERNAL_ERROR", message: "音频 URL 失败" } }, 500);
    }

    // 2. 提交 Paraformer 转写任务
    const taskId = await submitAsrTask(fileUrl);
    await supabase.from("meetings").update({ asr_task_id: taskId }).eq("id", meetingId);

    // 3. 轮询任务状态（最长 ~3 分钟）
    const transcript = await pollAsrTask(taskId);

    // 4. 写 raw_text，status=analyzing
    await supabase.from("meetings").update({
      raw_text: transcript,
      status: "analyzing",
    }).eq("id", meetingId);

    // 5. 继续结构化提取（同进程调用，复用 service role）
    const extractRes = await fetch(`${DENO_BASE_URL()}/functions/v1/meeting-extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: req.headers.get("Authorization") ?? "" },
      body: JSON.stringify({ meetingId, text: transcript }),
    });

    if (!extractRes.ok) {
      await markFailed(supabase, meetingId, "结构化提取失败");
    }

    return json({ success: true, data: { meetingId, transcriptLength: transcript.length } });
  } catch (e) {
    const msg = (e as Error).message;
    await markFailed(supabase, meetingId, msg);
    return json({ success: false, error: { code: mapAsrError(msg), message: msg } }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function DENO_BASE_URL() {
  // Edge Function 同项目内互调的项目 URL
  return Deno.env.get("SUPABASE_URL") ?? "";
}

async function submitAsrTask(fileUrl: string): Promise<string> {
  const apiKey = Deno.env.get("DASHSCOPE_API_KEY") ?? "";
  const res = await fetch(`${DASHSCOPE_API}/services/audio/asr/transcription`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "X-DashScope-Async": "enable",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "paraformer-v2",
      input: { file_urls: [fileUrl] },
      parameters: { language_hints: ["zh", "en"] },
    }),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`ASR_SUBMIT_${res.status}:${t.slice(0, 100)}`);
  }
  const data = await res.json();
  const taskId = data?.output?.task_id;
  if (!taskId) throw new Error("ASR_SUBMIT:no_task_id");
  return taskId;
}

async function pollAsrTask(taskId: string): Promise<string> {
  const apiKey = Deno.env.get("DASHSCOPE_API_KEY") ?? "";
  const maxAttempts = 60; // ~3 分钟（每 3s 一次）
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const res = await fetch(`${DASHSCOPE_API}/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) continue;
    const data = await res.json();
    const status = data?.output?.task_status;
    if (status === "SUCCEEDED") {
      // 取第一个结果的 transcription_url
      const resultUrl = data?.output?.results?.[0]?.transcription_url;
      if (!resultUrl) throw new Error("ASR_RESULT:no_transcription");
      const r = await fetch(resultUrl);
      const transcriptData = await r.json();
      // Paraformer 返回结构：transcripts[].text 拼接
      const transcripts = transcriptData?.transcripts ?? [];
      return transcripts.map((t: any) => t.text ?? "").join("\n").trim() || transcriptData?.text || "";
    }
    if (status === "FAILED") {
      throw new Error("ASR_TASK_FAILED");
    }
    // PENDING / RUNNING → 继续轮询
  }
  throw new Error("ASR_TIMEOUT");
}

async function markFailed(supabase: any, meetingId: string, msg: string) {
  await supabase.from("meetings").update({
    status: "failed",
    error_message: msg,
  }).eq("id", meetingId);
}

function mapAsrError(msg: string): string {
  if (msg.includes("TIMEOUT")) return "LLM_TIMEOUT";
  if (msg.includes("FAILED")) return "GENERATION_FAILED";
  return "INTERNAL_ERROR";
}
