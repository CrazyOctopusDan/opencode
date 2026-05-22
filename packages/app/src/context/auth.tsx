import { createSimpleContext } from "@opencode-ai/ui/context"
import type { Accessor } from "solid-js"
import { createStore, type SetStoreFunction, type Store } from "solid-js/store"
import { TravelSkyAuth } from "@/travelsky/auth"
import { Persist, persisted, removePersisted } from "@/utils/persist"
import { type Platform, usePlatform } from "./platform"
import { useServer } from "./server"

const target = Persist.global("auth", ["auth.v1"])

type LoginResult = {
  access_token: string
  token_type: "Bearer"
  expires_in: number
}

type LoginError = {
  message?: string
  error?: string
}

type AuthState = {
  accessToken: string
  username: string
  expiresAt: number
}

type AuthServer = {
  current:
    | {
        http: {
          url: string
        }
      }
    | undefined
}

type AuthReady = Accessor<boolean> & { promise: undefined | Promise<unknown> }

function env(url: string) {
  if (!URL.canParse(url)) return "unknown_server"
  const host = new URL(url).hostname.toLowerCase()
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") return "local_sidecar"
  if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".corp")) return "intranet_remote"
  return "remote_server"
}

function hint(url: string, path: string) {
  const stage = env(url)
  return `环境=${stage} 地址=${url} 接口=${path}`
}

export function createAuthContext(input: {
  platform: Platform
  server: AuthServer
  store: Store<AuthState>
  setStore: SetStoreFunction<AuthState>
  ready: AuthReady
  removePersisted: () => Promise<void> | void
}) {
  let authOperation = 0
  let recovery: Promise<boolean> | undefined

  const valid = () => {
    if (!input.store.accessToken) return false
    if (!input.store.expiresAt) return false
    return input.store.expiresAt > Date.now()
  }

  const token = () => {
    if (!valid()) return undefined
    return input.store.accessToken
  }

  const clearFor = async (operation: number) => {
    const auth = token()
    const conn = input.server.current
    if (operation !== authOperation) return false
    input.setStore({
      accessToken: "",
      username: "",
      expiresAt: 0,
    })
    await input.removePersisted()
    if (!auth || !conn) return true
    const fetcher = input.platform.fetch ?? globalThis.fetch
    await fetcher(`${conn.http.url}/global/logout`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth}`,
      },
    }).catch(() => undefined)
    return true
  }

  const clear = async () => {
    authOperation++
    await clearFor(authOperation)
  }

  const loginFor = async (operation: number, username: string, password: string, remember = false) => {
    const conn = input.server.current
    if (!conn) throw new Error("Server not available")
    const fetcher = input.platform.fetch ?? globalThis.fetch
    const url = conn.http.url
    const path = "/global/login"
    const res = await fetcher(`${url}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username, password }),
    }).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`登录请求未送达。${hint(url, path)}。请检查内网连通性、代理/VPN、或服务进程是否存活。原始错误: ${msg}`)
    })
    if (!res.ok) {
      const data = (await res.json().catch(() => undefined)) as LoginError | undefined
      const msg = data?.message || data?.error || "Invalid username or password"
      throw new Error(`${msg}。${hint(url, path)} HTTP=${res.status}`)
    }
    const data = (await res.json()) as LoginResult
    const expiresAt = Date.now() + Math.max(1, data.expires_in) * 1000
    if (operation !== authOperation) return false
    input.setStore({
      accessToken: data.access_token,
      username,
      expiresAt,
    })
    if (operation !== authOperation) return false
    if (remember) {
      await TravelSkyAuth.save(input.platform, { username, password })
      return operation === authOperation
    }
    await TravelSkyAuth.clear(input.platform)
    return operation === authOperation
  }

  const login = async (username: string, password: string, remember = false) => {
    authOperation++
    await loginFor(authOperation, username, password, remember)
  }

  return {
    ready: input.ready,
    token,
    username: () => input.store.username,
    loggedIn: valid,
    login,
    async recover() {
      if (recovery) return recovery
      const run = (async () => {
        authOperation++
        const operation = authOperation
        const saved = await TravelSkyAuth.remembered(input.platform)
        if (operation !== authOperation) return false
        if (!saved.username || !saved.passwordAvailable || !saved.password) {
          await clearFor(operation)
          return false
        }
        const recovered = await loginFor(operation, saved.username, saved.password, true).catch(async () => {
          await clearFor(operation)
          return false
        })
        if (!recovered) return false
        if (valid()) return true
        await clearFor(operation)
        return false
      })()
      recovery = run
      return run.finally(() => {
        if (recovery === run) recovery = undefined
      })
    },
    logout: clear,
  }
}

export const { use: useAuth, provider: AuthProvider } = createSimpleContext({
  name: "Auth",
  init: () => {
    const platform = usePlatform()
    const server = useServer()
    const [store, setStore, _, ready] = persisted(
      target,
      createStore({
        accessToken: "",
        username: "",
        expiresAt: 0,
      }),
    )

    return createAuthContext({
      platform,
      server,
      store,
      setStore,
      ready,
      removePersisted: () => {
        removePersisted(target, platform)
      },
    })
  },
})
