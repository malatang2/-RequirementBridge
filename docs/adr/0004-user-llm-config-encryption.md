# 用户级 LLM 配置：原子性合并 + AES 单密钥加密

v2 允许用户在配置页填自己的 LLM Provider/API Key/模型映射/Base URL，存入 `profiles.llm_config` jsonb。API Key 用应用层 AES-256-GCM 加密（`src/lib/crypto.ts`），加密密钥来自环境变量 `LLM_CONFIG_ENCRYPTION_KEY`。这套机制取代 v1"LLM Key 仅靠环境变量、用户无法配置"的限制。

## 边界一：原子性合并 + 测试连接前置

配置合并规则：`provider` 默认 dashscope；`apiKey` 用户填了用用户的，否则 fallback 平台环境变量；`modelOverrides` 逐项覆盖默认（用户只改 extract 则 cluster 仍用默认）；`baseUrl` 用户填了用，否则用 provider 默认端点。

**原子性约束**：当 `provider` 非 dashscope（即 OpenAI/custom）时，`apiKey` 必填——平台不提供非默认 provider 的 Key，半配置直接拒绝保存。

**测试连接强制**：保存配置前必须点"测试连接"且通过，否则不落库。这把"配置不完整或不通"的失败前置到保存时，而不是散落到每次 AI 调用时——用户永远要么是完整可用的自定义配置，要么是平台默认，不存在导致所有 AI 任务失败的中间态坏配置。

## 边界二：单密钥不轮换 + 明确泄露预案

v2 不建密钥管理基础设施（Vault/KMS）。`LLM_CONFIG_ENCRYPTION_KEY` 在部署时生成一次，**不轮换**。

密钥属性钉死：
- 仅存于服务端环境变量（`serverEnv`，绝不进 `publicEnv`，永远不返回客户端）
- EF 用 `Deno.env.get` + service_role 读取
- 解密后不写日志（与 Phase 3 凭证安全共用此规则）

**泄露预案**：若密钥泄露，需重新生成密钥 + 清空所有 `profiles.llm_config` + 通知用户重填。这是承认 v2 的局限——轮换需要把所有已加密 apiKey 解密再重新加密，v2 单用户/小团队量级不值得为此建多密钥管理 + 重加密脚本基础设施。假支持轮换但实际未经验证，比明确记录"不轮换 + 泄露预案"更危险。

## Considered Options

- **纯字段级 fallback，无原子性**：被否。允许半配置存在（如 provider=OpenAI 但无 Key），导致 AI 调用失败原因难诊断。
- **全量覆盖（用户配了就必须填全所有字段）**：被否。用户只想换 Key 时体验差，且大多数字段平台默认值已合理。
- **支持手动轮换（apiKeyEnc 带 keyId，多密钥解旧加密新）**：被否。需建多密钥管理 + 重加密脚本，v2 阶段过度设计。
- **Supabase Vault / 外部 KMS**：被否。引入平台依赖与成本，单用户量级 ROI 不足；v3 引入团队协作时升级。

## Consequences

- v2 加密层单一来源：`src/lib/crypto.ts` 同时服务 Phase 2 用户 LLM 配置（本 ADR）和 Phase 3 第三方凭证加密（ADR 范围外但共用同一密钥与函数）。
- 升级到密钥轮换/KMS 的触发条件：v3 引入团队协作（多用户共享凭证、组织级密钥隔离），或单用户凭证量级达到重加密成本可接受时。
