# Desktop Auth Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Desktop TravelSky login recovery so remembered users can survive app restarts without noisy Tempo token failure popups.

**Architecture:** Keep company-specific behavior inside TravelSky/Tempo adapters. Desktop stores remembered credentials through Electron `safeStorage`; the app uses those credentials only to recover when Tempo model listing proves the local token is stale. Server-side Tempo metric failures stay non-blocking.

**Tech Stack:** SolidJS, Electron preload/main IPC, Electron `safeStorage`, `electron-store`, Bun tests, existing Tempo API/model-policy code.

---

## File Structure

- Create: `packages/app/src/travelsky/auth.ts`
  - TravelSky remembered credential API, Tempo expired response detection, and recover coordination helpers.
- Create: `packages/app/src/travelsky/auth.test.ts`
  - Unit tests for remembered credential behavior and recover helper decisions.
- Modify: `packages/app/src/context/auth.tsx`
  - Add `login(username, password, remember)` and `recover()` while preserving existing auth persistence.
- Modify: `packages/app/src/pages/login.tsx`
  - Add the “记住我” checkbox and initial fill from remembered credentials.
- Modify: `packages/app/src/components/dialog-select-model.tsx`
  - Detect Tempo expired status, call `auth.recover()`, and refetch model list once.
- Modify: `packages/app/src/components/dialog-select-model-unpaid.tsx`
  - Apply the same recovery behavior if this alternate model dialog is still used by Desktop.
- Modify: `packages/desktop/src/preload/types.ts`
  - Add safe credential IPC types.
- Modify: `packages/desktop/src/preload/index.ts`
  - Expose safe credential IPC methods.
- Modify: `packages/desktop/src/main/ipc.ts`
  - Implement safe credential IPC with Electron `safeStorage`.
- Modify: `packages/opencode/src/server/tempo-api.ts`
  - Add expired response detection and return explicit model-list result status.
- Modify: `packages/opencode/src/provider/model-policy.ts`
  - Preserve expired status instead of converting it into an empty model policy.
- Modify: `packages/opencode/src/server/routes/instance/provider.ts`
  - Surface a lightweight `debug_tempo.auth_expired` status in provider list responses.
- Modify: `packages/opencode/src/server/tempo-metric.ts`
  - Parse metric response JSON and silently skip expired-token responses.
- Modify: `packages/opencode/test/server/tempo-api.test.ts`
  - Cover Tempo expired detection and list-model result status.
- Modify: `packages/opencode/test/server/tempo-metric.test.ts`
  - Cover metric expired response handling.
- Create or modify: `travelsky/baseline-checklists/desktop-auth.md`
  - Update after implementation using the `update-sapphire-baseline` skill.
- Modify: `travelsky/changes-baseline.md`
  - Update after implementation using the `update-sapphire-baseline` skill.

---

### Task 1: Tempo Expired Detection

**Files:**

- Modify: `packages/opencode/src/server/tempo-api.ts`
- Modify: `packages/opencode/test/server/tempo-api.test.ts`

- [ ] **Step 1: Add failing tests for Tempo expired payloads**

Append these tests to `packages/opencode/test/server/tempo-api.test.ts`:

```ts
test("detects company token expiration payload", () => {
  expect(
    TempoApi.expired({
      success: false,
      code: 401,
      message: "token校验失败，失败原因：登录已过期",
    }),
  ).toBeTrue()
  expect(
    TempoApi.expired({
      success: false,
      code: 401,
      message: "invalid token",
    }),
  ).toBeFalse()
  expect(
    TempoApi.expired({
      success: false,
      code: 500,
      message: "token校验失败，失败原因：服务异常",
    }),
  ).toBeFalse()
})

test("returns expired status when model list reports token expiration", async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        success: false,
        code: 401,
        message: "token校验失败，失败原因：登录已过期",
      }),
    )) as typeof fetch

  try {
    const result = await TempoApi.listModels({ token: "expired-token" })
    expect(result).toEqual({
      status: "expired",
      message: "token校验失败，失败原因：登录已过期",
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run from the package directory:

```bash
cd packages/opencode
bun test test/server/tempo-api.test.ts
```

Expected: FAIL because `TempoApi.expired` does not exist and `TempoApi.listModels()` still returns `undefined` for failed payloads.

- [ ] **Step 3: Add explicit result types and expired detection**

In `packages/opencode/src/server/tempo-api.ts`, add these types near the existing policy types:

```ts
export type TempoModelListResult =
  | { status: "ok"; providers: PolicyProvider[] }
  | { status: "expired"; message: string }
  | { status: "unavailable"; message?: string }
