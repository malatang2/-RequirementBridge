# 02 — v1 遗留修复：PostHog key + Google OAuth + CI 验证

**What to build:** 补齐 v1 上线前遗留的三项配置类缺口。配置 PostHog key 使埋点代码生效（v2 北极星指标"有效确认需求数"的可观测基础，所有埋点事件依赖此 key 上报）；配置 Google OAuth provider 使第三方登录按钮可用；首次 push 后验证 GitHub Actions CI（lint+typecheck+test+build 四步）全绿。这些是配置/部署动作，不涉及业务代码改动，与主线开发完全并行。

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [x] PostHog key 配置：Vercel 环境变量加 NEXT_PUBLIC_POSTHOG_KEY，DevTools Network 验证埋点请求上报（不再静默降级）
  - **架构修复（扩展 scope）**：原 v1 把 PostHog 调用全放在 `"use server"` Server Action 里，而 posthog-js 是客户端 SDK（`typeof window === "undefined"` 时返回 null）→ 永不初始化、静默失效。
    修复：新增 `<AnalyticsBootstrap />` 客户端组件挂载在根布局，浏览器侧引导 init；3 个 `new/page.tsx` 在 client 侧补 `track()`；删除 4 个 server action 里已失效的 PostHog 调用（死代码）。
  - **Vercel 环境变量**：6 条已配置（key+host × Preview/Production/Development）—— 上轮 session 通过 Vercel REST API 完成。
  - **本地验证（dev server, port 3000）**：
    1. ✅ 编译产物内联 key：`app/layout.js` chunk 中 `getKey()` 内联为 `"phc_tu8BhuhLFR3x4e73TG2aoNLS9ZFDkt8mHt9RLjYWjEKj"`（`process.env.NEXT_PUBLIC_POSTHOG_KEY` 已被 webpack 静态替换，0 处残留）
    2. ✅ `<AnalyticsBootstrap />` 已编入根布局 chunk（17 处符号引用）
    3. ✅ `track("meeting_created", {meetingId, mode:"text"})` 已编入 `dashboard/meetings/new/page.js`
    4. ✅ SDK 初始化成功：浏览器 `localStorage` 出现 `ph_phc_tu8...posthog` 持久化键（仅由 `PostHog.init()` 成功时创建）
    5. ✅ PostHog cloud 接受该 key 的事件：`POST /e` → `200 {"status":"Ok"}`；`GET /decide/?v=3&token=...` → `200 {"errorsWhileComputingFlags":false,...}`
  - **注**：posthog-js 不暴露 `window.posthog`（仅设 `exports.posthog`），故 `window.posthog === undefined` 是预期行为，非缺陷。
- [x] Google OAuth provider 配置：Google Cloud Console 创建 OAuth 客户端，Supabase Auth 启用 Google provider，登录页点 Google 登录能跳转授权并回跳
  - **Google Cloud OAuth Client**：client_id `414825779710-fhepmdqt36ig4gk87fua9d90dl68et1h.apps.googleusercontent.com`，redirect_uri = `https://kcpcqocxtkaygtcpmmfp.supabase.co/auth/v1/callback`
  - **浏览器验证（2026-08-01）**：登录页点"🔵 使用 Google 继续" → 成功跳转 `accounts.google.com/v3/signin/identifier`，参数完整（client_id / redirect_uri / scope=email+profile 均正确），Google 授权页正常渲染（"继续前往 kcpcqocxtkaygtcpmmfp.supabase.co"），证明 client_id 与 redirect_uri 在 Google 侧已注册且匹配（否则会报 `redirect_uri_mismatch`）。
  - **OAuth 逻辑零改动**：`(auth)/actions.ts` 的 `signInWithGoogle` 未修改，原实现正确。
- [ ] CI 验证（D-2）：首次 push 到 main 后 GitHub Actions 触发，lint + typecheck + test + build 四步全绿
- [ ] Vercel 部署为最新代码（K-5 确认）
