# TravelSky 请求统计上报设计

## 目标
在大模型完整回答后，向公司后端上报一次统计，覆盖 desktop 与 cli。

- 接口：`POST /ai/data/api/open/code/metric/add`
- 主机：与模型列表请求同源（Tempo host）
- 请求体：
  - `text`：回答字数
  - `other`：工具调用情况 + token 使用
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
- token（写入 `other`）：
  - 汇总同一轮 assistant 消息的 `input/output/reasoning/cache.read/cache.write/total`。
- 工具调用（写入 `other`）：
  - 汇总同一轮 assistant 消息的 `tool` part。
  - 统计 `total`、`by_name`、`by_status`。
- 文件变更（写入 `other.file_change`）：
  - 基于同一轮回答产生的最终 `Snapshot.FileDiff` 聚合。
  - 统计变更文件数、总代码新增行、删除行、新增代码字符数，以及每个文件的明细。
  - 不上传完整 diff 内容，只上传统计数据，降低代码内容外传风险。
- 回答代码块（写入 `other.answer_code`）：
  - 统计回答文本中的 fenced code block。
  - 与真实文件变更分开统计，避免把“展示代码”和“落盘改代码”混在一起。
  - 统计代码块数量、代码行数、代码字符数、语言分布。

`other` 序列化格式：

```json
{
  "token": {
    "input": 0,
    "output": 0,
    "reasoning": 0,
    "cache": { "read": 0, "write": 0 },
    "total": 0
  },
  "tool": {
    "total": 0,
    "by_name": {},
    "by_status": {}
  },
  "file_change": {
    "files": 0,
    "additions": 0,
    "deletions": 0,
    "generated_chars": 0,
    "by_file": []
  },
  "answer_code": {
    "blocks": 0,
    "lines": 0,
    "chars": 0,
    "languages": {}
  }
}
```

## 代码落点（最小入侵）
- 新增 `packages/opencode/src/server/tempo-metric.ts`
  - 负责 metric 接口请求发送。
  - 复用 Tempo 主机与登录态 Cookie（`crowd.token_key`）。
- 新增 `packages/opencode/src/session/metric.ts`
  - 负责会话内 token、工具、文件变更、回答代码块统计聚合与请求体构建。
- 轻量修改 `packages/opencode/src/session/prompt.ts`
  - 在会话完成点基于本轮 `step-start/step-finish` snapshot 计算文件 diff，调用聚合 + 上报。
- 轻量修改 `packages/opencode/src/server/tempo-api.ts`
  - 暴露 `baseURL()`，避免重复维护主机解析逻辑。

## 验证
- `packages/opencode/test/session/metric.test.ts`
  - 验证 token、工具、文件变更、回答代码块统计聚合口径。
- `packages/opencode/test/server/tempo-metric.test.ts`
  - 验证上报 URL、Cookie、请求体、无登录态跳过。