```

Inside `export namespace TempoApi`, add:

```ts
export function expired(payload: unknown) {
  if (!payload || typeof payload !== "object") return false
  const item = payload as Record<string, unknown>
  return (
    item.success === false &&
    item.code === 401 &&
    typeof item.message === "string" &&
    item.message.startsWith("token校验失败，失败原因")
  )
}
```

Change `listModels()` return behavior:

```ts
if (expired(payload)) {
  return {
    status: "expired" as const,
    message: extractMessage(payload) ?? "token校验失败，失败原因未知",
  }
}
if (!res.ok || success === false) {
  return {
    status: "unavailable" as const,
    message: extractMessage(payload),
  }
}
return {
  status: "ok" as const,
  providers: normalized,
}
```

Change the `catch` block return to:

```ts
return {
  status: "unavailable" as const,
  message: error instanceof Error ? error.message : String(error),
}
```

- [ ] **Step 4: Update existing tempo-api test expectations**

In the existing model normalization test, replace:

```ts
expect(result).toBeDefined()
expect(result?.length).toBe(1)
expect(result?.[0]?.id).toBe("travelSky")
expect(result?.[0]?.name).toBe("travelSky")
expect(result?.[0]?.models.length).toBe(2)

const ids = new Set(result?.[0]?.models.map((item) => item.id))
```

with:

```ts
expect(result.status).toBe("ok")
if (result.status !== "ok") throw new Error("expected ok model list")
expect(result.providers.length).toBe(1)
expect(result.providers[0]?.id).toBe("travelSky")
expect(result.providers[0]?.name).toBe("travelSky")
expect(result.providers[0]?.models.length).toBe(2)

