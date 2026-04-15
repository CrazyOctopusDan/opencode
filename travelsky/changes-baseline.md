# TravelSky 需求说明修改文件（冲突基线）

> 用途：后续与上游合并冲突时，以本文件记录的改动点为保留基线。

## 变更清单

| 文件 | 类型 | 改动目的 | 关键改动点 | 冲突保留策略 |
|---|---|---|---|---|
| `packages/opencode/src/cli/travelsky/auth-store.ts` | 新增 | 本地 token 持久化与有效期判断 | `read/current/write/clear`；文件 `travelsky-auth.json` | 保留全部；如上游有同类实现，优先保留 `expires_at` 语义与 0600 权限写入 |
| `packages/opencode/src/cli/travelsky/login.ts` | 新增 | CLI 登录交互与 `/global/login` 调用 | `request`（协议不变）、`prompt`（Retry/Exit） | 保留接口 URL 与请求体字段原样；冲突时不引入后端字段改动 |
| `packages/opencode/src/cli/travelsky/header.ts` | 新增 | Bearer 头构造 | `bearer/headers` | 保留全部 |
| `packages/opencode/src/cli/travelsky/provider.ts` | 新增 | TravelSky provider 识别统一 | `isTravelSky()` 大小写兼容 | 保留大小写不敏感判断 |
| `packages/opencode/src/cli/travelsky/bootstrap.ts` | 新增 | 启动登录门禁与 provider 可用性预检 | `ensureLogin`；预检 `/provider` + `/config/providers` | 保留“先复用 token，失败再登录”的顺序；保留接口不变 |
| `packages/opencode/src/cli/cmd/tui/thread.ts` | 修改 | `opencode` 启动前执行登录门禁并注入 Bearer | 调用 `ensureLogin`；`tui({ headers })` 注入 Authorization | 冲突时必须保留 `ensureLogin` 在 `tui(...)` 前执行 |
| `packages/opencode/src/cli/cmd/tui/app.tsx` | 修改 | `/connect` 与 `/models` 只走 TravelSky | `travel` memo；`DialogModel providerID={travel()}` | 冲突时保留 `/connect` 与 `/models` 的 provider 固定逻辑 |
| `packages/opencode/src/cli/cmd/tui/component/dialog-provider.tsx` | 修改 | provider 弹窗仅显示/处理 TravelSky | 过滤 `provider_next.all` 到 TravelSky | 冲突时保留过滤逻辑，不回退到全 provider 展示 |
| `packages/opencode/src/server/tempo-api.ts` | 修改 | 复用 Tempo 主机解析给 metric 上报 | 新增 `TempoApi.baseURL()` | 冲突时保留 `baseURL()` 导出，避免 metric 重复维护主机规则 |
| `packages/opencode/src/server/tempo-metric.ts` | 新增 | 发送回答统计到公司后端 | `POST /ai/data/api/open/code/metric/add`；复用 `TempoSession` cookie | 保留全部；若上游有同名能力，优先保留“同源主机+cookie+超时容错” |
| `packages/opencode/src/session/metric.ts` | 新增 | 聚合 token/字数/工具调用统计 | 同 `parentID` 多 step assistant 聚合；`other` 内 token+tool JSON | 保留全部；冲突时保留当前统计口径 |
| `packages/opencode/src/session/prompt.ts` | 修改 | 在完整回答后触发单次上报 | `runLoop` 结束点调用 `SessionMetric.build` + `TempoMetric.send` | 冲突时保留“完成态一次上报”时机，避免多次重复上报 |
| `packages/opencode/test/cli/tui/thread.test.ts` | 修改 | 适配登录门禁 | mock `ensureLogin` + 断言 `Authorization: Bearer ...` 已注入 `tui` | 保留 mock 与 header 注入断言，防止回归 |
| `packages/opencode/test/cli/travelsky-auth-store.test.ts` | 新增 | token 存储回归 | 读写与过期场景 | 保留全部 |
| `packages/opencode/test/cli/travelsky-login.test.ts` | 新增 | 登录接口调用回归 | 成功/失败消息 + `prompt` 的 retry/exit/非TTY 场景 | 保留全部 |
| `packages/opencode/test/cli/travelsky-bootstrap.test.ts` | 新增 | 登录门禁回归 | 复用 token 与缺 token 登录场景 | 保留全部 |
| `packages/opencode/test/server/tempo-metric.test.ts` | 新增 | metric 请求发送回归 | URL、Cookie、请求体、无登录态跳过 | 保留全部 |
| `packages/opencode/test/session/metric.test.ts` | 新增 | 统计聚合口径回归 | token/tool/text 聚合与 provider 过滤 | 保留全部 |
| `travelsky/design.md` | 新增 | 需求实现文档 | Desktop 对齐、CLI 流程、边界说明 | 持续更新 |
| `travelsky/metric-design.md` | 新增 | metric 需求实现文档 | 上报时机、统计口径、文件落点 | 持续更新 |
| `travelsky/metric-CONTEXT.md` | 新增 | 需求决策上下文 | phase 边界、决策、冲突参考 | 持续更新 |
| `travelsky/changes-baseline.md` | 新增 | 合并冲突基线 | 本清单 | 持续更新 |

## 合并冲突处理建议
- 先按上表定位文件，再按“关键改动点”逐项核对，不按整文件覆盖。
- 若上游也新增登录链路：保留“接口不变 + CLI 本地 token + TravelSky 单 provider”的约束。
- 若上游调整 TUI 命令注册：优先保留 `/connect` 与 `/models` 的 TravelSky 固定入口行为。
- 若上游新增 metric 统计：优先保留“runLoop 完成态单次上报 + `other` 包含 token/tool 聚合”的语义。

## Desktop 对齐来源（只读基线，非本次修改）
- `packages/app/src/context/auth.tsx`：Desktop 登录与 token 过期判断
- `packages/app/src/utils/server.ts`：Desktop Bearer 头注入
- `packages/app/src/components/dialog-select-model.tsx`：Desktop 从 `provider.list()` 构建模型列表
- `packages/opencode/src/server/routes/global.ts`、`provider.ts`、`config.ts`：后端接口定义（本次不改）
