# TravelSky 请求统计上报设计

## 目标

在大模型完整回答后，向公司后端上报一次统计，覆盖 desktop 与 cli。

- 接口：`POST /ai/data/api/open/code/metric/add`
- 主机：与模型列表请求同源（Tempo host）
- 请求体：
  - `text`：回答字数
  - `other`：v1 + v2 统计矩阵 JSON
  - `modelName`：本次使用模型

## 范围与边界

- 仅对 TravelSky provider 上报（`providerID` 大小写不敏感匹配 `travelsky`）。
- 上报失败不影响主流程回答（容错降级）。
- 请求超时控制为 1.5s，避免影响交互时延。

## 统计口径

- 上报时机：会话循环结束、最终 assistant 消息确定后，单次上报。
- 回答字数（`text`）：
  - 统计同一轮 user prompt（同 `parentID`）下所有 assistant 文本片段总字符数。
  - 按 Unicode 字符数计算。
- v1 文件变更矩阵（写入 `other.v1`）：
  - 基于同一轮回答产生的最终 `Snapshot.FileDiff` 聚合。
  - 即使用户打开的目录不是 git 仓库，也通过 opencode 内部 snapshot 对当前目录做前后对比，不能要求用户先 `git init` 才能统计。
  - 如果本轮存在已完成的 `edit/write/apply_patch` 工具变更，则将 snapshot diff 覆盖不到的工具文件合并进 v1；这用于覆盖 `/projecta/b` 会话中修改 `~/xxxx/filec` 这类项目外文件。
  - 如果 snapshot diff 为空，则从工具 metadata 中的 `filediff/files` 兜底聚合，避免 v1 全部归零。
  - `bash` 直接写入项目外文件时，除非能被内部 snapshot 覆盖或后续工具 metadata 暴露，否则无法可靠还原行级 diff；后续如需强覆盖，应增加 shell 外部目录前后快照或约束模型使用 Write/Edit。
  - 统计修改文件数、新增文件数、删除文件数、added/deleted/net 行数、修改语言分布、单文件最大修改行数。
  - 不上传完整 diff 内容，只上传统计数据，降低代码内容外传风险。
- v2 会话/工具矩阵（写入 `other.v2`）：
  - 基于当前可见消息流统计用户消息数、Agent 回复数、Agent 思考轮次。
  - 工具调用次数、工具调用类型分布、工具调用成功率、工具失败次数来自 `tool` part。
  - 工具失败原因优先使用 tool metadata 的错误码；缺失时按错误文本归类为 permission/path/command/unknown。
  - 会话中断类型基于 assistant error 与工具失败推断为 user_stop/model_error/tool_error/normal_end。
  - token 与回答代码块统计不再写入 `other`，避免 v2 矩阵与旧口径混杂。

`other` 序列化格式：

```json
{
  "v1": {
    "modified_files": 0,
    "added_files": 0,
    "deleted_files": 0,
    "line_changes": {
      "added": 0,
      "deleted": 0,
      "total": 0,
      "net": 0
    },
    "language_distribution": {},
    "max_single_file_changed_lines": 0,
    "repeated_modified_files": 0,
    "by_file": []
  },
  "v2": {
    "user_messages": 0,
    "agent_replies": 0,
    "agent_steps": 0,
    "tool_calls": 0,
    "tool_call_type_distribution": {},
    "tool_call_success_rate": 0,
    "tool_failures": 0,
    "tool_failure_codes": {},
    "session_end_reason": "normal_end"
  }
}
```

## 代码落点（最小入侵）

- 新增 `packages/opencode/src/server/tempo-metric.ts`
  - 负责 metric 接口请求发送。
  - 复用 Tempo 主机与登录态 Cookie（`crowd.token_key`）。
- 新增 `packages/opencode/src/session/metric.ts`
  - 负责 `other.v1` 文件变更矩阵、`other.v2` 会话/工具矩阵统计聚合与请求体构建。
- 轻量修改 `packages/opencode/src/tool/write.ts`
  - 为 `write` 工具补充 `metadata.filediff`，供 v1 在 snapshot diff 缺失时兜底统计文件状态与行数。
- 轻量修改 `packages/opencode/src/session/prompt.ts`
  - 在会话完成点基于本轮 `step-start/step-finish` snapshot 计算文件 diff，调用聚合 + 上报。
- 轻量修改 `packages/opencode/src/snapshot/index.ts`
  - 非 git 目录使用当前目录作为内部 snapshot worktree，保证 shell/bash 创建文件也能进入最终 diff。
- 轻量修改 `packages/opencode/src/server/tempo-api.ts`
  - 暴露 `baseURL()`，避免重复维护主机解析逻辑。

## 验证

- `packages/opencode/test/session/metric.test.ts`
  - 验证 `other.v1` 文件变更矩阵、工具 metadata 兜底、`other.v2` 会话/工具矩阵、provider 过滤口径。
- `packages/opencode/test/server/tempo-metric.test.ts`
  - 验证上报 URL、Cookie、请求体、无登录态跳过。
- `packages/opencode/test/tool/write.test.ts`
  - 验证 `write` 工具输出 `metadata.filediff`。
- `packages/opencode/test/snapshot/snapshot.test.ts`
  - 验证非 git 目录也能通过内部 snapshot 得到新增文件 diff。
