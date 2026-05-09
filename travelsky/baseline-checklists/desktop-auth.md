# Desktop 登录态恢复合并保护清单

## 保护目标

未来从 `dev` 合并到 `dev-sapphire` 时，必须保留 Desktop 记住我、安全凭据保存、Tempo token 失效恢复，以及数据上报失效静默跳过的二开行为。该功能只覆盖公司 Tempo/model/metric 链路，不把公司 token 语义扩散到源仓库通用接口。

## 输入范围

- 来源：`5a102b4a7^..4e8c0c77f`。
- 相关提交：
  - `5a102b4a7`：记录 Desktop 登录态恢复设计。
  - `b38ff64e3`：记录 Desktop 登录实施计划。
  - `63d8e6b33`：将 Desktop 登录计划移动到 `travelsky` 目录。
  - `07990912e`：识别 Tempo token 失效响应。
  - `235117896`：向 provider 列表暴露 Tempo 登录失效状态。
  - `778b493bb`：避免过期 Tempo policy 覆盖已有缓存。
  - `c2bd7f2b1`：Tempo metric 遇到 token 失效时静默跳过。
  - `37633cafb`：新增 Desktop 安全凭据 IPC。
  - `b39f28f11`：新增 TravelSky Desktop auth 辅助层。
  - `b27cc6dc0`：使用已记住凭据恢复 Desktop 登录态。
  - `cfb824442`：保护 Desktop 登录恢复竞态。
  - `100e51e25`：隔离 auth context 测试 mock。
  - `d911fd921`：恢复 auth context 测试中的 `window.api`。
  - `d6371dc42`：登录页增加 Desktop 记住我。
  - `adee3e77e`：避免异步回填覆盖已编辑登录表单。
  - `81e59bde0`：等待记住我登录测试 fixture。
  - `d1b654da8`：模型列表支持 Tempo auth 失效恢复。
  - `21f014e3f`：恢复登录后使用新 token 重试模型列表。
  - `36278ccff`：修复 fetch mock 类型以通过 typecheck。
  - `4e8c0c77f`：Tempo auth 失效后恢复 provider cache，并保持 expired 锁定。

## 保护文件

- `packages/opencode/src/server/tempo-api.ts`：识别公司 Tempo token 失效格式，并让模型列表返回 `expired` 状态。
- `packages/opencode/src/provider/model-policy.ts`：把 expired 作为瞬时锁定状态暴露给 provider list，不能用过期响应覆盖既有全局模型缓存。
- `packages/opencode/src/provider/provider.ts`、`packages/opencode/src/server/routes/instance/provider.ts`、`packages/opencode/src/server/routes/instance/httpapi/handlers/provider.ts`：在新旧 provider 路由和 schema 中透传 `debug_tempo.auth_expired/message`，并在 expired 时不放开普通 provider。
- `packages/opencode/src/server/tempo-metric.ts`：数据上报遇到 token 失效或失败响应时返回 `false`，不能影响用户对话。
- `packages/desktop/src/preload/types.ts`、`packages/desktop/src/preload/index.ts`、`packages/desktop/src/main/ipc.ts`：提供 Desktop 安全凭据 IPC，使用 `safeStorage` 密文保存密码。
- `packages/app/src/travelsky/auth.ts`：二开隔离层，封装已记住凭据与 Tempo expired 识别。
- `packages/app/src/context/auth.tsx`：登录支持 `remember`，并提供带竞态保护的 `recover()`。
- `packages/app/src/context/global-sync/bootstrap.ts`、`packages/app/src/context/global-sync.tsx`、`packages/app/src/context/global-sync/child-store.ts`：全局和目录 provider 查询接入恢复、重试和 query cache 更新。
- `packages/app/src/pages/login.tsx`：登录页“记住我”和已记住凭据回填。
- `packages/app/src/components/dialog-select-model.tsx`、`packages/app/src/components/dialog-select-model-unpaid.tsx`：模型列表遇到 expired 或未授权错误时走目录 provider query 恢复、重试、刷新 cache 或回登录页。
- `packages/sdk/openapi.json`、`packages/sdk/js/src/v2/gen/types.gen.ts`：provider schema/SDK 类型必须包含 `debug_tempo`。
- `packages/opencode/test/server/tempo-api.test.ts`、`packages/opencode/test/provider/model-policy.test.ts`、`packages/opencode/test/server/tempo-metric.test.ts`：服务端失效识别、缓存保护、expired 锁定和 metric 静默跳过回归。
- `packages/app/src/travelsky/auth.test.ts`、`packages/app/src/context/auth.test.tsx`、`packages/app/src/context/global-sync.test.ts`、`packages/app/src/pages/login.test.ts`：前端记住我、恢复、provider cache 重试、竞态和表单回填回归。
- `travelsky/desktop-auth-design.md`、`travelsky/desktop-auth-implementation-plan.md`：需求设计与执行上下文。

## 不变量

