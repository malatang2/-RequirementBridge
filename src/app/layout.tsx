import type { Metadata } from "next";
import "./globals.css";
import { AnalyticsBootstrap } from "@/components/analytics-bootstrap";

export const metadata: Metadata = {
  title: "需求桥 RequirementBridge",
  description: "会议决策 → 结构化需求 → 可执行 API：AI 一次性把会议与反馈转化为产品需求与技术接口",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="antialiased">
        <AnalyticsBootstrap />
        {children}
      </body>
    </html>
  );
}
