/**
 * AI 评测脚本（Day 6 / T5.2）—— 跑真实 DashScope，对应《开发工作流规范 §4》AI 评测门禁。
 *
 * 用法：node scripts/run-eval.mjs
 * 消费真实 DashScope token（不在 CI 跑，手动/里程碑跑）。
 * 读取 tests/eval/*.json 评测集，调 DashScope，用 eval-runner 判定，输出报告。
 *
 * 门槛：程序化项不达标 = 失败（exit 1），人工项仅记录。
 */

import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ============ 配置 ============
const DASHSCOPE_BASE = process.env.DASHSCOPE_BASE_URL ?? "https://dashscope.aliyuncs.com/compatible-mode/v1";
const DASHSCOPE_KEY = process.env.DASHSCOPE_API_KEY;

if (!DASHSCOPE_KEY) {
  console.error("❌ 缺少 DASHSCOPE_API_KEY 环境变量");
  process.exit(1);
}

function dashscopeChat(model, messages, jsonMode = false) {
  const body = { model, messages, temperature: 0.2 };
  if (jsonMode) body.response_format = { type: "json_object" };
  return new Promise((resolve, reject) => {
    const reqBody = JSON.stringify(body);
    const req = https.request(
      `${DASHSCOPE_BASE}/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${DASHSCOPE_KEY}`,
          "Content-Length": Buffer.byteLength(reqBody),
        },
      },
      (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => {
          try {
            const json = JSON.parse(d);
            resolve({
              content: json?.choices?.[0]?.message?.content ?? "",
              ok: res.statusCode === 200,
              status: res.statusCode,
              raw: d,
            });
          } catch (e) {
            reject(new Error(`解析失败 ${res.statusCode}: ${d.slice(0, 200)}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(reqBody);
    req.end();
  });
}

// ============ 复用 Prompt（与 Edge Function 一致）============
const MEETING_PROMPT = `你是会议纪要结构化助手。从会议文本中提取四类条目（decision/todo/requirement/issue），每条含 category/content/assignee/priority/quote。另输出 summary。仅输出 JSON：{"summary":"...","items":[...]}`;

const API_PROMPT = `你是 OpenAPI 3.0 接口设计专家。根据业务需求生成规范的 OpenAPI 3.0 YAML。

绝对强制的约束（违反即不合格）：
1. 第一行必须是 openapi: 3.0.x（如 openapi: 3.0.0）
2. 所有字段命名 camelCase（禁止 user_name 等 snake_case）
3. 每个 path 的每个操作（get/post/put/delete）的 responses 必须同时包含这四个错误码：'400'、'401'、'404'、'500'，一个都不能少
4. 包含 components/schemas 定义所有数据模型
5. 不要用 markdown 代码块包裹，直接输出纯 YAML`;

const FEEDBACK_PROMPT = `你是用户反馈分析专家。对一批反馈做主题聚类，输出 JSON：{"topics":[{"name":"...","summary":"...","sentiment":"positive|negative|neutral","priority":"high|medium|low","item_indices":[0,1]}],"unassigned_indices":[2]}`;

// ============ 评测执行 ============
function loadEval(name) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "tests/eval", `${name}.json`), "utf-8"));
}

function parseJsonLoose(content) {
  const cleaned = content.replace(/^```json\s*|\s*```$/g, "").trim();
  return JSON.parse(cleaned);
}

async function runMeetingEval() {
  const evalSet = loadEval("meeting_eval");
  console.log("\n📋 模块一·会议提取评测");
  const results = [];
  for (const sample of evalSet.samples) {
    process.stdout.write(`  样本 ${sample.id}... `);
    try {
      const res = await dashscopeChat("qwen-max", [
        { role: "system", content: MEETING_PROMPT },
        { role: "user", content: sample.input },
      ], true);
      if (!res.ok) { console.log(`❌ HTTP ${res.status}`); results.push({ passed: false }); continue; }
      const parsed = parseJsonLoose(res.content);
      const r = judgeMeeting(parsed, sample.input, sample.expected, sample.id);
      console.log(r.passed ? "✅" : "❌");
      r.checks.forEach((c) => console.log(`     ${c.passed ? "✓" : "✗"} ${c.name} ${c.detail ?? ""}`));
      results.push(r);
    } catch (e) {
      console.log(`❌ 异常: ${e.message}`);
      results.push({ passed: false });
    }
  }
  return results;
}

// 简化判定（与 eval-runner.ts evaluateMeetingExtraction 同逻辑，独立实现避免 import）
function judgeMeeting(raw, rawText, expected, id) {
  const checks = [];
  const items = (raw.items ?? []).filter((i) => i.content && i.content.trim());
  checks.push({ name: `条目数 ≥ ${expected.itemCountMin}`, passed: items.length >= expected.itemCountMin, detail: `实际 ${items.length}` });
  const cats = new Set(items.map((i) => (i.category || "").toLowerCase()));
  const expectedHit = (expected.categories || []).filter((c) => cats.has(c));
  checks.push({ name: "分类覆盖", passed: expectedHit.length >= Math.min(3, expected.categories.length), detail: `命中 ${expectedHit.join("/")}` });
  const withQuote = items.filter((i) => i.quote);
  const traceable = withQuote.filter((i) => rawText.includes(i.quote));
  const rate = withQuote.length > 0 ? traceable.length / withQuote.length : 1;
  checks.push({ name: "引用追溯率 ≥ 90%", passed: rate >= 0.9, detail: withQuote.length > 0 ? `${traceable.length}/${withQuote.length}` : "无引用" });
  return { sampleId: id, passed: checks.every((c) => c.passed), checks };
}

function judgeApi(yamlText, expected, id) {
  const checks = [];
  const hasOpenapi = /^openapi:\s*3\./m.test(yamlText);
  const hasPaths = /^paths:/m.test(yamlText);
  checks.push({ name: "含 openapi 3.x", passed: hasOpenapi });
  checks.push({ name: "含 paths", passed: hasPaths });
  const errOk = expected.mustHaveErrorCodes.every((c) => new RegExp(`['"]?${c}['"]?:`).test(yamlText));
  checks.push({ name: "错误码完整", passed: errOk, detail: expected.mustHaveErrorCodes.join("/") });
  const hasSchemas = /schemas:/.test(yamlText);
  if (expected.mustHaveSchemas) checks.push({ name: "含 schemas", passed: hasSchemas });
  const snake = (yamlText.match(/[a-z]_[a-z]/g) || []).length;
  checks.push({ name: "camelCase 无 snake_case", passed: snake === 0, detail: snake > 0 ? `${snake}处` : "合规" });
  return { sampleId: id, passed: checks.every((c) => c.passed), checks };
}

function judgeFeedback(raw, totalCount, expected, id) {
  const checks = [];
  const topics = (raw.topics || []).filter((t) => t.name && t.name.trim());
  checks.push({ name: `主题数 ≥ ${expected.topicCountMin}`, passed: topics.length >= expected.topicCountMin, detail: `实际 ${topics.length}` });
  const assigned = topics.reduce((s, t) => s + (t.item_indices || []).filter((i) => i >= 0 && i < totalCount).length, 0);
  const coverage = totalCount > 0 ? assigned / totalCount : 0;
  checks.push({ name: "覆盖率 ≥ 70%", passed: coverage >= 0.7, detail: `${assigned}/${totalCount} = ${(coverage * 100).toFixed(0)}%` });
  const allHave = topics.every((t) => (t.item_indices || []).length > 0);
  checks.push({ name: "主题非空", passed: allHave });
  return { sampleId: id, passed: checks.every((c) => c.passed), checks };
}

async function runApiEval() {
  const evalSet = loadEval("api_eval");
  console.log("\n🔌 模块二·API 生成评测");
  const results = [];
  for (const sample of evalSet.samples) {
    process.stdout.write(`  样本 ${sample.id}... `);
    try {
      const res = await dashscopeChat("qwen-max", [
        { role: "system", content: API_PROMPT },
        { role: "user", content: sample.input },
      ]);
      if (!res.ok) { console.log(`❌ HTTP ${res.status}`); results.push({ passed: false }); continue; }
      // 健壮清理 markdown 包裹（去除首尾 ```yaml / ```，含前后空行/空格）
      const yaml = res.content
        .trim()
        .replace(/^```(?:yaml|yml)?\s*\n?/i, "")
        .replace(/\n?```\s*$/, "")
        .trim();
      const r = judgeApi(yaml, sample.expected, sample.id);
      console.log(r.passed ? "✅" : "❌");
      r.checks.forEach((c) => console.log(`     ${c.passed ? "✓" : "✗"} ${c.name} ${c.detail ?? ""}`));
      results.push(r);
    } catch (e) {
      console.log(`❌ 异常: ${e.message}`);
      results.push({ passed: false });
    }
  }
  return results;
}

async function runFeedbackEval() {
  const evalSet = loadEval("feedback_eval");
  console.log("\n💬 模块三·反馈聚类评测");
  const results = [];
  for (const sample of evalSet.samples) {
    process.stdout.write(`  样本 ${sample.id}... `);
    try {
      const indexed = sample.input.map((it, i) => `[${i}] ${it}`).join("\n");
      const res = await dashscopeChat("qwen-plus", [
        { role: "system", content: FEEDBACK_PROMPT },
        { role: "user", content: `共 ${sample.input.length} 条：\n${indexed}` },
      ], true);
      if (!res.ok) { console.log(`❌ HTTP ${res.status}`); results.push({ passed: false }); continue; }
      const parsed = parseJsonLoose(res.content);
      const r = judgeFeedback(parsed, sample.input.length, sample.expected, sample.id);
      console.log(r.passed ? "✅" : "❌");
      r.checks.forEach((c) => console.log(`     ${c.passed ? "✓" : "✗"} ${c.name} ${c.detail ?? ""}`));
      results.push(r);
    } catch (e) {
      console.log(`❌ 异常: ${e.message}`);
      results.push({ passed: false });
    }
  }
  return results;
}

// ============ 主流程 ============
async function main() {
  console.log("═══════════════════════════════════════");
  console.log("  RequirementBridge AI 评测门禁（CP5）");
  console.log("═══════════════════════════════════════");

  const all = [];
  all.push(...(await runMeetingEval()));
  all.push(...(await runApiEval()));
  all.push(...(await runFeedbackEval()));

  const passed = all.filter((r) => r.passed).length;
  const failed = all.length - passed;

  console.log("\n═══════════════════════════════════════");
  console.log(`  总计：${all.length} 项 | ✅ ${passed} 通过 | ❌ ${failed} 失败`);
  console.log(`  结论：${failed === 0 ? "✅ PASS — 准确度门槛达标" : "❌ FAIL — 存在不达标项，需修复"}`);
  console.log("═══════════════════════════════════════\n");

  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error("评测异常:", e); process.exit(2); });
