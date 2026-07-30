"use client";

import { BarChart, Bar, PieChart, Pie, Cell, XAxis, ResponsiveContainer, Tooltip } from "recharts";
import type { SentimentDistribution } from "@/lib/feedback";

interface TopicBarData {
  name: string;
  frequency: number;
}

const SENTIMENT_COLORS = {
  positive: "#22c55e",
  negative: "#ef4444",
  neutral: "#94a3b8",
};

/** 主题频次横向条形图（按 frequency 降序） */
export function TopicFrequencyChart({ topics }: { topics: TopicBarData[] }) {
  // Recharts 横向条形图：取前 10 个主题
  const data = topics.slice(0, 10);
  return (
    <ResponsiveContainer width="100%" height={Math.max(200, data.length * 36)}>
      <BarChart data={data} layout="vertical" margin={{ left: 20, right: 20 }}>
        <XAxis type="number" hide />
        <Tooltip
          formatter={(v: number) => [`${v} 条`, "频次"]}
          contentStyle={{ fontSize: "12px" }}
        />
        <Bar dataKey="frequency" radius={[0, 4, 4, 0]} fill="#3b82f6" />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** 情感饼图 */
export function SentimentPieChart({ distribution }: { distribution: SentimentDistribution }) {
  const data = [
    { name: "正面", value: distribution.positive, color: SENTIMENT_COLORS.positive },
    { name: "负面", value: distribution.negative, color: SENTIMENT_COLORS.negative },
    { name: "中性", value: distribution.neutral, color: SENTIMENT_COLORS.neutral },
  ].filter((d) => d.value > 0);

  if (data.length === 0) {
    return <div className="py-8 text-center text-xs text-muted-foreground">无情感数据</div>;
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          outerRadius={70}
          label={(entry) => `${entry.name} ${entry.value}`}
          labelLine={false}
        >
          {data.map((d) => (
            <Cell key={d.name} fill={d.color} />
          ))}
        </Pie>
        <Tooltip contentStyle={{ fontSize: "12px" }} />
      </PieChart>
    </ResponsiveContainer>
  );
}
