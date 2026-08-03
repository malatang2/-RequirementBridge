/**
 * PostHog 埋点封装（T4.2）。
 *
 * 设计：key 可选——无 NEXT_PUBLIC_POSTHOG_KEY 时静默降级（不报错、不影响功能），
 * 有 key 时自动初始化并上报。对应需求清单 §10 的埋点事件。
 *
 * 自定义事件（对应需求清单 §10）：
 * - meeting_created / analysis_completed / item_edited
 * - api_generation_completed / api_spec_edited / api_version_saved
 * - feedback_analysis_completed / topic_merged / requirement_draft_generated
 * - requirement_confirmed（04 工单：PM 确认 draft 进 backlog，v2 北极星指标）
 */

import type { PostHog } from "posthog-js";

let client: PostHog | null = null;
let initAttempted = false;

function getKey(): string | null {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return null;
  return key;
}

/** 初始化 PostHog（客户端，仅在浏览器执行） */
async function getClient(): Promise<PostHog | null> {
  if (initAttempted) return client;
  initAttempted = true;

  if (typeof window === "undefined") return null; // 仅浏览器
  const key = getKey();
  if (!key) return null; // 无 key 静默降级

  try {
    const { default: PostHog } = await import("posthog-js");
    const host = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://app.posthog.com";
    PostHog.init(key, {
      api_host: host,
      autocapture: false, // 不自动捕获，仅手动事件
      capture_pageview: true, // pageview 自动上报
    });
    client = PostHog;
    return client;
  } catch {
    return null; // 初始化失败静默降级
  }
}

/** 关联用户身份（登录后调用） */
export async function identifyUser(userId: string, traits?: Record<string, unknown>) {
  const c = await getClient();
  if (c) c.identify(userId, traits);
}

/** 上报自定义事件 */
export async function track(event: string, properties?: Record<string, unknown>) {
  const c = await getClient();
  if (c) c.capture(event, properties);
  // 无 client 时静默（降级模式不报错）
}

/** 登出时重置身份 */
export async function resetUser() {
  const c = await getClient();
  if (c) c.reset();
}

/**
 * 在浏览器引导 PostHog 初始化（由根布局客户端组件挂载时调用）。
 * getClient() 有 initAttempted 模块级缓存，重复调用幂等。
 * capture_pageview: true 会自动上报首次 pageview。
 */
export async function bootstrapAnalytics() {
  await getClient();
}
