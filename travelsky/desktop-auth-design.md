# Desktop 登录态恢复与记住我设计

## 背景

当前 Desktop 首次打开 opencode 时可以进入登录页，登录成功后可以进入操作页。关闭并重新打开后，前端仍可能停留在操作页，但公司 Tempo 接口会因为服务端内存登录态丢失而触发大量错误弹窗。用户只能通过“切换模型”弹窗中的“退出登录”手动回到登录页。

根因判断：

- Desktop 前端 `packages/app/src/context/auth.tsx` 已经把 `accessToken`、`username`、`expiresAt` 持久化到 `opencode.global.dat`。
- 服务端 `packages/opencode/src/server/auth-token.ts` 的 local token session 使用内存 `Map`。
- 服务端 `packages/opencode/src/server/tempo-session.ts` 的 Tempo token session 也使用内存 `Map`。
- Desktop 重启后，前端保存的 local token 还未过期，但新服务端进程不再认识该 token，也没有对应 Tempo session，于是二开 Tempo 接口失效。

## 目标

- 勾选“记住我”后，Desktop 可以安全保存用户名和密码，并在重启后自动填入。
- 勾选“记住我”后，如果旧 local token 在新服务端进程中失效，Desktop 可以静默重新登录并换取新 token。
- Tempo 明确返回 token 失效时，模型列表链路应自动恢复或回到登录页，不继续弹大量错误。
- 数据上报链路遇到 Tempo token 失效时不打扰用户，允许静默跳过本次上报并记录调试信息。
- 实现尽量集中在 TravelSky/Tempo 二开文件或二开适配层中，避免把公司 token 语义扩散到源仓库通用接口。

## 非目标

- 不持久化 `AuthToken` 的服务端内存 `Map`。
- 不持久化 `TempoSession` 的服务端内存 `Map`。
- 不改源仓库通用 session、event、file、workspace 等接口的认证错误处理。
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
- token 失效恢复只覆盖公司二开接口链路：模型列表和数据上报。

## 文件落点

### Desktop 前端

- `packages/app/src/context/auth.tsx`
  - 扩展登录入口支持 `remember` 参数。
  - 保留现有 `accessToken`、`username`、`expiresAt` 持久化。
  - 增加恢复能力：当前 token 被公司接口判定失效时，读取记住我凭据并静默重新登录；没有可用凭据时清理登录态。

- `packages/app/src/travelsky/auth.ts`
  - 新增 TravelSky Desktop 登录辅助模块。
  - 管理 remembered credentials 的读取、写入、清理。
  - 封装 Tempo token 失效识别和静默恢复入口。
  - 避免把公司接口细节散落到通用 auth context 和组件中。

- `packages/app/src/pages/login.tsx`
  - 增加“记住我”勾选框。
  - 页面加载时读取 remembered credentials。
  - 有用户名则自动填入用户名。
  - 有可解密密码则自动填入密码并勾选“记住我”。
  - 只有用户名但没有可用密码时，只填用户名，不默认勾选。
  - 登录成功且勾选时保存凭据；未勾选时清理已保存凭据。

### Desktop 原生层

- `packages/desktop/src/preload/index.ts`
  - 暴露安全凭据 IPC，例如 `secureStoreGet`、`secureStoreSet`、`secureStoreDelete`。

- `packages/desktop/src/main/ipc.ts`
  - 接收安全凭据 IPC。
  - 使用 Electron `safeStorage` 加密、解密密码。
  - 加密不可用时返回“密码不可保存/不可恢复”的明确状态。

- `packages/desktop/src/main/store.ts`
  - 复用现有 `electron-store` 存储能力。
  - 保存加密后的 remembered credentials，不保存明文密码。

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
3. `/login` 页面读取 TravelSky remembered credentials。
4. 用户输入账号密码并选择是否勾选“记住我”。
5. 提交登录后调用现有 `POST /global/login`。
6. 登录成功后写入现有 auth store。
7. 勾选“记住我”时，通过 Desktop 安全 IPC 保存用户名和加密密码。
8. 未勾选“记住我”时，清理 remembered credentials。

## 重启恢复数据流

1. Desktop 重启后，前端可能从 auth store 读到未过期的旧 local token。
2. 用户进入操作页后触发公司模型列表链路。
3. Tempo API 如果返回已锁定的 token 失效格式，前端触发 `auth.recover()`。
4. `auth.recover()` 读取 remembered credentials。
5. 有可解密密码时，静默调用 `/global/login` 换取新 local token，并让服务端重新建立 Tempo session。
6. 恢复成功后刷新模型列表一次。
7. 没有可用密码或恢复失败时，清理 auth store 并跳转 `/login`。
8. 同一轮失效只触发一次恢复，避免多个并发请求重复登录、重复弹错或重复跳转。

## 数据上报处理

- 数据上报属于后台二开能力，不应打断用户操作。
- `TempoMetric.send()` 遇到 Tempo token 失效时，记录 trace 并跳过本次上报。
- 第一阶段不为了数据上报把用户密码发送给 server 常驻保存。
- 用户下次打开模型列表或显式触发二开模型链路时，再由前端完成静默恢复或跳登录。

## 错误处理规则

- 只有公司 Tempo token 失效格式触发登录恢复。
- 普通网络失败继续按现有容错处理，不强制跳登录。
- 非失效的 `success=false` 按普通业务失败处理。
- 模型列表恢复期间不显示多次错误弹窗。
- 恢复失败只执行一次 `logout + navigate("/login")`。
- 源仓库通用 SDK 请求不接入公司 token 失效逻辑。

## 验证计划

在 `packages/opencode` 目录运行相关测试：

- `tempo-api`：覆盖 `success=false`、`code=401`、`message` 前缀匹配的 expired 识别。
- `model-policy` 或 provider 路由：确认 expired 不会被吞成普通空模型。
- `tempo-metric`：确认 expired 时跳过上报且不向用户链路抛错。

在 `packages/app` 目录运行相关测试：

- TravelSky auth helper：remembered credentials 可读时允许 recover。
- TravelSky auth helper：无密码、解密不可用或登录失败时 recover 失败并清理登录态。
- Login 页面或 auth context：勾选“记住我”保存凭据，未勾选清理凭据。

人工验证：

- 勾选“记住我”登录后关闭并重开 Desktop，用户名和密码自动填入。
- 勾选“记住我”登录后关闭并重开 Desktop，旧 token 失效时模型列表可静默恢复。
- 未勾选“记住我”登录后关闭并重开 Desktop，旧 token 失效时回到登录页。
- `safeStorage` 不可用时只保存用户名，不保存密码。
- Tempo 数据上报 token 失效时不弹窗、不影响对话。

## 基线更新计划

实现完成并验证后，使用 `update-sapphire-baseline` 更新：

- `travelsky/changes-baseline.md`
- `travelsky/baseline-checklists/desktop-auth.md`

未来合并时必须保护的行为：

- Desktop 记住我只在安全加密可用时保存密码。
- 旧 local token 失效后优先使用 remembered credentials 静默重登。
- Tempo 模型列表 token 失效会触发恢复或回登录页。
- Tempo 数据上报 token 失效不打扰用户。
- 公司 token 失效逻辑不扩散到源仓库通用接口。