const ids = new Set(result.providers[0]?.models.map((item) => item.id))
```

Replace:

```ts
const byId = Object.fromEntries(result?.[0]?.models.map((item) => [item.id, item]) ?? [])
```

with:

```ts
const byId = Object.fromEntries(result.providers[0]?.models.map((item) => [item.id, item]) ?? [])
```

- [ ] **Step 5: Run the focused test and verify it passes**

```bash
cd packages/opencode
bun test test/server/tempo-api.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add packages/opencode/src/server/tempo-api.ts packages/opencode/test/server/tempo-api.test.ts
git commit -m "feat: detect Tempo token expiration"
```

---

### Task 2: Preserve Expired Status Through Model Policy

**Files:**

- Modify: `packages/opencode/src/provider/model-policy.ts`
- Modify: `packages/opencode/src/server/routes/instance/provider.ts`
- Modify: `packages/opencode/test/server/tempo-api.test.ts`

- [ ] **Step 1: Extend model policy snapshot shape**

In `packages/opencode/src/provider/model-policy.ts`, change `Snapshot` to include expired status:

```ts
type Snapshot = {
  enabled: boolean
  locked: boolean
  expired: boolean
  expiredMessage?: string
  list: Policy[]
  provider: (id: string) => Policy | undefined
  allowedProvider: (id: string) => boolean
  allowedModel: (providerID: string, modelID: string) => boolean
}
```

Update the initial `cache`:

```ts
let cache: Snapshot = {
  enabled: false,
  locked: false,
  expired: false,
  list: [],
  provider: () => undefined,
  allowedProvider: () => false,
  allowedModel: () => false,
}
```

- [ ] **Step 2: Add helper for expired snapshots**

Add this helper below `makeSnapshot`:

```ts
function makeExpiredSnapshot(message: string): Snapshot {
  return {
    enabled: false,
    locked: false,
    expired: true,
    expiredMessage: message,
    list: [],
    provider: () => undefined,
    allowedProvider: () => false,
    allowedModel: () => false,
  }
}
```

- [ ] **Step 3: Update `fromTempo()` to return status**

Replace `fromTempo()` with:

```ts
async function fromTempo(localToken?: string) {
  if (!TempoApi.enabled()) return
  const auth = TempoSession.get(localToken)
  if (!auth?.token && !auth?.cookie) return
  return TempoApi.listModels(auth)
}
```

Then update `ModelPolicy.snapshot()`:

```ts
export async function snapshot(force = false, localToken?: string) {
  if (!force && Date.now() < expiresAt) return cache
  const auth = TempoSession.get(localToken)
  const locked = TempoApi.enabled() && !!auth?.token
  const tempo = await fromTempo(localToken)
  if (tempo?.status === "expired") {
    cache = makeExpiredSnapshot(tempo.message)
    expiresAt = Date.now() + refreshMs()
    return cache
  }
  const list = (tempo?.status === "ok" ? tempo.providers : undefined) ?? (await fromRemote()) ?? fromEnv() ?? []
  cache = makeSnapshot(list, locked)
  expiresAt = Date.now() + refreshMs()
  return cache
}
```

- [ ] **Step 4: Surface debug status in provider route**

In `packages/opencode/src/server/routes/instance/provider.ts`, extend the returned object:

```ts
return {
  all: Object.values(providers),
  default: Provider.defaultModelIDs(providers),
  connected: Object.keys(connected),
  ...(policy.expired
    ? {
        debug_tempo: {
          auth_expired: true,
          message: policy.expiredMessage,
        },
      }
    : {}),
}
```

- [ ] **Step 5: Run typecheck for opencode**

```bash
cd packages/opencode
bun typecheck
```

Expected: PASS. If SDK generated types reject `debug_tempo`, update only the local route result typing needed to allow the existing Desktop cast already used in `dialog-select-model.tsx`.

- [ ] **Step 6: Run focused Tempo tests**

```bash
cd packages/opencode
bun test test/server/tempo-api.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

```bash
git add packages/opencode/src/provider/model-policy.ts packages/opencode/src/server/routes/instance/provider.ts packages/opencode/test/server/tempo-api.test.ts
git commit -m "feat: surface Tempo auth expiration"
```

---

### Task 3: Metric Expired Handling

**Files:**

- Modify: `packages/opencode/src/server/tempo-metric.ts`
- Modify: `packages/opencode/test/server/tempo-metric.test.ts`

- [ ] **Step 1: Add failing metric expired test**

Append to `packages/opencode/test/server/tempo-metric.test.ts`:

```ts
test("skips generation metric send when Tempo reports token expiration", async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        success: false,
        code: 401,
        message: "token校验失败，失败原因：登录已过期",
      }),
      { status: 200 },
    )) as typeof fetch

  try {
    const qaid = await TempoMetric.sendGeneration({
      modelName: "qwen",
      promptName: "build",
      generatedLines: 0,
      adoptedLines: 0,
      sessionId: "ses_1",
      codeLanguage: "Other",
      toolName: "opencode-cli",
      toolVersion: "local",
      ideName: "OpenCode",
      ideVersion: "local",
      projectName: "demo",
      requestContent: "hello",
      responseContent: "hello",
    })
    expect(qaid).toBeUndefined()
  } finally {
    globalThis.fetch = originalFetch
  }
})
```

- [ ] **Step 2: Run the focused metric test and verify it fails if behavior is not explicit**

```bash
cd packages/opencode
bun test test/server/tempo-metric.test.ts
```

Expected before implementation: the new test may fail because metric send treats any `res.ok` response as success.

- [ ] **Step 3: Parse metric response payload**

