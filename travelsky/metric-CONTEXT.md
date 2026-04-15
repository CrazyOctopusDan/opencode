# TravelSky Metric - Context

**Gathered:** 2026-04-15
**Status:** Ready for planning/execution

<domain>
## Phase Boundary

在不改 desktop/cli 协议入口的前提下，对 TravelSky 模型回答做一次完成态统计上报。

</domain>

<decisions>
## Implementation Decisions

### 上报边界
- **D-01:** 仅对 `travelsky` provider 上报，避免影响其他 provider。
- **D-02:** 使用与模型列表同源的 Tempo 主机，URL 固定为 `/ai/data/api/open/code/metric/add`。

### 上报时机
- **D-03:** 在会话循环完成、最终 assistant 消息确定后上报一次（每轮 user prompt 一次）。

### 统计口径
- **D-04:** `text` 为同一 `parentID` 下 assistant 文本总字符数。
- **D-05:** `other` 为 JSON 字符串，包含 token 聚合和工具调用聚合。
- **D-06:** `modelName` 使用最终 assistant 的 `modelID`。

### 稳定性策略
- **D-07:** 无 Tempo 登录态（无 Cookie）直接跳过。
- **D-08:** 上报失败/超时不阻断回答流程，超时上限 1.5s。

### the agent's Discretion
- 日志详细字段与告警级别。
- 后续是否改为异步队列批量上报。

</decisions>

<specifics>
## Specific Ideas

- 优先“独立文件 + 最小接入点”，减少后续与上游合并冲突。
- 保留请求体字段不扩展，将 token 统计放入 `other`。

</specifics>

<canonical_refs>
## Canonical References

### Runtime path
- `packages/opencode/src/session/prompt.ts` — 会话完成点（上报触发）
- `packages/opencode/src/session/metric.ts` — 统计聚合口径
- `packages/opencode/src/server/tempo-metric.ts` — metric 请求发送
- `packages/opencode/src/server/tempo-api.ts` — Tempo 主机解析
- `packages/opencode/src/server/tempo-session.ts` — 登录态 token/cookie 缓存

### Docs
- `travelsky/metric-design.md` — 本次需求设计文档

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `TempoApi` 已统一了模型列表主机解析逻辑。
- `TempoSession` 已持有 local token 与上游 token/cookie 的映射。

### Established Patterns
- 会话回复流程统一收敛在 `SessionPrompt.runLoop`。
- 失败容错普遍采用“不影响主链路”的策略。

### Integration Points
- 仅在 `runLoop` 结束点接入一次聚合上报。

</code_context>

<deferred>
## Deferred Ideas

- metric 改为异步落盘+后台重试（降低在线路径时延）
- 后端补充 token 专属字段后，去掉 `other` 内的 token JSON 嵌套

</deferred>

