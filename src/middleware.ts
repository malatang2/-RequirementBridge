import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { publicEnv } from "@/lib/env";
import type { CookieEntry } from "@/lib/supabase/cookies";

/**
 * 中间件（T0.3）：刷新 Supabase session + 登录态守卫。
 * 对应 DoD：未登录访问 /dashboard/* 重定向到 /login。
 */
export async function middleware(request: NextRequest) {
  // Supabase 官方推荐：每次请求刷新 session cookie
  const supabase = createServerClient(
    publicEnv.supabaseUrl,
    publicEnv.supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieEntry[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          const response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options as never)
          );
          return response;
        },
      },
    }
  );

  // getUser 会读取/刷新 session；未登录时 user 为 null
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isDashboardRoute = pathname.startsWith("/dashboard");
  const isAuthRoute = pathname === "/login" || pathname === "/signup";

  // 已登录访问 /login、/signup → 重定向到工作台
  if (user && isAuthRoute) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  // 未登录访问 /dashboard/* → 重定向到登录
  if (!user && isDashboardRoute) {
    const redirectUrl = new URL("/login", request.url);
    redirectUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(redirectUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // 排除静态资源与 API；匹配 dashboard 与登录相关页
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|css|js)$).*)",
  ],
};
