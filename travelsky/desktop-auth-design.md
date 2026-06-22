# Desktop 登录态恢复与记住我设计

## 背景

当前 Desktop 首次打开 opencode 时可以进入登录页，登录成功后可以进入操作页。关闭并重新打开后，前端仍可能停留在操作页，但本地 sidecar 和公司 Tempo 接口都可能因为服务端内存登录态丢失而触发 401 或大量错误弹窗。用户只能通过“切换模型”弹窗中的“退出登录”手动回到登录页。

根因判断：

- Desktop 前端 `packages/app/src/context/auth.tsx` 已经把 `accessToken`、`username`、`expiresAt` 持久化到 `opencode.global.dat`。
- 服务端 `packages/opencode/src/server/auth-token.ts` 的 local token session 使用内存 `Map`，sidecar 重启后不再认识 Desktop 前端落盘的旧 Bearer token。
- 服务端 `packages/opencode/src/server/tempo-session.ts` 的 Tempo token session 也使用内存 `Map`。
- Desktop 重启后，前端保存的 local token 还未过期，但新服务端进程不再认识该 token，也没有对应 Tempo session。此时用户可能直接进入操作页，但发送消息、事件流、模型列表或数据上报会在不同链路上失效。
- 启动后的全局同步会并行加载多个目录的 session 列表，例如 `GET /session?directory=...&roots=true`。这些请求如果同时遇到旧 local token 401，会同时触发恢复；恢复没有单飞保护时，多次 `auth.recover()` 会互相推进 `authOperation`，导致部分后台请求恢复失败并弹出“无法加载 xx 的会话”。

## 目标

- 勾选“记住我”后，Desktop 可以安全保存用户名和密码，并在重启后自动填入。
- 勾选“记住我”后，如果旧 local token 在新服务端进程中失效，Desktop 可以静默重新登录并换取新 token。
- 通用 SDK 请求遇到本地 sidecar 401 时，Desktop 可以用已记住凭据静默重新 `/global/login`，拿到新 local token 后自动重试当前请求一次。
- 启动期多个后台请求同时 401 时，只执行一次静默恢复，其余请求等待同一个恢复结果，避免满屏 session 加载失败 toast。
- Tempo 明确返回 token 失效时，模型列表链路应自动恢复或回到登录页，不继续弹大量错误。
- 数据上报链路遇到 Tempo token 失效时不打扰用户，允许静默跳过本次上报并记录调试信息。
- 实现尽量集中在 TravelSky/Tempo 二开文件或二开适配层中。公司 Tempo token 语义不扩散到源仓库通用接口；但本地 sidecar 401 属于 Desktop local token 失效，需要在全局 SDK fetch 适配层统一恢复。

## 非目标

- 不持久化 `AuthToken` 的服务端内存 `Map`。
- 不持久化 `TempoSession` 的服务端内存 `Map`。
- 不在各个 session、event、file、workspace 业务接口中分别改认证错误处理。
- 不在系统加密不可用时明文保存密码。

## 已锁定决策

- 记住密码只面向 Desktop。
- 密码优先使用 Electron `safeStorage` 加密后保存到 Desktop 原生存储。
- 如果 `safeStorage` 不可用，只保存用户名，不保存密码。
- 重启后不强求沿用旧 token；如果旧 token 在服务端失效，使用加密保存的凭据静默调用 `/global/login` 换取新 token。
- 未勾选“记住我”时不保存凭据，不静默重登；旧 token 能用就继续，用不了就回登录页。
- Tempo token 失效格式为：
  - `success === false`
  - `code === 401`
  - `message` 以 `token校验失败，失败原因` 开头
- 公司 Tempo token 失效恢复覆盖公司二开接口链路：模型列表和数据上报。
- 本地 sidecar 401 恢复覆盖 Desktop 全局 SDK 请求：先使用当前 `auth.token()` 注入 Bearer，遇到 401 后调用 `auth.recover()`，恢复成功后用新 token 重试原请求一次，恢复失败则保留原始 401。
- `auth.recover()` 必须是单飞的：恢复进行中再次调用时复用同一个 Promise，不能并发多次 `/global/login`，也不能让旧恢复操作互相清理或覆盖登录态。

## 文件落点

### Desktop 前端

- `packages/app/src/context/auth.tsx`
  - 扩展登录入口支持 `remember` 参数。
  - 保留现有 `accessToken`、`username`、`expiresAt` 持久化。
  - 增加恢复能力：当前 token 被公司接口判定失效时，读取记住我凭据并静默重新登录；没有可用凭据时清理登录态。
  - 并发恢复单飞：启动期多个目录 session 列表、event stream、provider 查询同时 401 时，只允许一个真实恢复请求。

