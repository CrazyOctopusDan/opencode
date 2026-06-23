# TravelSky Metric 上报合并保护清单

## 保护目标

未来从 `dev` 合并到 `dev-sapphire` 时，必须保留 TravelSky 完成态单次添加生成记录，以及“最终文件 diff 即采纳”的采纳量上报。第一版 `other.v1` 文件矩阵不再作为当前请求体发送，但其文件变更聚合能力必须保留，用于当前 `generatedLines`、`codeLanguage`、`adoptedLines` 与 `deletedLines`。

## 输入范围

- 来源：未提交 staged/unstaged diff。
- 相关提交：无，本清单基于当前未提交实现变更生成。

## 保护文件

- `packages/opencode/src/session/metric.ts`：构建生成记录和采纳量上报体，复用第一版文件变更聚合计算 `generatedLines`、`codeLanguage`、`adoptedLines` 与 `deletedLines`。
- `packages/core/src/flag/flag.ts`：暴露 `OPENCODE_TOOL_NAME`，供统计请求体显式区分 Desktop 与 CLI。
- `packages/desktop/src/main/server.ts`：普通 Desktop sidecar 环境注入 `OPENCODE_TOOL_NAME=opencode-desktop`。
- `packages/desktop/src/main/wsl/sidecar.ts`：WSL sidecar 启动脚本注入 `OPENCODE_TOOL_NAME=opencode-desktop`。
- `packages/opencode/script/build.ts`：CLI 二进制 build 必须注入 `OPENCODE_TOOL_NAME=opencode-cli`，保证 CLI 生产包上报为 CLI。
- `packages/opencode/script/build-node.ts`：Desktop sidecar 使用的 node server build 必须注入 `OPENCODE_VERSION`，保证 `InstallationVersion` 在生产包中不是 `local`。
- `packages/opencode/src/session/prompt.ts`：完成态单次上报触发点，仍负责传入本轮 `Snapshot.FileDiff`，并在生成记录返回 qaid 后继续上报采纳量。
- `packages/opencode/src/snapshot/index.ts`：内部 snapshot diff 来源；非 git 目录必须用当前目录作为对比根，支撑 shell/bash 等工具产生的最终文件 diff。
- `packages/opencode/src/tool/write.ts`：为 `write` 工具输出 `metadata.filediff`，供 `v1` 在 snapshot diff 缺失时兜底统计文件状态与行数。
- `packages/opencode/src/server/tempo-metric.ts`：发送生成记录和采纳量请求，并保持失败/失效静默，不影响对话主链路。
- `packages/opencode/test/session/metric.test.ts`：回归验证生成记录请求体、生成行数、语言、请求/响应内容、采纳量空内容与 provider 过滤。
- `packages/desktop/src/main/metric-env.test.ts`：回归验证普通 Desktop sidecar 与 WSL sidecar 都显式注入 `OPENCODE_TOOL_NAME=opencode-desktop`。
- `packages/opencode/test/snapshot/snapshot.test.ts`：回归验证非 git 目录也能生成 snapshot diff。
- `packages/opencode/test/tool/write.test.ts`：回归验证 `write` 工具输出 `metadata.filediff`。
- `packages/opencode/test/server/tempo-metric.test.ts`：回归验证生成记录和采纳量请求发送、无登录态跳过、token 失效静默失败。
- `travelsky/metric-design.md`、`travelsky/metric-CONTEXT.md`：记录统计矩阵设计与决策背景。

## 不变量

- metric 仍只对 `providerID` 大小写不敏感匹配 `travelsky` 时构建上报体。
- 生成记录接口必须是 `POST /ai/data/api/record/saveGeneration`，Header 必须携带 `Cookie: crowd.token_key=<token>`。
- 生成记录 body 必须包含：`moduleName`、`promptName`、`generatedLines`、`sessionId`、`codeLanguage`、`toolName`、`toolVersion`、`ideName`、`ideVersion`、`projectName`、`requestContent`、`responseContent`。
- `moduleName` 必须使用最终 assistant 的 `modelID`；`promptName` 必须使用 assistant 所属 agent。
- `toolName` 必须优先使用显式 `OPENCODE_TOOL_NAME`；仅接受 `opencode-desktop` 或 `opencode-cli`；无显式变量时才回退到 `OPENCODE_CLIENT` 推断。
- CLI 二进制 build 必须显式注入 `OPENCODE_TOOL_NAME=opencode-cli`，不能只依赖默认 fallback。
- Desktop 普通 sidecar 与 WSL sidecar 必须显式注入 `OPENCODE_TOOL_NAME=opencode-desktop`，不能依赖本地 server 启动方式或打包 artifact 名称推断。
- `toolVersion` 与 `ideVersion` 必须使用 `InstallationVersion`；发布版本源固定为 `packages/opencode/package.json` 经 GitHub Actions 传入的 `OPENCODE_VERSION`。
- CLI binary build 与 Desktop node server build 都必须 define `OPENCODE_VERSION` 为 `Script.version`，避免生产 Desktop 上报 `local`。
- `requestContent` 必须来自本轮父 user message 文本；`responseContent` 必须来自同一 `parentID` 下非 summary assistant 文本。
- `generatedLines` 必须使用第一版文件变更聚合的新增行数；`codeLanguage` 必须使用该聚合中的主语言。
- 生成记录响应的 `data` 必须作为采纳量接口的 `qaid` 来源。
- 采纳量接口必须是 `POST /record/addAdoption`，body 必须包含 `qaid`、`adoptedLines`、`adoptedContent`、`deletedLines`。
- agent 时代必须以本轮最终文件 diff 作为采纳口径：有新增或删除行即发送采纳量；没有最终文件变更则不发送采纳量。
- `adoptedLines` 必须等于最终 diff 新增行数；`deletedLines` 必须等于最终 diff 删除行数。
- `adoptedContent` 必须固定为空字符串，不能上传完整代码内容。
- 非 git 目录不能导致 `Snapshot.track()` 禁用；内部 snapshot 必须限定在当前打开目录，不能使用 `/` 作为非 git 项目的对比根。
- 文件改动聚合必须优先来自本轮完成态 `Snapshot.FileDiff`；同时必须合并当前回答已完成 `edit/write/apply_patch` 工具 metadata 中 snapshot 未覆盖的 `filediff/files`，尤其是会话目录外的文件。
- 当 diff 数组为空时，必须能从工具 metadata 中的 `filediff/files` 兜底聚合，不能让有编辑事件的会话全部归零。
- 当前生成记录接口不能继续发送第一版 `text/modelName/other` body；第一版 `other.v1/v2` 只保留在设计文档中作为历史口径和后续扩展参考。

