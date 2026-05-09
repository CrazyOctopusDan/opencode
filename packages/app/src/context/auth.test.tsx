import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test"
import { createRoot } from "solid-js"
import type { SetStoreFunction, Store } from "solid-js/store"
import type { Platform } from "./platform"

type AuthState = {
  accessToken: string
  username: string
  expiresAt: number
}

type AuthContext = {
  token: () => string | undefined
  username: () => string
  loggedIn: () => boolean
  login: (username: string, password: string, remember?: boolean) => Promise<void>
  recover: () => Promise<boolean>
  logout: () => Promise<void>
}

type Remembered = {
  username: string
  password: string
  remembered: boolean
  passwordAvailable: boolean
}

let initAuth: (() => AuthContext) | undefined
let platform: Platform
let remembered: Remembered
let loginOk: boolean
let saved: Array<{ username: string; password: string }>
let credentialClears: number
let authClears: number

async function withAuth(fn: (auth: AuthContext) => Promise<void>) {
  await createRoot((dispose) =>
    Promise.resolve(fn(initAuth!())).finally(() => {
      dispose()
    }),
  )
}

beforeAll(async () => {
  mock.module("@opencode-ai/ui/context", () => ({
    createSimpleContext: (input: { init: () => AuthContext }) => {
      initAuth = input.init
      return {
        use: () => initAuth!(),
        provider: () => undefined,
      }
    },
  }))

  mock.module("@/utils/persist", () => ({
    Persist: {
      global: (key: string, legacy?: string[]) => ({ key, legacy }),
    },
    persisted: (_target: unknown, store: [Store<AuthState>, SetStoreFunction<AuthState>]) => [
      store[0],
      store[1],
      null,
      Object.assign(() => true, { promise: undefined }),
    ],
    removePersisted: async () => {
      authClears++
    },
  }))

  mock.module("./platform", () => ({
    usePlatform: () => platform,
  }))

  mock.module("./server", () => ({
    useServer: () => ({
      current: {
        http: {
          url: "https://tempo.example.test",
        },
      },
    }),
  }))

  mock.module("@/travelsky/auth", () => ({
    TravelSkyAuth: {
      remembered: async () => remembered,
      save: async (_platform: Platform, input: { username: string; password: string }) => {
        saved.push(input)
        return true
      },
      clear: async () => {
        credentialClears++
      },
    },
  }))

  await import("./auth")
})

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
  platform = {
    platform: "desktop",
    openLink() {},
    async restart() {},
    back() {},
    forward() {},
    async notify() {},
    fetch: async () =>
      loginOk
        ? new Response(JSON.stringify({ access_token: "token-1", token_type: "Bearer", expires_in: 60 }))
        : new Response(JSON.stringify({ message: "Invalid username or password" }), { status: 401 }),
  }
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

  test("recover clears auth state when remembered credentials are unavailable", async () => {
    await withAuth(async (auth) => {
      await auth.login("dummy-user", "dummy-password", true)

      expect(await auth.recover()).toBeFalse()
      expect(auth.loggedIn()).toBeFalse()
      expect(authClears).toBe(1)
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
})
