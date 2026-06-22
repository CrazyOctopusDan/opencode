# TravelSky 请求统计上报设计

## 目标

在大模型完整回答后，向公司后端添加一条生成记录，覆盖 desktop 与 cli；如果本轮回答最终造成文件变更，则直接把最终文件 diff 视为 agent 时代的采纳量，并通过生成记录返回的 `data` 作为 `qaid` 上报采纳量。

- 当前生成记录接口：`POST /ai/data/api/record/saveGeneration`
- 当前采纳量接口：`POST /record/addAdoption`
- 主机：与模型列表请求同源（Tempo host）
- Header：复用 Tempo 登录态 Cookie，`crowd.token_key=<token>`
- 生成记录请求体：
  - `moduleName`：AI 模型名称，使用本次最终 assistant 的 `modelID`
  - `promptName`：提示词模板名称，使用 assistant 所属 agent
  - `generatedLines`：生成代码行数，优先来自本轮最终文件 diff 的新增行数，并合并工具 metadata 兜底
  - `sessionId`：会话 ID
  - `codeLanguage`：代码语言，按本轮文件变更语言分布取主语言
  - `toolName`：插件名称，Desktop 为 `opencode-desktop`，其他本地 client 为 `opencode-cli`
  - `toolVersion`：插件版本，使用当前 opencode 安装版本
  - `ideName`：IDE 名称，当前固定为 `OpenCode`
  - `ideVersion`：IDE 版本，使用当前 opencode 安装版本
  - `projectName`：代码项目名称，使用 assistant path root 的目录名
  - `requestContent`：模型请求内容，当前可观测口径为本轮 user prompt 文本
  - `responseContent`：模型响应内容，当前可观测口径为同一 `parentID` 下 assistant 文本
- 生成记录响应：`success/message/code/data/timestamp`，其中 `data` 为记录 id，后续采纳量接口的 `qaid` 使用该值。
- 采纳量请求体：`qaid`、`adoptedLines`、`adoptedContent`、`deletedLines`。

## 范围与边界

- 仅对 TravelSky provider 上报（`providerID` 大小写不敏感匹配 `travelsky`）。
- 上报失败不影响主流程回答（容错降级）。
- 请求超时控制为 1.5s，避免影响交互时延。
- 当前在完成态自动添加生成记录；生成记录成功返回 qaid 后，如果最终文件 diff 有新增或删除行，则立即自动上报采纳量。
- `adoptedContent` 固定传空字符串，避免上传完整代码内容；当前没有采纳内容统计需求。

## 统计口径

- 上报时机：会话循环结束、最终 assistant 消息确定后，单次上报。
- 生成代码行数（`generatedLines`）：
  - 基于同一轮回答产生的最终 `Snapshot.FileDiff` 聚合。
  - 即使用户打开的目录不是 git 仓库，也通过 opencode 内部 snapshot 对当前目录做前后对比，不能要求用户先 `git init` 才能统计。
  - 如果本轮存在已完成的 `edit/write/apply_patch` 工具变更，则将 snapshot diff 覆盖不到的工具文件合并进统计；这用于覆盖 `/projecta/b` 会话中修改 `~/xxxx/filec` 这类项目外文件。
  - 如果 snapshot diff 为空，则从工具 metadata 中的 `filediff/files` 兜底聚合，避免生成行数全部归零。
  - `bash` 直接写入项目外文件时，除非能被内部 snapshot 覆盖或后续工具 metadata 暴露，否则无法可靠还原行级 diff；后续如需强覆盖，应增加 shell 外部目录前后快照或约束模型使用 Write/Edit。
  - 当前发送给后端的是新增行数 `line_changes.added`；删除行数不计入 `generatedLines`。
- 代码语言（`codeLanguage`）：
  - 复用文件变更聚合的语言分布，取出现次数最多的语言。
  - 没有可识别文件变更时返回 `Other`。
- 请求/响应内容：
  - `requestContent` 使用本轮父 user message 的文本 part 拼接。
  - `responseContent` 使用同一 `parentID` 下非 summary assistant 文本 part 拼接。