In `packages/opencode/src/server/tempo-metric.ts`, replace:

```ts
return fetch(url(), {
  method: "POST",
  headers: head,
  body: JSON.stringify(input),
  signal: AbortSignal.timeout(1_500),
})
  .then((res) => res.ok)
  .catch((err) => {
    log.warn("metric send failed", {
      error: error(err),
    })
    return false
  })
```

with:

```ts
return fetch(url(), {
  method: "POST",
  headers: head,
  body: JSON.stringify(input),
  signal: AbortSignal.timeout(1_500),
})
  .then(async (res) => {
    const payload = await res.json().catch(() => undefined)
    if (TempoApi.expired(payload)) {
      log.warn("metric send skipped because Tempo token expired", {
        status: res.status,
      })
      return false
    }
    if (!res.ok) return false
    if (payload && typeof payload === "object" && (payload as Record<string, unknown>).success === false) return false
    return true
  })
  .catch((err) => {
    log.warn("metric send failed", {
      error: error(err),
    })
    return false
  })
```

- [ ] **Step 4: Run metric test**

```bash
cd packages/opencode
bun test test/server/tempo-metric.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add packages/opencode/src/server/tempo-metric.ts packages/opencode/test/server/tempo-metric.test.ts
git commit -m "fix: skip expired Tempo metrics"
```

---

### Task 4: Desktop Secure Credential IPC

**Files:**

- Modify: `packages/desktop/src/preload/types.ts`
- Modify: `packages/desktop/src/preload/index.ts`
- Modify: `packages/desktop/src/main/ipc.ts`

- [ ] **Step 1: Add preload types**

In `packages/desktop/src/preload/types.ts`, add:

```ts
export type SecureCredential = {
  username: string
  password: string | null
  passwordAvailable: boolean
}
```

Add these methods to `ElectronAPI`:

```ts
secureCredentialGet: (key: string) => Promise<SecureCredential | null>
secureCredentialSet: (key: string, value: { username: string; password: string }) => Promise<{ passwordSaved: boolean }>
secureCredentialDelete: (key: string) => Promise<void>
```

- [ ] **Step 2: Expose preload methods**

In `packages/desktop/src/preload/index.ts`, add to `api` near the store methods:

```ts
  secureCredentialGet: (key) => ipcRenderer.invoke("secure-credential-get", key),
  secureCredentialSet: (key, value) => ipcRenderer.invoke("secure-credential-set", key, value),
  secureCredentialDelete: (key) => ipcRenderer.invoke("secure-credential-delete", key),
```

- [ ] **Step 3: Implement main IPC**

In `packages/desktop/src/main/ipc.ts`, import `safeStorage`:

```ts
import { BrowserWindow, Notification, app, clipboard, dialog, ipcMain, safeStorage, shell } from "electron"
```

Add handlers after existing store handlers:

```ts
ipcMain.handle("secure-credential-get", (_event: IpcMainInvokeEvent, key: string) => {
  const stored = getStore("travelsky.secure-credentials").get(key)
  if (!stored || typeof stored !== "object") return null
  const item = stored as { username?: unknown; password?: unknown }
  if (typeof item.username !== "string") return null
  if (typeof item.password !== "string") {
    return { username: item.username, password: null, passwordAvailable: false }
  }
  if (!safeStorage.isEncryptionAvailable()) {
    return { username: item.username, password: null, passwordAvailable: false }
  }
  return {
    username: item.username,
    password: safeStorage.decryptString(Buffer.from(item.password, "base64")),
    passwordAvailable: true,
  }
})
ipcMain.handle(
  "secure-credential-set",
  (_event: IpcMainInvokeEvent, key: string, value: { username: string; password: string }) => {
    if (!safeStorage.isEncryptionAvailable()) {
      getStore("travelsky.secure-credentials").set(key, {
        username: value.username,
      })
      return { passwordSaved: false }
    }
    getStore("travelsky.secure-credentials").set(key, {
      username: value.username,
      password: safeStorage.encryptString(value.password).toString("base64"),
    })
    return { passwordSaved: true }
  },
)
ipcMain.handle("secure-credential-delete", (_event: IpcMainInvokeEvent, key: string) => {
  getStore("travelsky.secure-credentials").delete(key)
})
```

