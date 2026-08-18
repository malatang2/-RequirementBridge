"use client";

import { useState } from "react";
import { DashboardSidebar } from "./sidebar";
import { ProjectSwitcher } from "./project-switcher";
import { ProjectCreateDialog } from "./project-create-dialog";
import { signOut } from "@/app/(auth)/actions";
import type { Project } from "@/types/database";
import type { FeatureFlags } from "@/lib/feature-flags";

interface DashboardShellProps {
  projects: Project[];
  currentProjectId: string | null;
  featureFlags: FeatureFlags;
  children: React.ReactNode;
}

export function DashboardShell({
  projects,
  currentProjectId,
  featureFlags,
  children,
}: DashboardShellProps) {
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden">
      <DashboardSidebar featureFlags={featureFlags} />

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* 顶栏 */}
        <header className="flex h-14 items-center justify-between border-b border-border bg-card px-4">
          <ProjectSwitcher
            projects={projects}
            currentId={currentProjectId}
            onCreateClick={() => setCreateOpen(true)}
          />

          <form action={signOut}>
            <button
              type="submit"
              className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              登出
            </button>
          </form>
        </header>

        {/* 内容区 */}
        <main className="flex-1 overflow-auto bg-background p-6">
          {children}
        </main>
      </div>

      <ProjectCreateDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
