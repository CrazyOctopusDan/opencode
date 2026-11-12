# Sapphire / TravelSky 企业功能基线

本文件是后续上游同步的当前行为基线，替代 v1 的逐文件保护清单。采用最新 OpenCode 架构，在原生扩展点移植企业功能；允许重构或替换实现，不要求旧目录、Provider 层级或 runner 保持不变。新增产品行为仍以用户需求为准。

本次核对：2026-11-12；合入本地 `dev` 基点 `101776024c`（2.2.7）。这些是历史定位，不是下次合并的固定版本。迁移过程及当时验证结果见 [migration-v2.md](migration-v2.md)，合并流程见 [merge-sapphire](../.agents/skills/merge-sapphire/SKILL.md)。

## 架构与认证边界

- 企业协议/状态接入当前 Schema → Core / Protocol → Server → Client / App / CLI 分层，依赖方向遵循根 `AGENTS.md`。Core 不直接读取进程环境；CLI 宿主解析配置，经 Server options 注入。独立嵌入 Core 时未配置的企业模式保持关闭。
- OpenCode 本地服务认证与 Tempo 公司认证相互独立。保留上游本地服务认证、Desktop 自动连接与恢复，不把公司 token 替换成本地服务密码。
- 企业凭据 integration ID 为 `travelsky-login`，模型 provider ID 为 `travelSky`。模型执行使用模型自己的 API key，不使用公司登录 token。
- 对外企业 API 位于 `/api/experimental/travelsky/status|login|logout`，客户端为 `client.experimental.travelsky.*`。公共 API 变更后从 `packages/client` 执行 `bun run generate`，不手改生成文件。

## 行为与当前代码入口

| 范围 | 行为要求 | 当前入口 |
| --- | --- | --- |
| Tempo 协议 | 登录使用 SM2，`auth/login` 请求保留 `username/enPasswd/plugin: OpenCode`；`llm/list` 保留 `plugin: open-code`。模型/上报使用同一配置主机和 `crowd.token_key` Cookie。支持 prod/dev/custom 主机及末尾 `/ai/data/api` 归一化。 | `packages/core/src/travelsky/api.ts`、`packages/cli/src/server-process.ts`、`packages/server/src/options.ts` |
| 登录状态 | 使用原生 Credential 持久化公司 token、用户名、主机与有效期。到期或明确的 Tempo 失效响应返回未登录；短暂网络失败不误判为凭据失效，不放开普通 provider。明确失效合同为 `success=false`、`code=401`（数字或字符串）及 `message` 以 `token校验失败，失败原因` 开头。 | `packages/core/src/travelsky/auth.ts`、`packages/core/src/travelsky/api.ts` |
| 模型授权 | 企业模式只暴露授权的 TravelSky provider/models。使用公司 `model` 字段作为真实模型标识，不能误用数据库 `id`；保留每个模型的 URL/key/context/output 限制。重新登录或刷新后，列表和实际执行都使用新配置，包括已经解析的模型路由。 | `packages/core/src/travelsky/models.ts`、`packages/core/src/plugin/provider/travelsky.ts` |
| 模型提示词 | DeepSeek/dsv4、Qwen/QwQ/Tongyi、GLM、MiniMax 的补充行为接入原生提示词，保留当前平台的 system/tool 合同。 | `packages/core/src/travelsky/prompt.ts`、`packages/core/src/travelsky/prompts/` |
| CLI | default/run/mini 执行前检查企业登录；复用有效凭据，交互登录支持重试/退出，非交互缺凭据给出可执行的提示。`auth login/logout` 使用企业 API；保留原生服务连接凭据。 | `packages/cli/src/travelsky.ts`、`packages/cli/src/commands/handlers/` |
| App 登录门禁 | 在当前服务的整个 Shell 外控制企业登录；未登录仅显示登录表单，不显示顶部搜索、会话标签、新建会话等操作。登录后恢复，退出/失效后隐藏；嵌套路由复用同一门禁。状态检查时保留已有会话，连接恢复后重查，密码拒绝后由用户主动重试。 | `packages/app/src/runtime/travelsky/gate.tsx`、`packages/app/src/runtime/travelsky/machine.ts`、`packages/app/src/runtime/server/current.tsx`、`packages/app/src/shell/routes/routes.tsx` |
| 登录界面范围 | 用户名、密码输入框与提交按钮等宽。不在公司登录流程加入扫码、二维码配对、配对链接或摄像头步骤。启动连接页仅保留浏览器需要的地址/服务密码回退；Desktop 自动连接内置服务。上游显式添加/编辑服务器对话框的配对能力不在本次移除范围内。 | `packages/app/src/runtime/travelsky/gate.tsx`、`packages/app/src/servers/connect/screen.tsx`、`packages/app/src/servers/connect/controller.ts` |
| Desktop 记住登录 | 密码仅通过原生 RPC 交给主进程，使用 safeStorage 加密后写 SQLite，按服务区分。加密不可用、Linux `basic_text` 或损坏密文时返回登录，不降级明文；网页端不提供密码持久化。恢复请求共享，恢复失败可重新手动登录。 | `packages/desktop/src/main/ipc-handlers/travelsky.ts`、`packages/desktop/src/shared/ipc-rpc/travelsky.ts`、`packages/desktop/src/renderer/platform/index.ts` |
| 企业 API | Schema 定义登录/状态数据，Protocol 定义实验端点，Server 调用 Core 并保留本地认证。 | `packages/schema/src/travelsky.ts`、`packages/protocol/src/groups/travelsky.ts`、`packages/server/src/handlers/persistent-pty.ts`、`packages/server/src/routes.ts` |