- [ ] **Step 4: Typecheck Desktop**

```bash
cd packages/desktop
bun typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

```bash
git add packages/desktop/src/preload/types.ts packages/desktop/src/preload/index.ts packages/desktop/src/main/ipc.ts
git commit -m "feat: add Desktop secure credential IPC"
```

---

### Task 5: TravelSky App Auth Helper

**Files:**

- Create: `packages/app/src/travelsky/auth.ts`
- Create: `packages/app/src/travelsky/auth.test.ts`

- [ ] **Step 1: Write failing helper tests**

Create `packages/app/src/travelsky/auth.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { TravelSkyAuth } from "./auth"

describe("TravelSkyAuth", () => {
  test("detects Tempo auth expiration debug payload", () => {
    expect(
      TravelSkyAuth.expired({
        debug_tempo: {
          auth_expired: true,
          message: "token校验失败，失败原因：登录已过期",
        },
      }),
    ).toBeTrue()
    expect(TravelSkyAuth.expired({ debug_tempo: { auth_expired: false } })).toBeFalse()
  })

  test("returns no remembered credentials on web platform", async () => {
    const credentials = await TravelSkyAuth.remembered({
      platform: "web",
      openLink() {},
      async restart() {},
      back() {},
      forward() {},
      async notify() {},
    })
    expect(credentials).toEqual({ username: "", password: "", remembered: false, passwordAvailable: false })
  })
})
```

- [ ] **Step 2: Run helper test and verify it fails**

```bash
cd packages/app
bun test --preload ./happydom.ts ./src/travelsky/auth.test.ts
```

Expected: FAIL because `packages/app/src/travelsky/auth.ts` does not exist.

- [ ] **Step 3: Implement helper**

Create `packages/app/src/travelsky/auth.ts`:

```ts
import type { Platform } from "@/context/platform"

const key = "desktop-login"

type Remembered = {
  username: string
  password: string
  remembered: boolean
  passwordAvailable: boolean
}

function api(platform: Platform) {
  if (platform.platform !== "desktop") return
  return globalThis.window?.api
}

export namespace TravelSkyAuth {
  export function expired(value: unknown) {
    if (!value || typeof value !== "object") return false
    const debug = (value as Record<string, unknown>).debug_tempo
    if (!debug || typeof debug !== "object") return false
    return (debug as Record<string, unknown>).auth_expired === true
  }

  export async function remembered(platform: Platform): Promise<Remembered> {
    const item = await api(platform)
      ?.secureCredentialGet(key)
      .catch(() => null)
    if (!item) return { username: "", password: "", remembered: false, passwordAvailable: false }
    return {
      username: item.username,
      password: item.password ?? "",
      remembered: item.passwordAvailable,
      passwordAvailable: item.passwordAvailable,
    }
  }

  export async function save(platform: Platform, input: { username: string; password: string }) {
    const result = await api(platform)
      ?.secureCredentialSet(key, input)
      .catch(() => undefined)
    return result?.passwordSaved === true
  }

  export async function clear(platform: Platform) {
    await api(platform)
      ?.secureCredentialDelete(key)
      .catch(() => undefined)
  }
}
```

- [ ] **Step 4: Run helper test**

```bash
cd packages/app
bun test --preload ./happydom.ts ./src/travelsky/auth.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 5**

```bash
git add packages/app/src/travelsky/auth.ts packages/app/src/travelsky/auth.test.ts
git commit -m "feat: add TravelSky Desktop auth helper"
```

---

### Task 6: Auth Context Remember and Recover

**Files:**

- Modify: `packages/app/src/context/auth.tsx`

- [ ] **Step 1: Extend auth context public API**

In `packages/app/src/context/auth.tsx`, import helper:

