# TravelSky CLI 登录与模型同步设计

## 目标
- 保持后端接口不变：`/global/login`、`/provider`、`/config/providers`。
- 仅改 CLI：
  - `opencode` 启动时，无有效 token 才要求登录。
  - 登录成功后，CLI 请求使用 `Bearer` 访问现有接口。
  - `/connect` 直达 TravelSky。
  - `/models` 仅展示 TravelSky 模型（来源仍是后端返回）。

## Desktop 现状（对齐基线）
- Desktop 登录与 token 持久化：
  - `packages/app/src/context/auth.tsx`
  - `login(username,password)` 调用 `POST /global/login`
  - 将 `access_token + expires_in` 保存到本地持久层，过期前视为已登录
- Desktop SDK 注入鉴权头：
  - `packages/app/src/utils/server.ts`
  - `createSdkForServer(..., token)` 注入 `Authorization: Bearer <token>`
- Desktop 模型来源（后端 provider 接口）：
  - `packages/app/src/components/dialog-select-model.tsx`
  - 调用 `provider.list()`，按 provider 结果生成可选模型（不走本地静态模型源）
- 后端接口定义（不变）：
  - `packages/opencode/src/server/routes/global.ts`：`POST /global/login`
  - `packages/opencode/src/server/routes/provider.ts`：`GET /provider`
  - `packages/opencode/src/server/routes/config.ts`：`GET /config/providers`

CLI 改造完全复用上述协议，不新增后端字段，不改响应结构。

## CLI 新链路
1. `opencode` 进入 `TuiThreadCommand`。
2. 执行 `ensureLogin(base, fetch)`：
   - 读取本地 `travelsky-auth.json`。
   - token 未过期且 `/provider` 或 `/config/providers` 可用：直接复用。
   - 否则弹用户名/密码，调用 `/global/login`。
   - 登录失败：`Retry/Exit`。
3. 登录后将 `Authorization: Bearer ...` 传给 `tui({ headers })`。
4. 如果启动时带了 `--session`，必须在登录成功后用同一个 `Authorization` 执行 `validateSession()`。
5. TUI 内 `/models`、`/connect` 继续走现有 sync/provider 数据链路。

## CLI 实现落点（文件映射）
- `packages/opencode/src/cli/travelsky/auth-store.ts`
  - 本地 token 文件 `travelsky-auth.json`
  - 字段：`access_token` `expires_at` `username`
- `packages/opencode/src/cli/travelsky/login.ts`
  - `request()` 调用 `POST /global/login`
  - `prompt()` 处理账号/密码输入与 `Retry/Exit`
- `packages/opencode/src/cli/travelsky/header.ts`
  - `bearer()` 和 `headers()` 统一生成 Authorization header
- `packages/opencode/src/cli/travelsky/bootstrap.ts`
  - `ensureLogin()`：复用 token -> 失效则登录 -> 预检 `/provider` 与 `/config/providers`
- `packages/opencode/src/cli/cmd/tui/thread.ts`
  - `tui(...)` 前执行 `ensureLogin()`
  - `validateSession()` 必须在 `ensureLogin()` 后执行，并携带同一个 Bearer，避免旧 token 或缺 header 导致 session 校验 401
  - 登录成功后通过 `tui({ headers })` 注入 Bearer
- `packages/opencode/src/cli/cmd/tui/app.tsx`
  - `/connect` 与 `/models` 直接进入 TravelSky provider 的模型选择
- `packages/opencode/src/cli/cmd/tui/component/dialog-provider.tsx`
  - provider 列表仅保留 TravelSky

## `/connect` 与 `/models` 规则
- `/connect`：不再先显示 provider 总列表，直接进入 TravelSky 的模型选择。
- `/models`：打开模型选择时固定 `providerID=travelSky/travelsky`，只看 TravelSky 模型。
- provider 识别统一按不区分大小写匹配 `travelsky`。

## 失败与边界
- 非 TTY 场景且需要登录：直接报错退出（避免不可交互卡死）。
- 本地 token 存在但服务端会话失效：预检失败后清理本地 token，并重新走登录流程。
- 带 `--session` 启动时，session 校验必须使用登录后的新 token，不能在登录门禁前访问受保护接口。
- 登录成功但 provider 列表中无 TravelSky：提示并 `Retry/Exit`。
