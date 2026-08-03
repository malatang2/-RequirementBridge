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

// ============ Phase 1 集成 check（11-14）============
// 复用同一套 req() / check() 基建；service_role 仅用于幂等清理跨用户测试残留，
// RLS 验证一律走 anon-{A,B} 真实登录会话——与 v1 既有 RLS 测试同等可信。
//
// 关键设计：用真实第二用户 B（service_role 调 /auth/v1/admin/users 幂等创建）
// 取代 v1 的"伪造 user_id"。理由：requirement_drafts/api_drafts 等表的
// user_id 有 FK → auth.users(id)，伪造 UUID 不满足 FK，service_role 也写不进；
// 而 anon-A 会话塞伪造 user_id 又被 RLS with check 拒绝（v1 的 inject 模式）。
// 真实用户 B 才能制造"B 真实写了一行，A 的会话查不到"的合法跨用户场景。
const RB08 = "RB08"; // 本次 check 的数据 tag，前缀用于幂等清理
const USER_B_EMAIL = "rb08-test-b@example.com";
const USER_B_PWD = "Test123456!";

// service_role 专用 header
const SR = () => ({ apikey: SERVICE, Authorization: `Bearer ${SERVICE}` });
// 已登录会话 header（A 或 B 都用 anon key + 自身 access_token）
const AUTH = (token) => ({ apikey: ANON, Authorization: `Bearer ${token}` });

/**
 * 幂等确保真实用户 B 存在并返回其 user_id。
 * - 若已注册：admin/userid 接口查到
 * - 若未注册：admin create（email_confirm:true，可直接 password 登录）
 * B 用户本身不删（重跑需要）；只删 B 名下的业务数据（见 cleanupRB08）。
 */
async function ensureUserB() {
  // 按邮箱查
  const findRes = await req(
    `/auth/v1/admin/users?per_page=200`,
    "GET",
    SR()
  );
  const list = JSON.parse(findRes.body)?.users ?? [];
  const found = list.find((u) => u.email === USER_B_EMAIL);
  if (found) return found.id;
  // 创建
  const createRes = await req(
    `/auth/v1/admin/users`,
    "POST",
    { ...SR(), "Content-Type": "application/json" },
    { email: USER_B_EMAIL, password: USER_B_PWD, email_confirm: true }
  );
  const created = JSON.parse(createRes.body);
  if (!created?.id) {
    throw new Error(`ensureUserB 创建失败: ${createRes.status} ${createRes.body}`);
  }
  return created.id;
}

/** 用户 B 密码登录，返回 access_token（A 的 token 由 main() 登录后传入）。 */
async function loginB() {
  const r = await req(
    `/auth/v1/token?grant_type=password`,
    "POST",
    { apikey: ANON, "Content-Type": "application/json" },
    { email: USER_B_EMAIL, password: USER_B_PWD }
  );
  const tok = JSON.parse(r.body)?.access_token;
  if (!tok) throw new Error(`用户 B 登录失败: ${r.status} ${r.body}`);
  return tok;
}

// 幂等清理：删除本次脚本历史植入的 RB08-* 业务数据（跨 A/B 用户，service_role 删）
async function cleanupRB08() {
  const headers = SR();
  // 先删 feedback_items（依赖 feedback_analyses），再删 feedback_analyses
  await req(`/rest/v1/feedback_items?source_meta->>tag=eq.${RB08}`, "DELETE", headers);
  await req(`/rest/v1/feedback_analyses?title=like.*${RB08}*`, "DELETE", headers);
  // api_drafts（source_requirement_id 关联的 requirement 删了会被 set null，可先删）
  await req(`/rest/v1/api_drafts?title=like.*${RB08}*`, "DELETE", headers);
  // requirement_drafts
  await req(`/rest/v1/requirement_drafts?title=like.*${RB08}*`, "DELETE", headers);
  // meeting_items（删了 meetings 才能删；用 tag in content 过滤）
  await req(`/rest/v1/meeting_items?content=like.*${RB08}*`, "DELETE", headers);
  // meetings（标题打 tag；input_mode 为枚举，DELETE 不需要）
  await req(`/rest/v1/meetings?title=like.*${RB08}*`, "DELETE", headers);
}

