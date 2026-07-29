"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ChevronsUpDown, Plus } from "lucide-react";
import { setCurrentProjectId } from "@/lib/current-project";
import type { Project } from "@/types/database";
import { cn } from "@/lib/utils";

interface ProjectSwitcherProps {
  projects: Project[];
  currentId: string | null;
  onCreateClick: () => void;
}

export function ProjectSwitcher({
  projects,
  currentId,
  onCreateClick,
}: ProjectSwitcherProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const current = projects.find((p) => p.id === currentId);

  async function selectProject(id: string) {
    setOpen(false);
    startTransition(async () => {
      await setCurrentProjectId(id);
      router.refresh();
    });
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={isPending}
        className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent"
      >
        <span className="max-w-[140px] truncate">
          {current?.name ?? "选择项目"}
        </span>
        <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" />
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setOpen(false)}
          />
          <div className="absolute left-0 top-full z-20 mt-1 w-56 rounded-md border border-border bg-popover p-1 shadow-md">
            {projects.length === 0 && (
              <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                暂无项目
              </p>
            )}
            {projects.map((p) => (
              <button
                key={p.id}
                onClick={() => selectProject(p.id)}
                className={cn(
                  "block w-full truncate rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent",
                  p.id === currentId && "font-medium text-primary"
                )}
              >
                {p.name}
              </button>
            ))}
            <div className="my-1 h-px bg-border" />
            <button
              onClick={() => {
                setOpen(false);
                onCreateClick();
              }}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
            >
              <Plus className="h-3.5 w-3.5" />
              新建项目
            </button>
          </div>
        </>
      )}
    </div>
  );
}
