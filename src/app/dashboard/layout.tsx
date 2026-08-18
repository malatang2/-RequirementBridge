import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentProjectId } from "@/lib/current-project";
import { loadFeatureFlags } from "@/lib/feature-flags";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import type { Project } from "@/types/database";

/**
 * Dashboard 布局（T0.4）。
 * 在此拉取当前用户的项目列表，供顶栏项目选择器与各模块共享；
 * 同时读取 profiles.feature_flags 灰度开关，整棵树共享一次查询结果（09 工单）。
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createSupabaseServerClient();
  const currentProjectId = await getCurrentProjectId();
  const featureFlags = await loadFeatureFlags(supabase);

  const { data } = await supabase
    .from("projects")
    .select("*")
    .is("archived_at", null)
    .order("created_at", { ascending: false });

  const projects = (data as Project[]) ?? [];

  return (
    <DashboardShell
      projects={projects}
      currentProjectId={currentProjectId}
      featureFlags={featureFlags}
    >
      {children}
    </DashboardShell>
  );
}
