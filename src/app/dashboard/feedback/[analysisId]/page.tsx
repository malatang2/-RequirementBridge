import { notFound } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  FeedbackAnalysis,
  FeedbackItem,
  FeedbackTopic,
} from "@/types/database";
import { computeStats, sortByFrequency, computeSentimentDistribution } from "@/lib/feedback";
import { FeedbackGenStatus } from "@/components/dashboard/feedback-gen-status";
import { TopicFrequencyChart, SentimentPieChart } from "@/components/dashboard/feedback-charts";
import { TopicCard } from "./topic-card";
import { GenerateRequirementButton } from "./generate-requirement-button";

export default async function FeedbackDetailPage({
  params,
}: {
  params: Promise<{ analysisId: string }>;
}) {
  const { analysisId } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: analysis } = await supabase
    .from("feedback_analyses")
    .select("*")
    .eq("id", analysisId)
    .single();

  if (!analysis) notFound();

  const a = analysis as FeedbackAnalysis;

  const { data: topicsData } = await supabase
    .from("feedback_topics")
    .select("*")
    .eq("analysis_id", analysisId);
  const { data: itemsData } = await supabase
    .from("feedback_items")
    .select("id, content, topic_id, sentiment")
    .eq("analysis_id", analysisId);

  const topics = (topicsData as FeedbackTopic[]) ?? [];
  const items = (itemsData as FeedbackItem[]) ?? [];
  const isCompleted = a.status === "completed";

  const sortedTopics = sortByFrequency(topics);
  const stats = computeStats(a.total_count, topics);
  const sentimentDist = computeSentimentDistribution(items);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <Link href="/dashboard/feedback" className="text-sm text-muted-foreground hover:text-foreground">
          ← 返回反馈列表
        </Link>
        {isCompleted && sortedTopics.length > 0 && (
          <GenerateRequirementButton analysisId={a.id} topics={sortedTopics} />
        )}
      </div>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">{a.title}</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          {new Date(a.created_at).toLocaleString("zh-CN")}
        </p>
      </div>

      <FeedbackGenStatus analysisId={a.id} initialStatus={a.status} errorMessage={a.error_message} />

      {isCompleted && (
        <>
          {/* 统计卡片 */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="总反馈" value={stats.total} />
            <StatCard label="主题数" value={stats.topicCount} />
            <StatCard label="高优主题" value={stats.highPriorityCount} />
            <StatCard
              label="负面占比"
              value={`${(stats.negativeRatio * 100).toFixed(0)}%`}
              danger={stats.negativeRatio > 0.4}
            />
          </div>

          {/* 图表 */}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border border-border bg-card p-4">
              <h2 className="mb-3 text-sm font-semibold">主题频次（按数量降序）</h2>
              <TopicFrequencyChart
                topics={sortedTopics.map((t) => ({ name: t.name, frequency: t.frequency }))}
              />
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <h2 className="mb-3 text-sm font-semibold">情感分布</h2>
              <SentimentPieChart distribution={sentimentDist} />
            </div>
          </div>

          {/* 主题卡列表 */}
          <div className="space-y-3">
            <h2 className="text-sm font-semibold">主题列表（{sortedTopics.length}）</h2>
            {sortedTopics.map((topic) => (
              <TopicCard key={topic.id} topic={topic} analysisId={a.id} allTopics={sortedTopics} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function StatCard({ label, value, danger }: { label: string; value: number | string; danger?: boolean }) {
  return (
    <div className={`rounded-lg border bg-card p-3 ${danger ? "border-red-500/30" : "border-border"}`}>
      <div className={`text-2xl font-bold ${danger ? "text-red-600" : ""}`}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