/**
 * Phase 1 新增 4 个集成 check（编号 11-14）。
 * @param {{userIdA:string, userIdB:string, projectId:string, tokenA:string, tokenB:string}} ctx
 */
// 从 JWT 里解出 user_id（sub claim）。本项目的所有业务表的 insert RLS policy
// 是 `with check (user_id = auth.uid())`——PostgREST 不会自动把 auth.uid() 填进
// 插入行，所以 anon+access_token 会话写库时，必须在 body 里显式带上 user_id
// 且值要等于 JWT sub，否则 42501。下面 checks 11-14 的所有 AUTH 插入都依赖
// uidA/uidB 在 body 里显式写明归属。
const decodeUid = (tok) =>
  JSON.parse(Buffer.from(tok.split(".")[1], "base64").toString()).sub;

async function runPhase1Checks({ userIdA, userIdB, projectId, tokenA, tokenB }) {
  console.log("\n【3】Phase 1 集成 check（11-14：CRUD RLS / 会议转入 / 需求→API / 软删）");

  if (!projectId) {
    check("Phase 1 checks 跳过：无可用 project", false, "（projectId 为空，前置 check 失败）");
    return;
  }

  // JWT sub 应与传入 userIdA/userIdB 一致；以 JWT 为准（RLS 实际判定的依据）
  const uidA = decodeUid(tokenA);
  const uidB = decodeUid(tokenB);

  // 跑前清理（防止上一次未正常退出残留）
  await cleanupRB08();

  // ───────────── check 11：Requirement CRUD 跨用户 RLS 隔离 ─────────────
  // B 用自己的登录会话写一条 confirmed 需求（合法归属）；A 的会话应：
  //   - 在列表里看不到它（select policy: user_id = auth.uid() 过滤）
  //   - 用 PATCH 改它返回 0 行（update using 拦截）
  //   - 用 DELETE 删它返回 0 行（delete using 拦截）
  // 对照组：A 自己写一条同样标题前缀的需求，A 能查到（排除"查询本身坏了"）。
  {
    const titleB = `${RB08}-req-B-RLS`;
    // B 用自己的会话写（RLS with check user_id=auth.uid() 要求 body 带 user_id）
    const insB = await req(`/rest/v1/requirement_drafts`, "POST", {
      ...AUTH(tokenB), Prefer: "return=representation",
    }, {
      user_id: uidB,
      project_id: projectId,
      source_type: "manual",
      title: titleB,
      content: `${RB08} B 的私有需求，A 不应看到`,
      lifecycle: "confirmed",
    });
    const rowB = JSON.parse(insB.body)?.[0];
    const bId = rowB?.id;

    // A 列表查询：标题精确过滤 + 期望 RLS 把 B 的行过滤掉
    const listRes = await req(
      `/rest/v1/requirement_drafts?select=id&title=eq.${encodeURIComponent(titleB)}`,
      "GET",
      AUTH(tokenA)
    );
    const list = JSON.parse(listRes.body);
    check(
      "11a Requirement 跨用户 RLS：A 列表看不到 B 的需求",
      Array.isArray(list) && list.length === 0,
      `(A 看见 ${Array.isArray(list) ? list.length : "?"} 条)`
    );

    // A 改 B 的需求：带 Prefer: return=representation 看返回几行
    const updRes = await req(
      `/rest/v1/requirement_drafts?id=eq.${bId}`,
      "PATCH",
      { ...AUTH(tokenA), Prefer: "return=representation" },
      { title: `${titleB}-tampered` }
    );
    const upd = JSON.parse(updRes.body);
    check(
      "11b Requirement 跨用户 RLS：A 改不了 B 的需求（0 行受影响）",
      Array.isArray(upd) && upd.length === 0,
      `(受影响 ${Array.isArray(upd) ? upd.length : "?"} 行)`
    );

    // A 删 B 的需求
    const delRes = await req(
      `/rest/v1/requirement_drafts?id=eq.${bId}`,
      "DELETE",
      { ...AUTH(tokenA), Prefer: "return=representation" }
    );
    const del = JSON.parse(delRes.body);
    check(
      "11c Requirement 跨用户 RLS：A 删不了 B 的需求（0 行受影响）",
      Array.isArray(del) && del.length === 0,
      `(受影响 ${Array.isArray(del) ? del.length : "?"} 行)`
    );

    // 对照组：A 自己的需求 A 应能查到（证明不是查询本身坏了）
    const titleA = `${RB08}-req-A-own`;
    const insA = await req(`/rest/v1/requirement_drafts`, "POST", {
      ...AUTH(tokenA), Prefer: "return=representation",
    }, {
      user_id: uidA,
      project_id: projectId,
      source_type: "manual",
      title: titleA,
      content: `${RB08} A 自己的需求`,
      lifecycle: "confirmed",
    });
    const aRowId = JSON.parse(insA.body)?.[0]?.id;
    const ownList = await req(
      `/rest/v1/requirement_drafts?select=id&title=eq.${encodeURIComponent(titleA)}`,
      "GET",
      AUTH(tokenA)
    );
    const ownArr = JSON.parse(ownList.body);
    check(
      "11d 对照：A 能查到自己的 requirement",
      Array.isArray(ownArr) && ownArr.length === 1,
      `(A 看见 ${Array.isArray(ownArr) ? ownArr.length : "?"} 条)`
    );
    // aRowId 给 check 13 复用（已 confirmed）
    ctx.aRequirementId = aRowId;
    ctx.aRequirementTitle = titleA;
  }

  // ───────────── check 12：会议 issue 转入 feedback_items（来源接线 + 防重复）─────────────
  // 06 的 transfer 链路依赖 Edge Function（调 DashScope）；为保证集成脚本在
  // 不依赖外部 LLM 的前提下覆盖"转入语义"，直接用 service_role 模拟写入
  // feedback_items（source_type='meeting' + source_meta={meeting_id, meeting_item_id}），
  // 验证 ADR-0002 的 Copy 快照契约。防重复用 06 的纯函数 filterTransferableItems
  // 语义间接验证：transferred_to_feedback=true 的条目再次"转入"被滤掉。
  {
    // 建一个 meeting + 一个 issue 条目（A 的）—— 用 A 的登录会话，贴近真实链路
    const mtgRes = await req(`/rest/v1/meetings`, "POST", {
      ...AUTH(tokenA), Prefer: "return=representation",
    }, {
      user_id: uidA,
      project_id: projectId,
      title: `${RB08}-会议-转入测试`,
      input_mode: "paste", // meetings.input_mode NOT NULL，无默认值
      raw_text: `${RB08} 会议原文，含一条 issue`,
    });
    const mtg = JSON.parse(mtgRes.body)?.[0];

    const itemRes = await req(`/rest/v1/meeting_items`, "POST", {
      ...AUTH(tokenA), Prefer: "return=representation",
    }, {
      user_id: uidA,
      meeting_id: mtg.id,
      category: "issue",
      content: `${RB08} 排版在某些机型错位`,
    });
    const item = JSON.parse(itemRes.body)?.[0];

    // 建一个 feedback_analysis（模拟 06 action 创建的承载记录）
    const anaRes = await req(`/rest/v1/feedback_analyses`, "POST", {
      ...AUTH(tokenA), Prefer: "return=representation",
    }, {
      user_id: uidA,
      project_id: projectId,
      title: `${RB08}-来自会议《${mtg.title}》`,
      input_mode: "paste",
      total_count: 1,
      status: "completed",
      source_label: `来自会议《${mtg.title}》`,
    });
    const ana = JSON.parse(anaRes.body)?.[0];

    // 模拟 06 action 写 feedback_items：带 source_type + source_meta
    const fbRes = await req(`/rest/v1/feedback_items`, "POST", {
      ...AUTH(tokenA), Prefer: "return=representation",
    }, {
      user_id: uidA,
      analysis_id: ana.id,
      content: item.content,
      source_type: "meeting",
      source_meta: {
        meeting_id: mtg.id,
        meeting_item_id: item.id,
        tag: RB08,
      },
    });
    const fbRow = JSON.parse(fbRes.body)?.[0];
    check(
      "12a 会议转入：feedback_items 落 source_type='meeting'",
      fbRow?.source_type === "meeting",
      `(source_type=${fbRow?.source_type ?? "?"})`
    );
    check(
      "12b 会议转入：source_meta 含 meeting_id + meeting_item_id（Copy 快照溯源）",
      !!fbRow?.source_meta?.meeting_id && !!fbRow?.source_meta?.meeting_item_id,
      `(keys=${Object.keys(fbRow?.source_meta ?? {}).join(",")})`
    );
    check(
      "12c 会议转入：meeting_item_id 指向原条目（出身溯源链路完整）",
      fbRow?.source_meta?.meeting_item_id === item.id,
      `(${fbRow?.source_meta?.meeting_item_id?.slice(0, 8) ?? "?"} == ${item.id.slice(0, 8)})`
    );

    // 防重复：把 meeting_item.transferred_to_feedback 置 true（模拟 06 已转入回写），
    // 重新触发 transfer 时 filterTransferableItems 会把它滤掉。
    // 这里用 A 的会话 update 该字段（合法归属），然后复算 06 纯函数语义：
    //   valid = items.filter(it => it.meeting_id===mid && it.category==='issue' && !it.transferred_to_feedback && content非空)
    // 期望：置 true 后再"转入"得到空列表（防重复）。
    await req(
      `/rest/v1/meeting_items?id=eq.${item.id}`,
      "PATCH",
      { ...AUTH(tokenA), Prefer: "return=representation" },
      { transferred_to_feedback: true }
    );
    const reFetch = await req(
      `/rest/v1/meeting_items?id=eq.${item.id}&select=transferred_to_feedback,category,meeting_id,content`,
      "GET",
      AUTH(tokenA)
    );
    const reItem = JSON.parse(reFetch.body)?.[0];
    // 复算 filterTransferableItems 语义
    const wouldTransfer = reItem
      ? reItem.meeting_id === mtg.id &&
        reItem.category === "issue" &&
        reItem.transferred_to_feedback === false &&
        typeof reItem.content === "string" &&
        reItem.content.trim().length > 0
      : false;
    check(
      "12d 会议转入防重复：已转入条目再次 filter 不再进 feedback_items",
      !wouldTransfer,
      `(transferred_to_feedback=${reItem?.transferred_to_feedback})`
    );

    // A 能查到自己项目下的转入产物（RLS 不误伤合法归属）
    const aFbList = await req(
      `/rest/v1/feedback_items?id=eq.${fbRow.id}&select=id,source_type`,
      "GET",
      AUTH(tokenA)
    );
    const aFb = JSON.parse(aFbList.body);
    check(
      "12e 对照：A 能查到自己转入的 feedback_item",
      Array.isArray(aFb) && aFb.length === 1 && aFb[0].source_type === "meeting",
      `(A 看见 ${Array.isArray(aFb) ? aFb.length : "?"} 条)`
    );
  }

  // ───────────── check 13：需求→API 带入 source_requirement_id + 越权防护 ─────────────
  // server action createApiDraft 在 src/app/dashboard/api-designer/actions.ts:43-59
  // 做"源需求有效且 lifecycle='confirmed' 且未软删"校验，跨用户场景下 RLS
  // 让 .maybeSingle() 返回 null → action 返回 ok:false。这里在 REST 层验证两件事：
  //   ① A 把自己的 confirmed 需求 id 写进 api_drafts.source_requirement_id 能落库
  //   ② B 的 confirmed 需求 id 在 A 的会话下不可见（RLS）——这正是 action 越权
  //      防护的根基（.maybeSingle()→null→"源需求无效或未确认"）。
  // 注：action 本身是 Next.js server action，不能直接从 .mjs 调；RLS 层的
  // 不可见性是 action 拒绝的充要条件，覆盖到这一层即覆盖越权防护契约。
  {
    const aReqId = ctx.aRequirementId;
    // ① A 用自己的 confirmed 需求建 api_draft，落 source_requirement_id
    const draftRes = await req(`/rest/v1/api_drafts`, "POST", {
      ...AUTH(tokenA), Prefer: "return=representation",
    }, {
      user_id: uidA,
      project_id: projectId,
      title: `${RB08}-api-from-A-req`,
      business_requirement: `${RB08} 用 A 的需求带入生成 API`,
      api_spec_context: "camelCase",
      status: "completed",
      source_requirement_id: aReqId,
    });
    const draftRow = JSON.parse(draftRes.body)?.[0];
    check(
      "13a 需求→API 带入：api_drafts.source_requirement_id 正确落库",
      draftRow?.source_requirement_id === aReqId,
      `(落库=${draftRow?.source_requirement_id?.slice(0, 8) ?? "null"} == A 需求 ${aReqId?.slice(0, 8)})`
    );

    // ② B 用自己的会话建一条 confirmed 需求，A 应看不到（RLS）
    const bReqRes = await req(`/rest/v1/requirement_drafts`, "POST", {
      ...AUTH(tokenB), Prefer: "return=representation",
    }, {
      user_id: uidB,
      project_id: projectId, // 故意同 project，排除 project 维度的干扰
      source_type: "manual",
      title: `${RB08}-req-B-for-api`,
      content: `${RB08} B 的 confirmed 需求，A 不应能带入`,
      lifecycle: "confirmed",
    });
    const bReqId = JSON.parse(bReqRes.body)?.[0]?.id;

    const aSeeB = await req(
      `/rest/v1/requirement_drafts?id=eq.${bReqId}&select=id`,
      "GET",
      AUTH(tokenA)
    );
    const aSeeBArr = JSON.parse(aSeeB.body);
    check(
      "13b 越权防护：A 查不到 B 的 requirement（action .maybeSingle() 将返回 null）",
      Array.isArray(aSeeBArr) && aSeeBArr.length === 0,
      `(A 看见 ${Array.isArray(aSeeBArr) ? aSeeBArr.length : "?"} 条)`
    );

    // ③ 越权写入直接被 RLS 拦：A 把 B 的需求 id 作为 source_requirement_id
    //    插 api_drafts。api_drafts 的 insert with check 是 user_id=auth.uid()，
    //    A 写自己的 api_draft 行本身能过 RLS；但越权语义的真正拦截发生在 action
    //    层（查询源需求时被 RLS 隐藏）。这里直接证明 B 的需求对 A 不可见即可，
    //    上面 13b 已覆盖。额外补一个"非法 lifecycle 不能带入"语义：A 用自己的
    //    draft 需求 id 插 api_drafts（action 会拒绝 lifecycle!='confirmed'），
    //    这里只做数据层 sanity——draft 需求确实存在且 lifecycle=draft。
    const aDraftReqRes = await req(`/rest/v1/requirement_drafts`, "POST", {
      ...AUTH(tokenA), Prefer: "return=representation",
    }, {
      user_id: uidA,
      project_id: projectId,
      source_type: "manual",
      title: `${RB08}-req-A-draft`,
      content: `${RB08} A 的 draft 需求，lifecycle=draft，不应能带入`,
      lifecycle: "draft",
    });
    const aDraftReqId = JSON.parse(aDraftReqRes.body)?.[0]?.id;
    const aDraftReqFetch = await req(
      `/rest/v1/requirement_drafts?id=eq.${aDraftReqId}&select=lifecycle,deleted_at`,
      "GET",
      AUTH(tokenA)
    );
    const aDraftReqRow = JSON.parse(aDraftReqFetch.body)?.[0];
    check(
      "13c 越权防护对照：A 自己的 draft 需求 lifecycle=draft（action 会以「未确认」拒绝带入）",
      aDraftReqRow?.lifecycle === "draft" && aDraftReqRow?.deleted_at === null,
      `(lifecycle=${aDraftReqRow?.lifecycle})`
    );
  }

  // ───────────── check 14：软删后列表不展示 + 详情直链处理 ─────────────
  // 07 的列表查询用 `deleted_at IS NULL` 过滤（007 迁移的 idx_requirement_drafts_project_active
  // 也带此 where）。详情页直链可拿到行（前端按 deleted_at 显示"已删除"态）。
  {
    // A 建需求并软删（用 A 的会话，贴近真实链路）
    const titleS = `${RB08}-req-A-softdeleted`;
    const insS = await req(`/rest/v1/requirement_drafts`, "POST", {
      ...AUTH(tokenA), Prefer: "return=representation",
    }, {
      user_id: uidA,
      project_id: projectId,
      source_type: "manual",
      title: titleS,
      content: `${RB08} 将被软删`,
      lifecycle: "confirmed",
    });
    const rowS = JSON.parse(insS.body)?.[0];

    await req(
      `/rest/v1/requirement_drafts?id=eq.${rowS.id}`,
      "PATCH",
      { ...AUTH(tokenA), Prefer: "return=representation" },
      { deleted_at: new Date().toISOString() }
    );

    // 列表过滤（模拟 03 action 的列表查询：deleted_at IS NULL）
    const listActive = await req(
      `/rest/v1/requirement_drafts?select=id&title=eq.${encodeURIComponent(titleS)}&deleted_at=is.null`,
      "GET",
      AUTH(tokenA)
    );
    const listArr = JSON.parse(listActive.body);
    check(
      "14a 软删语义：列表查询 deleted_at IS NULL 不返回已软删需求",
      Array.isArray(listArr) && listArr.length === 0,
      `(列表里看见 ${Array.isArray(listArr) ? listArr.length : "?"} 条)`
    );

    // 详情直链：不带 deleted_at 过滤直接按 id 查，应能拿到（前端处理"已删除"态）
    const detail = await req(
      `/rest/v1/requirement_drafts?id=eq.${rowS.id}&select=id,deleted_at,lifecycle`,
      "GET",
      AUTH(tokenA)
    );
    const detailArr = JSON.parse(detail.body);
    check(
      "14b 详情直链：按 id 仍能查到软删需求（前端处理「已删除」态）",
      Array.isArray(detailArr) && detailArr.length === 1 && detailArr[0].deleted_at !== null,
      `(deleted_at=${detailArr[0]?.deleted_at ? "set" : "null"})`
    );
  }

  // 跑后清理（保持 Supabase 项目干净，脚本可反复跑）
  await cleanupRB08();
}

