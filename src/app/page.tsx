import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 p-8">
      <div className="text-center">
        <h1 className="text-4xl font-bold tracking-tight">🌉 需求桥 RequirementBridge</h1>
        <p className="mt-3 text-lg text-muted-foreground">
          会议决策 → 结构化需求 → 可执行 API
        </p>
      </div>
      <div className="flex gap-4">
        <Link
          href="/login"
          className="rounded-md bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          登录
        </Link>
        <Link
          href="/dashboard"
          className="rounded-md border border-border px-6 py-2.5 text-sm font-medium hover:bg-accent"
        >
          进入工作台
        </Link>
      </div>
      {/* TODO: Landing Page 完整内容见《UI 线框稿 §2》，T0 期间为占位 */}
    </main>
  );
}
