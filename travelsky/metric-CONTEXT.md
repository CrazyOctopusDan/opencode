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
- **D-05:** `other` 为 JSON 字符串，包含 `v1` 文件变更矩阵和 `v2` 会话/工具矩阵，不再写入 token 与回答代码块旧口径。
- **D-06:** `modelName` 使用最终 assistant 的 `modelID`。
- **D-09:** `other.v1` 优先使用本轮回答 `step-start/step-finish` snapshot 计算出的 `Snapshot.FileDiff` 聚合；非 git 目录也必须通过内部 snapshot 对当前目录做前后对比；当工具 metadata 有已完成文件变更时，从 `edit/write/apply_patch` 的 `filediff/files` 合并 snapshot 覆盖不到的文件；当 snapshot diff 为空时完全兜底到工具 metadata，统计修改/新增/删除文件数、增删行、净增行、语言分布、单文件最大修改行数。
- **D-10:** `other.v2` 统计用户消息数、Agent 回复数、Agent step 数、工具调用次数、工具类型分布、成功率、失败次数、失败原因与会话结束类型。
- **D-11:** 重复修改文件数优先基于 `edit/write/apply_patch` 工具事件的目标文件统计，同一文件出现 2 次及以上计为重复修改。

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
- 保留请求体字段不扩展，将领导要求的文件变更矩阵放入 `other.v1`。
- 将扩展会话/工具矩阵放入 `other.v2`，避免后端统计口径互相污染。

</specifics>

<canonical_refs>

## Canonical References

### Runtime path

- `packages/opencode/src/session/prompt.ts` — 会话完成点（上报触发）
- `packages/opencode/src/session/metric.ts` — `other.v1` 文件变更矩阵与 `other.v2` 会话/工具矩阵聚合口径
- `packages/opencode/src/snapshot/index.ts` — 内部 snapshot diff，非 git 目录使用当前目录作为对比根
- `packages/opencode/src/tool/write.ts` — `write` 工具输出 `metadata.filediff`，供 snapshot diff 缺失时兜底
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
- `Snapshot.diffFull` 已能基于 step snapshot 计算同一段消息的文件 diff。
- 失败容错普遍采用“不影响主链路”的策略。

### Integration Points

- 仅在 `runLoop` 结束点接入一次 diff 计算、聚合上报。

</code_context>

<deferred>
## Deferred Ideas

- metric 改为异步落盘+后台重试（降低在线路径时延）
- 如果后端需要 token 统计，后续通过独立字段或 `other.v3` 扩展，避免污染当前 v2 矩阵

</deferred>