- 采纳量：
  - agent 时代没有 Continue/VSCode 的显式“点击采纳”动作；只要模型通过工具让文件系统最终发生变更，即视为采纳。
  - `adoptedLines` 使用本轮最终文件 diff 的新增行数。
  - `deletedLines` 使用本轮最终文件 diff 的删除行数。
  - `adoptedContent` 固定为空字符串。
  - 如果生成记录失败或本轮最终没有文件变更，则不发送采纳量。

## 第一版统计矩阵（历史实现，保留供后续维度变化参考）

第一版接口为 `POST /ai/data/api/open/code/metric/add`，请求体为：

- `text`：回答字数，同一轮 user prompt（同 `parentID`）下所有 assistant 文本片段总 Unicode 字符数。
- `other`：v1 + v2 统计矩阵 JSON。
- `modelName`：本次使用模型。

第一版 v1 文件变更矩阵（写入 `other.v1`）：

- 基于同一轮回答产生的最终 `Snapshot.FileDiff` 聚合。
- 非 git 目录通过 opencode 内部 snapshot 对当前目录做前后对比。
- 已完成的 `edit/write/apply_patch` 工具变更会把 snapshot diff 覆盖不到的工具文件合并进 v1。
- snapshot diff 为空时，从工具 metadata 中的 `filediff/files` 兜底聚合。
- 统计修改文件数、新增文件数、删除文件数、added/deleted/net 行数、修改语言分布、单文件最大修改行数。
- 不上传完整 diff 内容，只上传统计数据，降低代码内容外传风险。

第一版 v2 会话/工具矩阵（写入 `other.v2`）：

- 基于当前可见消息流统计用户消息数、Agent 回复数、Agent 思考轮次。
- 工具调用次数、工具调用类型分布、工具调用成功率、工具失败次数来自 `tool` part。
- 工具失败原因优先使用 tool metadata 的错误码；缺失时按错误文本归类为 permission/path/command/unknown。
- 会话中断类型基于 assistant error 与工具失败推断为 user_stop/model_error/tool_error/normal_end。
- token 与回答代码块统计不再写入 `other`，避免 v2 矩阵与旧口径混杂。

第一版 `other` 序列化格式：

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

- `packages/opencode/src/server/tempo-metric.ts`
  - 负责生成记录和采纳量接口请求发送。
  - 复用 Tempo 主机与登录态 Cookie（`crowd.token_key`）。
- `packages/opencode/src/session/metric.ts`
  - 负责生成记录请求体构建。
  - 继续复用第一版文件变更聚合能力，为 `generatedLines` 与 `codeLanguage` 提供来源。
  - 负责从同一份文件变更聚合构建采纳量行数，`adoptedContent` 固定为空。
- 轻量修改 `packages/opencode/src/tool/write.ts`
  - 为 `write` 工具补充 `metadata.filediff`，供 v1 在 snapshot diff 缺失时兜底统计文件状态与行数。
- 轻量修改 `packages/opencode/src/session/prompt.ts`
  - 在会话完成点基于本轮 `step-start/step-finish` snapshot 计算文件 diff，调用生成记录上报；拿到 qaid 且存在最终文件变更时继续上报采纳量。
- 轻量修改 `packages/opencode/src/snapshot/index.ts`
  - 非 git 目录使用当前目录作为内部 snapshot worktree，保证 shell/bash 创建文件也能进入最终 diff。
- 轻量修改 `packages/opencode/src/server/tempo-api.ts`
  - 暴露 `baseURL()`，避免重复维护主机解析逻辑。

## 验证

- `packages/opencode/test/session/metric.test.ts`
  - 验证生成记录请求体、生成行数、语言、请求/响应内容、采纳量空内容、provider 过滤口径。
- `packages/opencode/test/server/tempo-metric.test.ts`
  - 验证生成记录 URL、采纳量 URL、Cookie、请求体、采纳内容为空、无登录态跳过、失败/过期静默处理。
- `packages/opencode/test/tool/write.test.ts`
  - 验证 `write` 工具输出 `metadata.filediff`。
- `packages/opencode/test/snapshot/snapshot.test.ts`
  - 验证非 git 目录也能通过内部 snapshot 得到新增文件 diff。
