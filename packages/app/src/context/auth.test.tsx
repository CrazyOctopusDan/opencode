import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import { createAuthContext } from "./auth"
import type { Platform } from "./platform"

type AuthContext = ReturnType<typeof createAuthContext>

type Remembered = {
  username: string
  password: string
  remembered: boolean
  passwordAvailable: boolean
}

type SecureCredentialApi = {
  secureCredentialGet: (
    key: string,
  ) => Promise<{ username: string; password: string | null; passwordAvailable: boolean } | null>
  secureCredentialSet: (
    key: string,
    value: { username: string; password: string },
  ) => Promise<{ passwordSaved: boolean }>
  secureCredentialDelete: (key: string) => Promise<void>
}

let platform: Platform
let remembered: Remembered
let loginOk: boolean
let saved: Array<{ username: string; password: string }>
let credentialClears: number
let authClears: number

function setApi(api: SecureCredentialApi | undefined) {
  ;(globalThis.window as typeof globalThis.window & { api?: SecureCredentialApi }).api = api
}

function clearApi() {
  delete (globalThis.window as typeof globalThis.window & { api?: SecureCredentialApi }).api
}

async function withAuth(fn: (auth: AuthContext) => Promise<void>) {
  await createRoot((dispose) => {
    const [store, setStore] = createStore({
      accessToken: "",
      username: "",
      expiresAt: 0,
    })
    return Promise.resolve(
      fn(
        createAuthContext({
          platform,
          server: {
            current: {
              http: {
                url: "https://tempo.example.test",
              },
            },
          },
          store,
          setStore,
          ready: Object.assign(() => true, { promise: undefined }),
          removePersisted: () => {
            authClears++
          },
        }),
      ),
    ).finally(() => {
      dispose()
    })
  })
}

beforeEach(() => {
  remembered = {
    username: "",
    password: "",
    remembered: false,
    passwordAvailable: false,
  }
  loginOk = true
  saved = []
  credentialClears = 0
  authClears = 0
  setApi({
    async secureCredentialGet() {
      if (!remembered.remembered) return null
      return {
        username: remembered.username,
        password: remembered.password,
        passwordAvailable: remembered.passwordAvailable,
      }
    },
    async secureCredentialSet(_key, value) {
      saved.push(value)
      return { passwordSaved: true }
    },
    async secureCredentialDelete() {
      credentialClears++
    },
  })
  platform = {
    platform: "desktop",
    openExternal() {},
    async restart() {},
    async notify() {},
    async openDirectoryPickerDialog() {
      return null
    },
    fetch: (async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST" && String(_input).endsWith("/global/logout")) {
        authClears++
        return new Response(null, { status: 204 })
      }
      return loginOk
        ? new Response(JSON.stringify({ access_token: "token-1", token_type: "Bearer", expires_in: 60 }))
        : new Response(JSON.stringify({ message: "Invalid username or password" }), { status: 401 })
    }) as unknown as typeof fetch,
  }
})

afterEach(() => {
  clearApi()
})

describe("Auth context TravelSky credential recovery", () => {
  test("login saves remembered credentials only when requested", async () => {
    await withAuth(async (auth) => {
      await auth.login("dummy-user", "dummy-password", true)

      expect(saved).toEqual([{ username: "dummy-user", password: "dummy-password" }])
      expect(credentialClears).toBe(0)

      await auth.login("dummy-user", "dummy-password")

      expect(saved).toEqual([{ username: "dummy-user", password: "dummy-password" }])
      expect(credentialClears).toBe(1)
    })
  })

  test("recover silently logs in with available remembered credentials", async () => {
    remembered = {
      username: "dummy-user",
      password: "dummy-password",
      remembered: true,
      passwordAvailable: true,
    }

    await withAuth(async (auth) => {
      expect(await auth.recover()).toBeTrue()
      expect(auth.loggedIn()).toBeTrue()
      expect(auth.username()).toBe("dummy-user")
      expect(saved).toEqual([{ username: "dummy-user", password: "dummy-password" }])
      expect(authClears).toBe(0)
    })
  })

  test("concurrent recover calls share one silent login", async () => {
    remembered = {
      username: "dummy-user",
      password: "dummy-password",
      remembered: true,
      passwordAvailable: true,
    }

    let loginRequests = 0
    platform.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST" && String(_input).endsWith("/global/logout")) {
        authClears++
        return new Response(null, { status: 204 })
      }
      loginRequests++
      await Promise.resolve()
      return new Response(JSON.stringify({ access_token: `token-${loginRequests}`, token_type: "Bearer", expires_in: 60 }))
    }) as unknown as typeof fetch

    await withAuth(async (auth) => {
      await expect(Promise.all([auth.recover(), auth.recover(), auth.recover()])).resolves.toEqual([true, true, true])

      expect(loginRequests).toBe(1)
      expect(auth.loggedIn()).toBeTrue()
      expect(auth.token()).toBe("token-1")
      expect(saved).toEqual([{ username: "dummy-user", password: "dummy-password" }])
    })
  })

  test("recover clears auth state when remembered credentials are unavailable", async () => {
    await withAuth(async (auth) => {
      await auth.login("dummy-user", "dummy-password", true)

      expect(await auth.recover()).toBeFalse()
      expect(auth.loggedIn()).toBeFalse()
      expect(authClears).toBe(2)
    })
  })

  test("recover clears auth state when silent login fails", async () => {
    remembered = {
      username: "dummy-user",
      password: "dummy-password",
      remembered: true,
      passwordAvailable: true,
    }
    loginOk = false

    await withAuth(async (auth) => {
      expect(await auth.recover()).toBeFalse()
      expect(auth.loggedIn()).toBeFalse()
      expect(authClears).toBe(1)
    })
  })

  test("stale recover failure does not clear newer manual login", async () => {
    remembered = {
      username: "saved-user",
      password: "saved-password",
      remembered: true,
      passwordAvailable: true,
    }

    let startSavedLogin: (() => void) | undefined
    let finishSavedLogin: (() => void) | undefined
    const savedLoginStarted = new Promise<void>((resolve) => {
      startSavedLogin = resolve
    })
    const savedLoginFinished = new Promise<void>((resolve) => {
      finishSavedLogin = resolve
    })

    platform.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST" && String(input).endsWith("/global/logout")) {
        authClears++
        return new Response(null, { status: 204 })
      }
      const body = JSON.parse(String(init?.body)) as { username: string }
      if (body.username === "saved-user") {
        startSavedLogin?.()
        await savedLoginFinished
        return new Response(JSON.stringify({ message: "Invalid username or password" }), { status: 401 })
      }
      return new Response(JSON.stringify({ access_token: "manual-token", token_type: "Bearer", expires_in: 60 }))
    }) as unknown as typeof fetch

    await withAuth(async (auth) => {
      const recovery = auth.recover()
      await savedLoginStarted

      await auth.login("manual-user", "manual-password", true)
      finishSavedLogin?.()

      expect(await recovery).toBeFalse()
      expect(auth.loggedIn()).toBeTrue()
      expect(auth.username()).toBe("manual-user")
      expect(auth.token()).toBe("manual-token")
      expect(authClears).toBe(0)
    })
  })
})