## 完成上报

- 入口：`packages/core/src/travelsky/reporting.ts`、`metric.ts`、`auth.ts`，接入 `packages/core/src/session/runner/llm.ts`。遵循当前 Session 生命周期，不恢复旧内存循环。
- 完整助手回答完成后聚合回答文本，以最后助手消息 ID 去重；不在每个 LLM step、工具调用或中间文本分别上报生成结果。错误或未完成回答不作为正常完成结果。
- 文件统计采用最终差异，撤销的改动不重复累计。覆盖 Git 与非 Git 目录，工具元数据作为适用回退；临时快照不在用户目录创建 `.git` 或改写用户索引。行数为非负整数。
- `record/saveGeneration` 返回 qaid 且存在文件变化时，再调用 `record/addAdoption`。同主机、同 Cookie；网络超时或上报失败不阻塞正常会话完成。不把客户端去重描述为后端恰好一次交付保证。
- CLI/Desktop 分别使用 `opencode-cli` / `opencode-desktop`；共享服务时保留 prompt 的 Desktop 来源。`ideVersion`、`adoptedContent` 保持空字符串。
- 实际 payload 的 `toolVersion` 必须等于合入上游的发布短版本，与合并后根/Core/CLI 版本一致，最多 15 字符、不带开发后缀。当前为 2.2.7；以后随上游更新，不能固化。对应回归在 `packages/core/test/travelsky/metric.test.ts`。

## Windows / Linux 交付

以本次源提交的 `.github/workflows/release.yml`、`.github/actions/setup-bun/action.yml`、`packages/cli/script/build.ts`、`packages/desktop/script/build.ts` / `pack.ts` 为参照，同步以下两条 fork workflow：

| Workflow | 独立可下载的交付物 |
| --- | --- |
| `.github/workflows/build-desktop-windows.yml` | Desktop x64/arm64 NSIS 安装程序及含 `win-unpacked/` 的解压版 ZIP；CLI arm64/x64/x64-baseline ZIP |
| `.github/workflows/build-desktop-linux.yml` | Desktop x64/arm64 AppImage、deb、rpm；CLI arm64/x64/x64-baseline 及对应 musl tar.gz |

- CLI/Desktop 使用同一发布版本，Desktop 构建依赖匹配的 CLI 产物。复用上游 builder，CLI 归档包含完整 `bin` 内容，Linux 保留可执行权限；缺失任一要求产物必须失败。
- 保留 `dev-sapphire` push / 手动触发、不签名、不发布 release。Windows 当前先生成 app，再包装 NSIS；解压版与 NSIS 使用同一 app，不另行编译。上游改变后需语义适配。
- Windows 使用可选择目录的安装向导，默认按 app ID 隔离渠道，保留旧 `@opencodedesktop` 共享目录迁移。目录向导重入时保留迁移状态；进程检测排除同一路径的安装器实例和当前渠道卸载程序，仍关闭安装目录中的应用进程。
- 选择 D 盘只改变程序位置。Desktop 的用户数据、复制的 CLI、更新器缓存和 Windows 临时文件仍遵循现有用户目录/系统配置；解压版不承诺便携数据目录或零 C 盘占用。
- Bun/Node 要求从源提交和构建配置读取，不在 skill 内永久固定版本。`bun.lock` 以上游图为起点，保留企业 manifest 需要的依赖，目前是 Core 的 `sm-crypto` 及其传递依赖。