- `packages/app/src/utils/server.ts`
  - 新增 `createAuthRecoveringFetch()`。
  - 每次 SDK 请求发送前读取当前 `auth.token()` 并覆盖旧 Authorization，避免 SDK 创建时捕获的旧 token 反复造成首包 401。
  - 遇到本地 sidecar 401 时触发一次 `auth.recover()`，成功后用新 Bearer token 自动重试原请求一次。

- `packages/app/src/travelsky/auth.ts`
  - 新增 TravelSky Desktop 登录辅助模块。
  - 管理已记住凭据的读取、写入、清理。
  - 封装 Tempo token 失效识别和静默恢复入口。
  - 避免把公司接口细节散落到通用 auth context 和组件中。

- `packages/app/src/pages/login.tsx`
  - 增加“记住我”勾选框。
  - 页面加载时读取已记住凭据。
  - 有用户名则自动填入用户名。
  - 有可解密密码则自动填入密码并勾选“记住我”。
  - 只有用户名但没有可用密码时，只填用户名，不默认勾选。
  - 登录成功且勾选时保存凭据；未勾选时清理已保存凭据。

- `packages/app/src/context/global-sdk.tsx`
  - 全局 SDK、目录 client 和事件流 SDK 统一使用 `createAuthRecoveringFetch()`。
  - 覆盖发送消息 `/session/.../prompt_async`、event stream、provider/file/workspace 等通过 SDK 发出的本地请求。

### Desktop 原生层

- `packages/desktop/src/preload/index.ts`
  - 暴露安全凭据 IPC：`secureCredentialGet`、`secureCredentialSet`、`secureCredentialDelete`。

- `packages/desktop/src/main/ipc.ts`
  - 接收安全凭据 IPC。
  - 使用 Electron `safeStorage` 加密、解密密码。
  - 加密不可用时返回“密码不可保存/不可恢复”的明确状态。

- `packages/desktop/src/main/store.ts`
  - 复用现有 `electron-store` 存储能力。
  - 保存加密后的已记住凭据，不保存明文密码。

### Tempo 服务端链路

- `packages/opencode/src/server/tempo-api.ts`
  - 增加 Tempo 失效响应识别函数。
  - `listModels()` 遇到失效响应时返回明确 expired 状态，不能继续吞成 `undefined` 或普通空列表。

- `packages/opencode/src/provider/model-policy.ts`
  - 接收 `TempoApi.listModels()` 的 expired 状态。
  - 向 provider list 路由暴露可被前端识别的登录态失效信号，或抛出可被转换的认证错误。

- `packages/opencode/src/server/tempo-metric.ts`
  - 发送数据上报时识别 Tempo 失效响应。
  - token 失效时不弹窗、不影响用户对话。
  - 无法恢复时静默跳过本次上报，并保留 debug trace。

## 登录数据流

1. 用户打开 Desktop。
2. `AuthProvider` 读取现有 auth store。
3. `/login` 页面读取 TravelSky 已记住凭据。
4. 用户输入账号密码并选择是否勾选“记住我”。
5. 提交登录后调用现有 `POST /global/login`。
6. 登录成功后写入现有 auth store。
7. 勾选“记住我”时，通过 Desktop 安全 IPC 保存用户名和加密密码。
8. 未勾选“记住我”时，清理已记住凭据。

## 重启恢复数据流

1. Desktop 重启后，前端可能从 auth store 读到未过期的旧 local token。
2. 用户进入操作页后发起 SDK 请求，例如发送消息 `/session/.../prompt_async` 或触发 event stream。
3. 本地 sidecar 如果因为内存 `AuthToken` 丢失返回 401，SDK fetch 适配层触发 `auth.recover()`。
4. `auth.recover()` 读取已记住凭据。
5. 有可解密密码时，静默调用 `/global/login` 换取新 local token，并让服务端重新建立 Tempo session。
6. 恢复成功后，SDK fetch 适配层用新 token 自动重试原请求一次。
7. 没有可用密码或恢复失败时，清理 auth store，当前请求保留原始 401，并由已有 UI 错误处理或登录恢复链路接管。
8. 同一请求只重试一次，避免无限登录和无限重发。
9. 多个请求同时触发恢复时，共享同一次 `auth.recover()` 结果，避免后台 session 列表每个目录各弹一个 401 toast。

## Tempo 模型列表恢复数据流