```ts
import { TravelSkyAuth } from "@/travelsky/auth"
```

Change login signature:

```ts
      async login(username: string, password: string, remember = false) {
```

After successful `setStore(...)`, add:

```ts
if (remember) {
  await TravelSkyAuth.save(platform, { username, password })
  return
}
await TravelSkyAuth.clear(platform)
```

- [ ] **Step 2: Add recover method**

Inside the returned object, add:

```ts
      async recover() {
        const saved = await TravelSkyAuth.remembered(platform)
        if (!saved.username || !saved.passwordAvailable || !saved.password) {
          await clear()
          return false
        }
        await this.login(saved.username, saved.password, true).catch(async () => {
          await clear()
          return undefined
        })
        return valid()
      },
```

If TypeScript rejects `this.login`, refactor the returned object by defining `const login = async (...) => { ... }` before `return`, then return `{ ..., login, async recover() { await login(...) } }`.

- [ ] **Step 3: Typecheck app**

```bash
cd packages/app
bun typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit Task 6**

```bash
git add packages/app/src/context/auth.tsx
git commit -m "feat: recover Desktop auth from remembered credentials"
```

---

### Task 7: Login UI Remember Me

**Files:**

- Modify: `packages/app/src/pages/login.tsx`

- [ ] **Step 1: Add imports**

Update imports:

```ts
import { createEffect, onMount, Show } from "solid-js"
import { usePlatform } from "@/context/platform"
import { TravelSkyAuth } from "@/travelsky/auth"
```

- [ ] **Step 2: Extend form state**

Add `remember`:

```ts
const platform = usePlatform()
const [form, setForm] = createStore({
  username: "",
  password: "",
  remember: false,
  loading: false,
  error: "",
})
```

- [ ] **Step 3: Load remembered credentials**

Add before `submit`:

```ts
onMount(() => {
  void TravelSkyAuth.remembered(platform).then((saved) => {
    setForm({
      username: saved.username,
      password: saved.password,
      remember: saved.remembered,
    })
  })
})
```

- [ ] **Step 4: Pass remember flag**

Change:

```ts
      .login(form.username.trim(), form.password)
```

to:

```ts
      .login(form.username.trim(), form.password, form.remember)
```

- [ ] **Step 5: Add checkbox markup**

Add between password field and error block:

```tsx
<label class="flex items-center gap-2 text-13-regular text-text-base">
  <input
    type="checkbox"
    checked={form.remember}
    onChange={(event) => setForm("remember", event.currentTarget.checked)}
  />
  <span>记住我</span>
</label>
```

- [ ] **Step 6: Run app typecheck**

```bash
cd packages/app
bun typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit Task 7**

```bash
git add packages/app/src/pages/login.tsx
git commit -m "feat: add Desktop remember me login"
```

---

### Task 8: Model List Recovery

**Files:**

- Modify: `packages/app/src/components/dialog-select-model.tsx`
- Modify: `packages/app/src/components/dialog-select-model-unpaid.tsx`

- [ ] **Step 1: Add helper import**

In both files, add:

```ts
import { TravelSkyAuth } from "@/travelsky/auth"
```

- [ ] **Step 2: Add recovery helper in model dialog resources**

Inside the `createResource` function after `const data = ...`, add:

```ts
if (TravelSkyAuth.expired(data)) {
  const recovered = await auth.recover()
  if (recovered) {
    const retry = await globalSDK.client.provider.list()
    return buildModelResult(retry.data ?? { all: [], connected: [], default: {} })
  }
  void auth.logout().then(() => navigate("/login"))
  return {
    ok: false as const,
    models: [],
  }
}
```

Implement `buildModelResult(data)` by extracting the existing `enterprise/allowed/connected/models` transformation into a local function in `dialog-select-model.tsx`. Use the same pattern in `dialog-select-model-unpaid.tsx` with that file's current model result shape.

- [ ] **Step 3: Keep unauthorized fallback**

Leave the existing `catch` branch that checks `message.toLowerCase().includes("unauthorized")`, but prefer `auth.recover()` before logout:

```ts
if (message.toLowerCase().includes("unauthorized")) {
  const recovered = await auth.recover()
  if (!recovered) void auth.logout().then(() => navigate("/login"))
}
```

- [ ] **Step 4: Run app typecheck**

```bash
cd packages/app
bun typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit Task 8**

```bash
git add packages/app/src/components/dialog-select-model.tsx packages/app/src/components/dialog-select-model-unpaid.tsx
git commit -m "feat: recover expired Tempo model auth"
```

---

### Task 9: Full Verification

**Files:**

- No source edits expected.

- [ ] **Step 1: Run opencode focused tests**

```bash
cd packages/opencode
bun test test/server/tempo-api.test.ts test/server/tempo-metric.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run opencode typecheck**

```bash
cd packages/opencode
bun typecheck
```

Expected: PASS.

- [ ] **Step 3: Run app helper tests**

```bash
cd packages/app
bun test --preload ./happydom.ts ./src/travelsky/auth.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run app typecheck**

```bash
cd packages/app
bun typecheck
```

Expected: PASS.

- [ ] **Step 5: Run desktop typecheck**

```bash
cd packages/desktop
bun typecheck
```

Expected: PASS.

- [ ] **Step 6: Manual Desktop checks**

Run Desktop from `packages/desktop`:

```bash
cd packages/desktop
bun dev
```

Check these behaviors:

- Login with “记住我” checked, close Desktop, reopen Desktop: username and password are filled.
- Login with “记住我” checked, close Desktop, reopen Desktop, open model selector: expired Tempo token triggers silent login and model list reload.
- Login with “记住我” unchecked, close Desktop, reopen Desktop, open model selector: expired Tempo token sends user to `/login`.
- Trigger metric send while Tempo token is expired: user sees no popup and conversation continues.

- [ ] **Step 7: Commit verification-only adjustments if any**

If verification required small fixes, commit exact touched files:

```bash
git status --short
git add <specific-files>
git commit -m "fix: complete Desktop auth recovery verification"
```

---

### Task 10: Sapphire Baseline Update

**Files:**

- Modify: `travelsky/changes-baseline.md`
- Create or modify: `travelsky/baseline-checklists/desktop-auth.md`

- [ ] **Step 1: Invoke update-sapphire-baseline**

Use the `update-sapphire-baseline` skill after implementation and verification are complete. Input range should be the commits created by Tasks 1-9.

- [ ] **Step 2: Update baseline documents**

Record these protected behaviors in Chinese:

- Desktop “记住我”只在 Electron `safeStorage` 可用时保存密码。
- `safeStorage` 不可用时只保存用户名。
- 旧 local token 失效后，模型列表链路优先使用 remembered credentials 静默重登。
- Tempo 模型列表失效格式为 `success=false/code=401/message` 前缀匹配。
- Tempo 数据上报失效不打扰用户。
- 公司 token 恢复逻辑不接入源仓库通用 SDK 请求。

- [ ] **Step 3: Commit baseline update**

```bash
git add travelsky/changes-baseline.md travelsky/baseline-checklists/desktop-auth.md
git commit -m "docs: 更新 Desktop 登录基线"
```

---

## Self-Review

- Spec coverage: Tasks 1-3 cover Tempo expired recognition, model-list propagation, and metric non-disruption. Tasks 4-7 cover Desktop secure remembered credentials and login UI. Task 8 covers silent recovery from model list. Task 9 covers tests and manual verification. Task 10 covers Sapphire baseline updates.
- Placeholder scan: This plan avoids unfinished-marker language and unspecified file targets. Each code-changing step names exact files and commands.
- Type consistency: `TravelSkyAuth.expired`, `TravelSkyAuth.remembered`, `TravelSkyAuth.save`, and `TravelSkyAuth.clear` are introduced before they are consumed. `TempoApi.expired` and `TempoApi.listModels()` result statuses are introduced before model-policy and metric use them.