## 验证入口与完成标准

根目录执行 `bun run check`；包内迭代使用 `bun typecheck`。以下命令分别在指定包目录执行，不能从仓库根目录运行测试。改测试前读取对应 `.opencode/skills` 指引。

| 工作目录 | 聚焦命令 |
| --- | --- |
| `packages/core` | `bun run script/test.ts test/travelsky test/session-runner.test.ts test/session-model-request-hooks.test.ts test/session-runner-message.test.ts` |
| `packages/cli` | `bun test test/travelsky.test.ts` |
| `packages/server` | `bun test test/travelsky.test.ts` |
| `packages/app` | `bun test --conditions=solid --preload ../ui/test/solid-jsx.ts --preload ./happydom.ts src/runtime/travelsky/machine.test.ts src/servers/connect/machine.test.ts` |
| `packages/desktop` | `bun test src/main/ipc-handlers/travelsky.test.ts`，并对变更涉及的原生连接、构建或安装路径运行对应测试 |

合并仍需验证关联的上游路径；上述入口不是所有变更通用的测试全集。UI 验收覆盖首次未登录、登录成功、退出/过期、连接恢复、输入与按钮宽度以及顶部栏显隐。涉及登录页面时不能仅凭状态机测试宣称界面通过。

本地检查、模拟 Tempo 的浏览器测试、原生系统密钥环、真实公司接口、Windows/Linux CI 及下载产物启动验收分别记录。历史通过数量不作为后续通过证明；当前尚未完成的真实环境验收见迁移记录。仅改文档时检查路径、命令和链接，不必重跑整套产品测试。

## 2026-11-12 合并验证

- 合并保留 `runStep` 新增的 `interruption` 参数及企业统计调用；企业统计从上游已移除的 `App.Metadata` 迁移到 `App.Service`。实际统计版本及测试对齐 2.2.7，`ideVersion` 仍为空。
- 以 dev 锁文件为起点，用 Bun 1.4.4 重算，仅增加企业需要的 `sm-crypto` / `jsbn`；`bun install --frozen-lockfile` 完整安装及 postinstall 通过；上游遗留的未应用 patch 警告仍存在。
- 相对 `dev` 的本次增量 `git diff --check dev` 通过；整个合并相对旧 Sapphire 的检查仍报告 dev 自带测试空白及依赖 patch 上下文缩进，未重写上游内容。
- 从 `packages/client` 运行 `bun run generate` 重建合并后的客户端；根目录 `bun run check` 通过。Core 企业/会话 309 项、CLI 3 项、Server 1 项、App 状态机 39 项、Desktop 配置/凭据 12 项通过。
- 用安装的 app-builder-lib 模板和 NSIS 编译器，在 macOS 上编译 x64/arm64 的安装/卸载四种组合通过；载荷使用测试文件，仅证明脚本可编译。4 项 Windows 行为测试本机跳过，已加入 Windows 打包工作流；实际 Windows/Linux 产物、云桌面、原生密钥环、公司服务及 UI 未重新验收。
- 用户报告的首次安装“无法抽取 Uninstall OpenCode”尚无完整错误路径及现场复现，不能确认是文件占用、权限、临时盘空间或其他原因；此次没有绕过卸载文件写入失败。可先使用解压版部署，再在 Windows 收集完整报错定位。

## 已替换的旧约束

- 不再要求 `packages/opencode`、`packages/desktop-electron`、旧 SDK 生成脚本或 `publish.yml`；按当前包结构和原生构建入口处理。
- 不再固定 `ServerProvider > AuthProvider > GlobalProvider`；要求实际服务上下文有效、全 Shell 登录门禁正确，并跟随当前原生路由实现。
- 旧模型选择 `.find(...)` 修复和无生产调用者的 `ProtocolTraceStore` 不直接搬回；使用当前模型选择和原生诊断能力。
- 旧 `baseline-checklists` 及设计稿可从 Git 历史查阅，不恢复为强制保护规则。本文件集中维护现行要求，避免多份清单冲突。