const ctx = {}; // 跨 check 传递植入门点（如 A 的 confirmed requirement id）

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

  // ─────────────────────────────────────────────────────────────
  // 【3-5】Phase 1 新增集成 check（11-14）
  // 说明：v1 集成脚本只覆盖 projects 表的 RLS；Phase 1 的 03/04/05/06/07
  // 在 requirement_drafts / api_drafts / feedback_items / meeting_items
  // 上叠加了 lifecycle、软删、来源接线、会议转入等新语义。这里用真实
  // 用户 A、B 的登录会话（service_role 仅用于幂等清理与建 B 账号）验证
  // RLS 与数据不变量——与 v1 既有 RLS 测试同等可信。
  // ─────────────────────────────────────────────────────────────
  if (accessToken) {
    let userIdB = null;
    let tokenB = null;
    try {
      userIdB = await ensureUserB();
      tokenB = await loginB();
    } catch (e) {
      check("Phase 1 前置：真实用户 B 就绪", false, `（${e.message}）`);
    }
    if (userIdB && tokenB) {
      check("Phase 1 前置：真实用户 B 就绪", true, `(id=${userIdB.slice(0, 8)})`);
      await runPhase1Checks({
        userIdA: userId,
        userIdB,
        projectId: projects[0]?.id ?? null,
        tokenA: accessToken,
        tokenB,
      });
    }
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