1. 用户进入操作页后触发公司模型列表链路。
2. Tempo API 如果返回已锁定的 token 失效格式，前端触发 `auth.recover()`。
3. `auth.recover()` 成功后使用新 token 重新创建 SDK client。
4. 恢复成功后刷新模型列表一次。
5. 没有可用密码或恢复失败时，清理 auth store 并跳转 `/login`。
6. 同一轮失效只触发一次恢复，避免多个并发请求重复登录、重复弹错或重复跳转。

## 数据上报处理

- 数据上报属于后台二开能力，不应打断用户操作。
- `TempoMetric.sendGeneration()`/`sendAdoption()` 遇到 Tempo token 失效时，记录 trace 并跳过本次上报。
- 第一阶段不为了数据上报把用户密码发送给 server 常驻保存。
- 用户下次打开模型列表或显式触发二开模型链路时，再由前端完成静默恢复或跳登录。

## 错误处理规则

- 只有公司 Tempo token 失效格式触发登录恢复。
- 本地 sidecar HTTP 401 也会触发 Desktop SDK 层登录恢复，但只代表 local token 无效，不套用公司 Tempo 响应格式。
- 普通网络失败继续按现有容错处理，不强制跳登录。
- 非失效的 `success=false` 按普通业务失败处理。
- 模型列表恢复期间不显示多次错误弹窗。
- 恢复失败只执行一次 `logout + navigate("/login")`。
- 源仓库通用 SDK 请求不接入公司 Tempo token 失效逻辑；Desktop 全局 SDK fetch 只处理标准 HTTP 401 的本地登录态恢复。

## 安全边界

- `safeStorage` 只保护已记住凭据的落盘形态，避免本地存储中出现明文密码。
- 因为需求要求登录页自动填入密码，并要求旧 token 失效时前端静默重登，Desktop renderer 在这些时刻会短暂持有解密后的明文密码。
- 当前实现不把密码发送给 server 常驻保存，也不在 `safeStorage` 不可用时保存密码。
- 如果后续要降低 renderer 明文暴露面，需要调整产品需求，例如取消自动填入密码，或改成主进程代发登录请求但登录页不展示密码。

## 验证计划

在 `packages/opencode` 目录运行相关测试：

- `tempo-api`：覆盖 `success=false`、`code=401`、`message` 前缀匹配的 expired 识别。
- `model-policy` 或 provider 路由：确认 expired 不会被吞成普通空模型。
- `tempo-metric`：确认 expired 时跳过上报且不向用户链路抛错。

在 `packages/app` 目录运行相关测试：

- TravelSky auth helper：已记住凭据可读时允许 recover。
- TravelSky auth helper：无密码、解密不可用或登录失败时 recover 失败并清理登录态。
- Login 页面或 auth context：勾选“记住我”保存凭据，未勾选清理凭据。
- SDK fetch：本地 sidecar 401 后 recover 并重试一次；recover 失败不重试；首包使用最新 token 覆盖旧 Authorization。
- Auth context：并发 `recover()` 调用只发起一次静默登录，全部调用共享结果。

人工验证：

- 勾选“记住我”登录后关闭并重开 Desktop，用户名和密码自动填入。
- 勾选“记住我”登录后关闭并重开 Desktop，旧 token 失效时模型列表可静默恢复。
- 勾选“记住我”登录后关闭并重开 Desktop，旧 token 失效时发送消息可静默重新登录并自动重试。
- 勾选“记住我”登录后关闭并重开 Desktop，启动期多个目录 session 列表旧 token 失效时不出现满屏 401 toast。
- 未勾选“记住我”登录后关闭并重开 Desktop，旧 token 失效时回到登录页。
- `safeStorage` 不可用时只保存用户名，不保存密码。
- Tempo 数据上报 token 失效时不弹窗、不影响对话。

## 基线更新计划

实现完成并验证后，使用 `update-sapphire-baseline` 更新：

- `travelsky/changes-baseline.md`
- `travelsky/baseline-checklists/desktop-auth.md`

未来合并时必须保护的行为：

- Desktop 记住我只在安全加密可用时保存密码。
- 旧 local token 失效后优先使用已记住凭据静默重登。
- 通用 SDK 请求遇到本地 sidecar 401 时必须静默重登并重试一次。
- 并发 local 401 恢复必须单飞，不能因为多个后台请求同时恢复而互相失败、重复弹错。
- Tempo 模型列表 token 失效会触发恢复或回登录页。
- Tempo 数据上报 token 失效不打扰用户。
- 公司 Tempo token 失效逻辑不扩散到源仓库通用接口。