- Tempo token 失效只按公司明确格式判断：`success === false`、`code === 401` 或 `"401"`、`message` 以 `token校验失败，失败原因` 开头。
- `TempoApi.listModels()` 不能把 token 失效吞成普通空模型或网络不可用；必须返回可区分的 `expired` 状态。
- provider list 必须在 expired 时输出 `debug_tempo.auth_expired === true`，并保留可选 `message`。
- expired provider snapshot 是瞬时锁定状态，不能覆盖已有全局 `ModelPolicy` 缓存，也不能放开普通 provider。
- `TempoMetric.send()` 遇到 expired、非 2xx、`success=false` 或无登录态时返回 `false`，不能向 UI 抛出错误或触发弹窗。
- Desktop 记住我只在 `platform.platform === "desktop"` 且 preload IPC 可用时工作；Web 或缺 IPC 时必须表现为无已记住凭据。
- 密码只能用 Electron `safeStorage` 加密后保存为密文；`safeStorage` 不可用、加密失败或解密失败时，只能保存或返回用户名，`passwordAvailable` 必须为 `false`。
- 登录成功且勾选“记住我”时保存已记住凭据；未勾选时必须清理已保存凭据。
- `auth.recover()` 只有在已记住凭据同时包含用户名和可用密码时才静默调用 `/global/login`；否则必须清理当前登录态并返回失败。
- `authOperation` 竞态保护必须保留，旧 recovery 失败不能清空或覆盖更新的手动登录态。
- 登录页异步回填已记住凭据不能覆盖用户已经编辑过的表单。
- 全局、目录和模型弹窗的 provider 查询必须复用 `loadProvidersQuery()` 的恢复逻辑；恢复成功后必须使用新建 SDK client 重新读取新 token 并重试一次。
- 模型列表恢复成功后必须刷新目录级 provider query cache，保证 `useProviders()`、`useModels()` 和 prompt submit 使用同一份新模型数据；恢复失败必须 `logout` 并导航到 `/login`。
- 登录页自动填入密码意味着 Desktop renderer 会短暂持有明文密码；该行为是当前产品需求的一部分，但落盘必须只存 `safeStorage` 密文，且 server 不能常驻保存密码。
- 登录恢复逻辑只接入公司 Tempo 模型列表和 metric 链路，不接入通用 session、event、file、workspace 接口。

## 冲突处理规则

- 遇到 Tempo API 或 provider policy 冲突时，优先做语义合并：保留上游新字段和新 provider 能力，同时保留 `expired` 状态、`debug_tempo` 输出、“过期不污染缓存”和“过期不放开 provider”的规则。
- 遇到 provider 路由或 SDK schema 冲突时，以服务端 schema 为准重新生成 SDK，但最终类型必须仍包含 `debug_tempo.auth_expired/message`。
- 遇到 Desktop preload、IPC 或存储冲突时，禁止采用明文密码存储；若上游改了 store 抽象，仍需维持 `safeStorage` 密文和用户名-only 降级。
- 遇到 auth context 冲突时，保留源仓库通用 token 持久化逻辑，同时把 TravelSky 已记住凭据和 recover 行为限制在二开辅助层调用。
- 遇到登录页冲突时，保留现有 UI 风格，但必须保留“记住我”checkbox、可用密码才勾选、异步回填不覆盖用户输入。
- 遇到两个模型弹窗冲突时，主弹窗和未付费弹窗必须保持相同的 query cache/recover/retry/logout 语义，不能只修一处。
- 遇到 metric 冲突时，保留后台静默容错；metric 失败不能影响用户对话主链路。

## 验证方式

- 在 `packages/opencode` 目录运行：`bun test test/server/tempo-api.test.ts test/provider/model-policy.test.ts test/server/tempo-metric.test.ts`。
- 在 `packages/opencode` 目录运行：`export PATH="$HOME/.nvm/versions/node/v24.13.1/bin:$PATH"; bun typecheck`。
- 在 `packages/app` 目录运行：`bun test --preload ./happydom.ts ./src`。
- 在 `packages/app` 目录运行：`export PATH="$HOME/.nvm/versions/node/v24.13.1/bin:$PATH"; bun typecheck`。
- 在 `packages/desktop` 目录运行：`export PATH="$HOME/.nvm/versions/node/v24.13.1/bin:$PATH"; bun typecheck`。
- 在仓库根目录运行：`git diff --check`。
- 需要人工验证的 Desktop 场景：勾选“记住我”登录后关闭并重开，用户名和密码自动填入；旧 token 失效时模型列表静默恢复；未勾选时旧 token 失效回登录页；`safeStorage` 不可用时只填用户名；Tempo 数据上报 token 失效时不弹窗。

## 停止条件

- 上游删除或重构 `/global/login`、provider list、Tempo model list、Tempo metric API、Desktop preload IPC 或 `electron-store` 存储方式时，不能机械解冲突，必须重新走登录态恢复设计。
- 上游 provider list 不再通过当前 SDK/client 路径调用，或模型弹窗不再使用现有 `provider.list()` 数据结构时，必须重新确认 `debug_tempo` 的传递点。
- 上游引入自己的记住密码或 secure credential 功能时，必须先确认是否满足“无明文密码、不可用时用户名-only 降级、恢复失败回登录页”三条不变量。
- 公司 Tempo token 失效响应格式变化时，必须更新 `TempoApi.expired()`、测试和本文不变量。
