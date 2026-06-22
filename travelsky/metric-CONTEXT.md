# TravelSky Metric - Context

**Gathered:** 2026-04-15
**Status:** Ready for planning/execution

<domain>
## Phase Boundary

在不改 desktop/cli 协议入口的前提下，对 TravelSky 模型回答做一次完成态生成记录上报，并将本轮最终文件 diff 视为 agent 时代的采纳量上报。

</domain>

<decisions>
## Implementation Decisions

### 上报边界

- **D-01:** 仅对 `travelsky` provider 上报，避免影响其他 provider。
- **D-02:** 使用与模型列表同源的 Tempo 主机；当前生成记录 URL 固定为 `/ai/data/api/record/saveGeneration`，采纳量 URL 固定为 `/record/addAdoption`。

### 上报时机

- **D-03:** 在会话循环完成、最终 assistant 消息确定后上报一次（每轮 user prompt 一次）。

### 统计口径

- **D-04:** `moduleName` 使用最终 assistant 的 `modelID`；`promptName` 使用 assistant 所属 agent。
- **D-05:** `requestContent` 使用本轮父 user message 文本；`responseContent` 使用同一 `parentID` 下 assistant 文本。
- **D-06:** `generatedLines` 使用第一版文件变更聚合得到的新增行数；`codeLanguage` 使用该聚合中的主语言。
- **D-09:** 第一版 `other.v1` 矩阵不再作为当前接口 body 发送，但其文件变更聚合仍作为 `generatedLines/codeLanguage` 的来源：优先使用完成态 `Snapshot.FileDiff`，合并 `edit/write/apply_patch` 工具 metadata 覆盖不到的文件，diff 为空时兜底到工具 metadata。
- **D-10:** 第一版 `other.v2` 会话/工具矩阵保留在文档中作为历史口径，不进入当前生成记录接口。
- **D-11:** 采纳量接口必须使用生成记录返回的 `data` 作为 `qaid`；只要本轮最终文件 diff 有新增或删除行，即视为采纳。
- **D-12:** `adoptedLines` 使用最终 diff 新增行数，`deletedLines` 使用最终 diff 删除行数；`adoptedContent` 固定传空字符串，不上传代码内容。

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
- 第一版 `text/modelName/other.v1/v2` 保留在实现文档中，不再作为当前请求体发送。
- 当前接口字段直接平铺为生成记录 body，避免后端继续解析旧矩阵。

</specifics>

<canonical_refs>

## Canonical References

### Runtime path

- `packages/opencode/src/session/prompt.ts` — 会话完成点（上报触发）
- `packages/opencode/src/session/metric.ts` — 生成记录 body 与采纳量 body 构建；复用第一版文件变更聚合计算 `generatedLines/codeLanguage/adoptedLines/deletedLines`
- `packages/opencode/src/snapshot/index.ts` — 内部 snapshot diff，非 git 目录使用当前目录作为对比根
- `packages/opencode/src/tool/write.ts` — `write` 工具输出 `metadata.filediff`，供 snapshot diff 缺失时兜底
- `packages/opencode/src/server/tempo-metric.ts` — 生成记录与采纳量请求发送
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
- 如果后端需要恢复矩阵统计，后续通过新的接口版本或新增字段扩展，不把第一版 `other.v1/v2` 混回当前生成记录 body
- 如果后续产品提供显式采纳/撤销事件，再重新评估是否从“最终文件 diff 即采纳”切换为显式事件口径

</deferred>
