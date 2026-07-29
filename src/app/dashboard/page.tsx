import Link from "next/link";
import { Mic2, Plug, MessageSquare, AlertCircle } from "lucide-react";
import { listProjects } from "./projects/actions";

export default async function DashboardPage() {
  const projects = await listProjects();

  const MODULES = [
    {
      href: "/dashboard/meetings",
      title: "会议纪要",
      desc: "上传音频或粘贴文本，AI 提取决策/待办/需求/问题",
      icon: Mic2,
    },
    {
      href: "/dashboard/api-designer",
      title: "API 设计器",
      desc: "业务需求 → OpenAPI 3.0 草稿，代码/可视化双视图",
      icon: Plug,
    },
    {
      href: "/dashboard/feedback",
      title: "反馈洞察",
      desc: "聚类/情感/频次/优先级，一键生成需求草稿",
      icon: MessageSquare,
    },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">工作台</h1>
        <p className="text-sm text-muted-foreground">
          选择上方项目，开始会议决策到任务执行的转化
        </p>
      </div>

      {projects.length === 0 && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-amber-900 dark:text-amber-200">
            还没有项目。点击左上角「选择项目 → 新建项目」创建第一个项目，各模块的数据将按项目隔离。
          </p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {MODULES.map((m) => {
          const Icon = m.icon;
          return (
            <Link
              key={m.href}
              href={m.href}
              className="group rounded-lg border border-border bg-card p-5 transition-shadow hover:shadow-md"
            >
              <Icon className="mb-3 h-8 w-8 text-primary" />
              <h2 className="mb-1 font-semibold group-hover:text-primary">
                {m.title}
              </h2>
              <p className="text-sm text-muted-foreground">{m.desc}</p>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
