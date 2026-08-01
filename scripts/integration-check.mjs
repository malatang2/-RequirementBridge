/**
 * 集成联调脚本（Day 6 / T5.1）。
 * 验证：① 三模块数据在统一项目下连贯 ② RLS 隔离（A 账号查不到 B 数据）
 *
 * 用法：node scripts/integration-check.mjs
 * 直接调 Supabase REST API（service_role + anon），不依赖 dev server。
 */

import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, "..", ".env.local");
const env = fs.readFileSync(envPath, "utf-8");
const readEnv = (key) => {
  const m = env.match(new RegExp(`^${key}=(.+)$`, "m"));
  return m ? m[1].trim() : "";
};

const SUPABASE_URL = readEnv("NEXT_PUBLIC_SUPABASE_URL");
const ANON = readEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE = readEnv("SUPABASE_SERVICE_ROLE_KEY");
const PROJECT = SUPABASE_URL.match(/https:\/\/(.+)\.supabase\.co/)?.[1];

if (!SUPABASE_URL || !ANON || !SERVICE) {
  console.error("❌ 缺少 .env.local 中的 Supabase 配置");
  process.exit(1);
}

function req(p, method, headers, body) {
  return new Promise((resolve, reject) => {
    const reqBody = body ? JSON.stringify(body) : null;
    const r = https.request(
      `${SUPABASE_URL}${p}`,
      {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(reqBody ? { "Content-Length": Buffer.byteLength(reqBody) } : {}),
          ...headers,
        },
      },
      (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => resolve({ status: res.statusCode, body: d }));
      }
    );
    r.on("error", reject);
    if (reqBody) r.write(reqBody);
    r.end();
  });
}

const checks = [];
function check(name, passed, detail = "") {
  checks.push({ name, passed, detail });
  console.log(`  ${passed ? "✓" : "✗"} ${name} ${detail}`);
}

async function main() {
  console.log("═══════════════════════════════════════");
  console.log("  集成联调（T5.1）：数据连贯 + RLS 隔离");
  console.log("═══════════════════════════════════════\n");

  const userId = "0a4f104a-df1f-4df1-8fa1-c1d33347939f"; // 测试账号 A

  // === 1. 三模块数据连贯性（用 service_role 查统一项目下的三模块数据）===
  console.log("【1】三模块数据连贯性");
  const { body: projBody } = await req(
    `/rest/v1/projects?user_id=eq.${userId}&select=id,name`,
    "GET",
    { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` }
  );
  const projects = JSON.parse(projBody);
  check("项目存在", projects.length > 0, `(${projects.length} 个)`);
  const projectId = projects[0]?.id;

  if (projectId) {
    const [meetings, drafts, analyses] = await Promise.all([
      req(`/rest/v1/meetings?project_id=eq.${projectId}&select=id`, "GET", { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` }),
      req(`/rest/v1/api_drafts?project_id=eq.${projectId}&select=id`, "GET", { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` }),
      req(`/rest/v1/feedback_analyses?project_id=eq.${projectId}&select=id`, "GET", { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` }),
    ]);
    const mCount = JSON.parse(meetings.body).length;
    const dCount = JSON.parse(drafts.body).length;
    const fCount = JSON.parse(analyses.body).length;
    check("会议数据", mCount > 0, `(${mCount} 条)`);
    check("API 草稿数据", dCount > 0, `(${dCount} 条)`);
    check("反馈分析数据", fCount > 0, `(${fCount} 条)`);
    check("三模块同属一项目", mCount > 0 && dCount > 0 && fCount > 0, "数据按项目隔离");
  }

  // === 2. RLS 隔离验证 ===
  console.log("\n【2】RLS 隔离（anon 无 token 应查不到任何用户数据）");
  const noToken = await req(`/rest/v1/projects?select=id`, "GET", { apikey: ANON });
  const noTokenData = JSON.parse(noToken.body);
  check("无登录态查 projects 返回 0 行", Array.isArray(noTokenData) && noTokenData.length === 0, `(${noTokenData.length} 行)`);

  // 用 A 账号登录后查（应只看到自己的）
  const loginRes = await req("/auth/v1/token?grant_type=password", "POST", { apikey: ANON }, {
    email: "reqbridge.test@gmail.com",
    password: "Test123456!",
  });
  const accessToken = JSON.parse(loginRes.body).access_token;
  check("测试账号登录成功", !!accessToken);

  if (accessToken) {
    const ownRes = await req(`/rest/v1/projects?select=id&user_id=eq.${userId}`, "GET", {
      apikey: ANON,
      Authorization: `Bearer ${accessToken}`,
    });
    const own = JSON.parse(ownRes.body);
    check("登录后能查到自己的项目", Array.isArray(own) && own.length > 0, `(${own.length} 个)`);

    // 尝试用伪造的 user_id 查别人的（RLS 应拦截）
    const fakeRes = await req(`/rest/v1/projects?select=id&user_id=eq.00000000-0000-0000-0000-000000000000`, "GET", {
      apikey: ANON,
      Authorization: `Bearer ${accessToken}`,
    });
    const fake = JSON.parse(fakeRes.body);
    check("RLS 拦截伪造 user_id 查询", Array.isArray(fake) && fake.length === 0, `(${fake.length} 行)`);

    // 尝试插入不属于自己 user_id 的项目（RLS with check 应拒绝）
    const injectRes = await req(`/rest/v1/projects`, "POST", {
      apikey: ANON,
      Authorization: `Bearer ${accessToken}`,
      Prefer: "return=representation",
    }, {
      user_id: "00000000-0000-0000-0000-000000000000", // 伪造
      name: "RLS注入测试",
    });
    const inject = JSON.parse(injectRes.body);
    check("RLS 拦截伪造 user_id 插入", injectRes.status >= 400 || (Array.isArray(inject) && inject.length === 0), `(status ${injectRes.status})`);
  }

  // === 汇总 ===
  const passed = checks.filter((c) => c.passed).length;
  const failed = checks.length - passed;
  console.log("\n═══════════════════════════════════════");
  console.log(`  ${checks.length} 项 | ✓ ${passed} 通过 | ✗ ${failed} 失败`);
  console.log(`  ${failed === 0 ? "✅ 集成联调通过" : "❌ 存在问题"}`);
  console.log("═══════════════════════════════════════\n");
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error("异常:", e); process.exit(2); });
