"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signUpWithEmail, signInWithGoogle, type AuthFormState } from "../actions";

export default function SignUpPage() {
  const [state, formAction, isPending] = useActionState<
    AuthFormState,
    FormData
  >(signUpWithEmail, undefined);

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6 rounded-lg border border-border bg-card p-8 shadow-sm">
        <div className="space-y-1 text-center">
          <div className="text-3xl">🌉</div>
          <h1 className="text-2xl font-semibold tracking-tight">创建账号</h1>
          <p className="text-sm text-muted-foreground">开始用 AI 桥接会议与需求</p>
        </div>

        <form action={formAction} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="email" className="text-sm font-medium">
              邮箱
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="password" className="text-sm font-medium">
              密码
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="new-password"
              minLength={6}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {state?.error && (
            <p className="text-sm text-destructive">{state.error}</p>
          )}

          <button
            type="submit"
            disabled={isPending}
            className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {isPending ? "注册中…" : "注册"}
          </button>
        </form>

        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-border" />
          <span className="text-xs text-muted-foreground">或</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        <form action={signInWithGoogle} className="w-full">
          <button
            type="submit"
            className="flex w-full items-center justify-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent"
          >
            <span>🔵</span> 使用 Google 继续
          </button>
        </form>

        <p className="text-center text-sm text-muted-foreground">
          已有账号？{" "}
          <Link href="/login" className="font-medium text-primary hover:underline">
            去登录
          </Link>
        </p>
      </div>
    </main>
  );
}
