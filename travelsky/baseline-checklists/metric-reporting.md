# TravelSky Metric 上报统计矩阵合并保护清单

## 保护目标

未来从 `dev` 合并到 `dev-sapphire` 时，必须保留 TravelSky metric 完成态单次上报，以及 `other.v1`、`other.v2` 两套统计矩阵。`v1` 用于领导要求的文件改动统计，`v2` 用于扩展的会话与工具调用统计。

## 输入范围

- 来源：未提交 staged/unstaged diff。
- 相关提交：无，本清单基于当前未提交实现变更生成。

## 保护文件

- `packages/opencode/src/session/metric.ts`：构建 `text/modelName/other` 上报体，定义 `other.v1` 与 `other.v2` 的统计口径。
- `packages/opencode/src/session/prompt.ts`：完成态单次上报触发点，仍负责传入本轮 `Snapshot.FileDiff`。
- `packages/opencode/src/server/tempo-metric.ts`：发送 metric 请求并保持失败/失效静默，不影响对话主链路。
- `packages/opencode/test/session/metric.test.ts`：回归验证 `other.v1/v2` 聚合结构与 provider 过滤。
- `packages/opencode/test/server/tempo-metric.test.ts`：回归验证 metric 请求发送、无登录态跳过、token 失效静默失败。
- `travelsky/metric-design.md`、`travelsky/metric-CONTEXT.md`：记录统计矩阵设计与决策背景。

## 不变量

- metric 仍只对 `providerID` 大小写不敏感匹配 `travelsky` 时构建上报体。
- `text` 仍按同一 `parentID` 下非 summary assistant 文本片段的 Unicode 字符数统计。
- `other` 必须是 JSON 字符串，顶层必须包含 `v1` 和 `v2`。
- `other.v1` 必须包含：`modified_files`、`added_files`、`deleted_files`、`line_changes.added/deleted/total/net`、`language_distribution`、`max_single_file_changed_lines`、`repeated_modified_files`、`by_file`。
- `other.v1` 文件改动必须来自本轮完成态 `Snapshot.FileDiff` 聚合，不能上传完整 diff 原文。
- `other.v1.repeated_modified_files` 必须优先基于当前回答中的 `edit/write/apply_patch` 完成事件统计，同一文件出现 2 次及以上计为重复修改。
- `other.v2` 必须包含：`user_messages`、`agent_replies`、`agent_steps`、`tool_calls`、`tool_call_type_distribution`、`tool_call_success_rate`、`tool_failures`、`tool_failure_codes`、`session_end_reason`。
- `other.v2.agent_steps` 必须基于 `step-finish` part 统计；工具调用统计必须基于 `tool` part。
- `other.v2.tool_failure_codes` 优先使用工具 metadata 中的 `code/errorCode/error_code`，缺失时再按错误文本归类。
- token 与回答代码块统计不再写入 `other`，避免与 `v1/v2` 矩阵混杂。

## 冲突处理规则

- 上游如果也改了 metric 聚合，必须语义合并，不能回退到旧的 `token/tool/file_change/answer_code` 顶层结构。
- 上游如果调整消息 part 或 tool state 结构，优先保留 `v1`、`v2` 字段名和含义，再适配新的事件来源。
- 上游如果调整 snapshot diff 结构，必须保持 `v1` 使用完成态最终 diff 聚合，不能改成上传 patch 内容。
- 上游如果调整上报时机，必须保留每轮回答完成后单次上报，避免中间 step 重复上报。
- 上游如果调整 Tempo metric 发送层，仍必须保持失败、超时、token 失效不打扰用户对话。

## 验证方式

- 在 `packages/opencode` 目录运行：`bun test test/session/metric.test.ts test/server/tempo-metric.test.ts`。
- 在 `packages/opencode` 目录运行：`bun typecheck`。
- 如果本机默认 Node 版本低于 `@typescript/native-preview` 要求，可临时将 Node 22 放到 `PATH` 前面后再运行 `bun typecheck`。
- 人工检查 `other` 序列化结果，确认顶层为 `{ "v1": ..., "v2": ... }`，且不再包含顶层 `token`、`tool`、`answer_code`。

## 停止条件

- 上游删除或重构 `MessageV2`、`tool` part、`step-finish` part、`Snapshot.FileDiff` 或 `SessionPrompt.runLoop` 完成态上报点时，不能机械解冲突，必须重新核对统计来源。
- 公司后端要求新的 `other` schema、字段命名或统计范围时，必须同步更新实现、测试、设计文档和本清单。
- 如果未来要恢复 token 统计，必须走新版本字段或独立字段，不能把旧 token 结构重新混入当前 `v1/v2` 矩阵。
