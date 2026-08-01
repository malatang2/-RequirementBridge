"use server";

/**
 * 认证 Server Actions（T0.3）。
 * 对应 DoD：邮箱密码登录、Google OAuth 登录、登出可走通。
 */

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createSupabaseActionClient } from "@/lib/supabase/action-client";

export type AuthFormState = { error?: string } | undefined;

/** 邮箱密码登录 */
export async function signInWithEmail(
  _prev: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "请输入邮箱和密码" };
  }

  const supabase = await createSupabaseActionClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: "邮箱或密码错误" };
  }

  // PostHog identify 已移至客户端 AnalyticsBootstrap（server runtime 无 window，原调用静默失效）

  redirect("/dashboard");
}

/** 邮箱注册 */
export async function signUpWithEmail(
  _prev: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "请输入邮箱和密码" };
  }

  const supabase = await createSupabaseActionClient();
  const { error } = await supabase.auth.signUp({ email, password });

  if (error) {
    return { error: error.message };
  }

  // 注册后需邮箱确认（视 Supabase 配置）；直接尝试登录或提示
  redirect("/dashboard");
}

/** Google OAuth 登录（重定向到 Google 同意页） */
export async function signInWithGoogle() {
  const supabase = await createSupabaseActionClient();
  const headerList = await headers();
  const origin = headerList.get("origin") ?? "";

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${origin}/auth/callback` },
  });

  if (error) {
    // OAuth 失败重定向回登录页带错误
    redirect("/login?error=oauth");
  }

  redirect(data.url);
}

/** 登出 */
export async function signOut() {
  const supabase = await createSupabaseActionClient();
  await supabase.auth.signOut();
  redirect("/login");
}
