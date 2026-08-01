"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createTextMeeting, createAudioMeeting } from "../actions";
import {
  validateAudioFile,
  MAX_AUDIO_BYTES,
  SUPPORTED_AUDIO_EXTS,
} from "@/lib/meetings";
import { createSupabaseClient } from "@/lib/supabase/client";
import { getCurrentProjectIdClient } from "@/lib/current-project-client";
import { track } from "@/lib/analytics";

type Mode = "audio" | "text";

export default function NewMeetingPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("text");
  const [title, setTitle] = useState("");
  const [rawText, setRawText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const projectId = await getCurrentProjectIdClient();
    if (!projectId) {
      setError("请先选择项目");
      return;
    }

    if (!title.trim()) {
      setError("会议标题不能为空");
      return;
    }

    setIsPending(true);

    try {
      if (mode === "text") {
        const result = await createTextMeeting(projectId, { title, rawText });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        await track("meeting_created", { meetingId: result.meetingId, mode: "text" });
        router.push(`/dashboard/meetings/${result.meetingId}`);
      } else {
        // 音频模式：校验 + 直传 Storage + 建记录
        if (!file) {
          setError("请选择音频文件");
          return;
        }
        const check = validateAudioFile({
          name: file.name,
          size: file.size,
          type: file.type,
        });
        if (!check.ok) {
          setError(check.error);
          return;
        }

        // 上传到 Storage
        const supabase = createSupabaseClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        const ext = file.name.split(".").pop()?.toLowerCase() ?? "mp3";
        const path = `${user!.id}/${crypto.randomUUID()}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from("meeting-audio")
          .upload(path, file, { contentType: file.type, upsert: false });

        if (uploadError) {
          setError("音频上传失败，请重试");
          return;
        }

        const result = await createAudioMeeting(projectId, {
          title,
          audioPath: path,
          audioFilename: file.name,
          audioSizeBytes: file.size,
        });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        router.push(`/dashboard/meetings/${result.meetingId}`);
      }
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">新建会议</h1>
        <Link
          href="/dashboard/meetings"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← 返回
        </Link>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-1.5">
          <label htmlFor="title" className="text-sm font-medium">
            会议标题 <span className="text-destructive">*</span>
          </label>
          <input
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            required
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <div className="space-y-2">
          <span className="text-sm font-medium">输入方式</span>
          <div className="flex gap-2">
            {(["text", "audio"] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`rounded-md border px-4 py-1.5 text-sm font-medium ${
                  mode === m
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:bg-accent"
                }`}
              >
                {m === "text" ? "粘贴文本" : "上传音频"}
              </button>
            ))}
          </div>
        </div>

        {mode === "text" ? (
          <div className="space-y-1.5">
            <label htmlFor="rawText" className="text-sm font-medium">
              会议内容 <span className="text-destructive">*</span>
            </label>
            <textarea
              id="rawText"
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              rows={10}
              placeholder="粘贴会议笔记全文，AI 将提取决策/待办/需求/问题..."
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <p className="text-xs text-muted-foreground">
              ⚠️ 内容将发送至阿里云百炼（国内）做 AI 结构化处理
            </p>
          </div>
        ) : (
          <div className="space-y-1.5">
            <label className="text-sm font-medium">音频文件</label>
            <div className="rounded-md border border-dashed border-border p-8 text-center">
              <input
                id="file"
                type="file"
                accept={SUPPORTED_AUDIO_EXTS.map((e) => `.${e}`).join(",")}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="hidden"
              />
              <label htmlFor="file" className="cursor-pointer">
                <div className="text-sm">
                  {file ? (
                    <span className="font-medium text-primary">
                      {file.name}（{(file.size / 1024 / 1024).toFixed(1)}MB）
                    </span>
                  ) : (
                    <span className="text-muted-foreground">
                      点击选择，或拖拽音频到此处
                    </span>
                  )}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  支持 mp3 / wav / m4a，≤ 50MB
                </div>
              </label>
            </div>
            <p className="text-xs text-muted-foreground">
              ⚠️ 音频将发送至阿里云百炼（国内）转写，数据不出境
            </p>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex justify-end gap-2">
          <Link
            href="/dashboard/meetings"
            className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-accent"
          >
            取消
          </Link>
          <button
            type="submit"
            disabled={isPending}
            className="rounded-md bg-primary px-6 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {isPending ? "处理中…" : "开始分析"}
          </button>
        </div>
      </form>
    </div>
  );
}
