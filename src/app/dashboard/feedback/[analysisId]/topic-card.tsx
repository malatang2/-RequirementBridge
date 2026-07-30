"use client";

import { useState, useTransition } from "react";
import { mergeTopics, deleteTopic, updateTopic } from "../actions";
import type { FeedbackTopic } from "@/types/database";
import { cn } from "@/lib/utils";

interface Props {
  topic: FeedbackTopic;
  analysisId: string;
  allTopics: FeedbackTopic[];
}

const SENTIMENT_META: Record<string, { label: string; color: string }> = {
  positive: { label: "正面", color: "text-green-600 bg-green-500/10" },
  negative: { label: "负面", color: "text-red-600 bg-red-500/10" },
  neutral: { label: "中性", color: "text-muted-foreground bg-muted" },
};

const PRIORITY_META: Record<string, { label: string; dot: string }> = {
  high: { label: "高优", dot: "bg-red-500" },
  medium: { label: "中", dot: "bg-amber-500" },
  low: { label: "低", dot: "bg-slate-400" },
};

export function TopicCard({ topic, analysisId, allTopics }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [mergeTarget, setMergeTarget] = useState<string>("");
  const [name, setName] = useState(topic.name);
  const [priority, setPriority] = useState(topic.priority);
  const [isPending, startTransition] = useTransition();

  const sentMeta = SENTIMENT_META[topic.sentiment ?? "neutral"];
  const priMeta = PRIORITY_META[topic.priority];
  const samples: string[] = Array.isArray(topic.sample_feedback) ? topic.sample_feedback : [];

  const otherTopics = allTopics.filter((t) => t.id !== topic.id);

  function handleMerge() {
    if (!mergeTarget) return;
    if (!confirm(`确认把「${topic.name}」合并到「${allTopics.find(t => t.id === mergeTarget)?.name}」？`)) return;
    startTransition(async () => {
      await mergeTopics(analysisId, topic.id, mergeTarget);
    });
  }

  function handleDelete() {
    if (!confirm(`确认删除主题「${topic.name}」？其下反馈将变为未归类。`)) return;
    startTransition(async () => {
      await deleteTopic(topic.id);
    });
  }

  function handleSave() {
    startTransition(async () => {
      await updateTopic(topic.id, { name, priority });
      setEditing(false);
    });
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          {editing ? (
            <div className="flex gap-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="flex-1 rounded-md border border-input bg-background px-2 py-1 text-sm"
              />
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as typeof priority)}
                className="rounded-md border border-input bg-background px-2 py-1 text-xs"
              >
                <option value="high">高优</option>
                <option value="medium">中</option>
                <option value="low">低</option>
              </select>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-medium">{topic.name}</h3>
              <span className={cn("rounded px-1.5 py-0.5 text-[10px]", topic.priority === "high" ? "text-red-600" : topic.priority === "medium" ? "text-amber-600" : "text-muted-foreground")}>
                <span className={cn("mr-1 inline-block h-1.5 w-1.5 rounded-full", priMeta.dot)} />
                {priMeta.label}
              </span>
              <span className={cn("rounded px-1.5 py-0.5 text-[10px]", sentMeta.color)}>
                {sentMeta.label}
              </span>
              <span className="text-xs text-muted-foreground">{topic.frequency} 条</span>
            </div>
          )}
          {topic.summary && !editing && (
            <p className="mt-1 text-xs text-muted-foreground">{topic.summary}</p>
          )}
        </div>
      </div>

      {samples.length > 0 && !editing && (
        <div className="mt-2 space-y-1">
          {samples.map((s, i) => (
            <p key={i} className="border-l-2 border-muted pl-2 text-xs italic text-muted-foreground">
              “{s}”
            </p>
          ))}
        </div>
      )}

      {/* 操作区 */}
      {!editing && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            onClick={() => setEditing(true)}
            disabled={isPending}
            className="rounded border border-border px-2 py-0.5 text-xs hover:bg-accent"
          >
            编辑
          </button>
          {otherTopics.length > 0 && (
            <div className="flex items-center gap-1">
              <select
                value={mergeTarget}
                onChange={(e) => setMergeTarget(e.target.value)}
                className="rounded border border-border bg-background px-1.5 py-0.5 text-xs"
              >
                <option value="">合并到…</option>
                {otherTopics.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              {mergeTarget && (
                <button
                  onClick={handleMerge}
                  disabled={isPending}
                  className="rounded border border-border px-2 py-0.5 text-xs hover:bg-accent"
                >
                  合并
                </button>
              )}
            </div>
          )}
          <button
            onClick={handleDelete}
            disabled={isPending}
            className="rounded border border-red-500/30 px-2 py-0.5 text-xs text-red-600 hover:bg-red-500/10"
          >
            删除
          </button>
        </div>
      )}

      {editing && (
        <div className="mt-3 flex justify-end gap-2">
          <button
            onClick={() => { setEditing(false); setName(topic.name); setPriority(topic.priority); }}
            className="rounded border border-border px-2 py-0.5 text-xs hover:bg-accent"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={isPending}
            className="rounded bg-primary px-2 py-0.5 text-xs text-primary-foreground hover:bg-primary/90"
          >
            保存
          </button>
        </div>
      )}
    </div>
  );
}