## 冲突处理规则

- 上游如果也改了 metric 聚合，必须语义合并，不能回退到第一版 `/ai/data/api/open/code/metric/add` 和 `text/modelName/other` 请求体。
- 上游如果调整消息 part 或 tool state 结构，优先保留生成记录字段名和含义，再适配新的事件来源。
- 上游如果调整 project/vcs/snapshot 关系，必须保留非 git 目录的内部 snapshot 能力，但不能把非 git 目录伪装成用户项目 git 仓库。
- 上游如果调整 snapshot diff 结构，必须保持生成行数和语言优先使用完成态最终 diff 聚合，并保留工具 metadata 兜底，不能改成上传 patch 内容。
- 上游如果调整 `edit/write/apply_patch` 工具 metadata，必须保留项目外文件能通过 `filediff/files` 进入生成行数/语言统计的能力，避免 `/projecta/b` 会话修改 `~/xxxx/filec` 被丢失。
- 上游如果调整 `write` 工具 metadata，必须保留 `filediff.file/status/additions/deletions` 或提供等价字段，避免 `write` 创建/覆盖文件时生成行数无法统计。
- 上游如果调整上报时机，必须保留每轮回答完成后单次生成记录上报；采纳量只能在生成记录返回 qaid 后基于同一轮最终 diff 上报，避免中间 step 重复上报。
- 上游如果调整 Tempo metric 发送层，仍必须保持生成记录和采纳量请求失败、超时、token 失效不打扰用户对话。
- 上游如果调整 Desktop sidecar、WSL sidecar 或 build-node 构建流程，必须重新确认 `OPENCODE_TOOL_NAME` 和 `OPENCODE_VERSION` 仍在生产包链路中可用。

## 验证方式

- 在 `packages/opencode` 目录运行：`bun test test/snapshot/snapshot.test.ts test/session/metric.test.ts test/tool/write.test.ts test/server/tempo-metric.test.ts`。
- 在 `packages/opencode` 目录运行：`bun test test/script/build-node.test.ts test/session/metric.test.ts`，验证 Desktop node server build 注入版本、CLI build 注入工具名、metric 优先使用显式工具名。
- 在 `packages/desktop` 目录运行：`bun test src/main/metric-env.test.ts`，验证 Desktop sidecar 工具名注入。
- 在 `packages/opencode` 目录运行：`bun typecheck`。
- 如果本机 `bun typecheck` 因 `@typescript/native-preview-darwin-arm64` wrapper 解析失败，可使用仓库已安装的 native `tsgo --noEmit` 二进制进行同等类型检查，并在结果中注明 wrapper 问题。
- 人工检查生成记录请求体，确认 URL 为 `/ai/data/api/record/saveGeneration`，字段为当前平铺 body，且不再发送第一版 `other.v1/v2`。
- 人工检查 GitHub Actions 发布链路，确认 fork workflow 仍从 `packages/opencode/package.json` 读取版本并传入 `OPENCODE_VERSION`。
- 人工检查采纳量发送层，确认 `/record/addAdoption` 的 `qaid` 来自生成记录响应 `data`，且 `adoptedContent` 为空字符串。

## 停止条件

- 上游删除或重构 `MessageV2`、`tool` part、`step-finish` part、`Snapshot.FileDiff` 或 `SessionPrompt.runLoop` 完成态上报点时，不能机械解冲突，必须重新核对统计来源。
- 公司后端要求新的生成记录或采纳量字段命名、统计范围时，必须同步更新实现、测试、设计文档和本清单。
- 如果未来要恢复矩阵统计，必须走新接口版本或独立字段，不能把第一版 `other.v1/v2` 重新混入当前生成记录 body。
- 如果后续产品提供显式采纳/撤销事件，必须重新评估是否从“最终文件 diff 即采纳”切换为显式事件口径。
