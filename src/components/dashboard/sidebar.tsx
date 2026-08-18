"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Mic2, Plug, MessageSquare, LayoutDashboard, FileText } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FeatureFlags } from "@/lib/feature-flags";

// flag 标记该入口依赖的灰度开关（09 工单）；未标记的入口始终渲染
const NAV_ITEMS: Array<{
  href: string;
  label: string;
  icon: LucideIcon;
  flag?: keyof FeatureFlags;
}> = [
  { href: "/dashboard", label: "概览", icon: LayoutDashboard },
  { href: "/dashboard/meetings", label: "会议", icon: Mic2 },
  { href: "/dashboard/api-designer", label: "API 设计", icon: Plug },
  { href: "/dashboard/feedback", label: "反馈", icon: MessageSquare },
  { href: "/dashboard/requirements", label: "需求", icon: FileText, flag: "requirementHub" },
];

export function DashboardSidebar({
  featureFlags,
}: {
  featureFlags: FeatureFlags;
}) {
  const pathname = usePathname();
  const visibleItems = NAV_ITEMS.filter(
    (item) => !item.flag || featureFlags[item.flag]
  );

  return (
    <nav className="flex h-full w-56 flex-col gap-1 border-r border-border bg-card p-3">
      <div className="mb-4 flex items-center gap-2 px-2 py-2">
        <span className="text-xl">🌉</span>
        <span className="font-semibold">需求桥</span>
      </div>

      {visibleItems.map((item) => {
        const active =
          item.href === "/dashboard"
            ? pathname === "/dashboard"
            : pathname.startsWith(item.href);
        const Icon = item.icon;

        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
          >
            <Icon className="h-4 w-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
