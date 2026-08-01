"use client";

/**
 * PostHog 客户端引导组件（02 工单架构修复）。
 *
 * 背景：analytics.ts 的 getClient() 在 typeof window === "undefined" 时直接返回 null。
 * 之前所有 identifyUser/track 调用都在 "use server" 的 Server Action 里，
 * 而 Server Action 跑在 Node.js 服务端（无 window），导致 PostHog 永不初始化。
 *
 * 此组件在根布局挂载时：① 引导 PostHog 浏览器初始化；② 若已有 Supabase session
 * 则 identify 关联用户身份。无 session（如 /login 页）时静默跳过 identify，不影响功能。
 */
import { useEffect } from "react";
import { bootstrapAnalytics, identifyUser } from "@/lib/analytics";
import { createSupabaseClient } from "@/lib/supabase/client";

export function AnalyticsBootstrap() {
  useEffect(() => {
    let active = true;
    (async () => {
      // 1. 初始化 PostHog（无 key 时静默降级）
      await bootstrapAnalytics();
      // 2. 若已登录（读本地 session，无网络往返），关联用户身份
      const {
        data: { session },
      } = await createSupabaseClient().auth.getSession();
      if (active && session?.user) {
        await identifyUser(session.user.id, { email: session.user.email });
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  return null;
}
