import { createSimpleContext } from "@opencode-ai/ui/context"
import { createStore } from "solid-js/store"
import { TravelSkyAuth } from "@/travelsky/auth"
import { Persist, persisted, removePersisted } from "@/utils/persist"
import { usePlatform } from "./platform"
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

    const valid = () => {
      if (!store.accessToken) return false
      if (!store.expiresAt) return false
      return store.expiresAt > Date.now()
    }

    const token = () => {
      if (!valid()) return undefined
      return store.accessToken
    }

    const clear = async () => {
      const auth = token()
      const conn = server.current
      setStore({
        accessToken: "",
        username: "",
        expiresAt: 0,
      })
      await removePersisted(target, platform)
      if (!auth || !conn) return
      const fetcher = platform.fetch ?? globalThis.fetch
      await fetcher(`${conn.http.url}/global/logout`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${auth}`,
        },
      }).catch(() => undefined)
    }

    const login = async (username: string, password: string, remember = false) => {
      const conn = server.current
      if (!conn) throw new Error("Server not available")
      const fetcher = platform.fetch ?? globalThis.fetch
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
      setStore({
        accessToken: data.access_token,
        username,
        expiresAt,
      })
      if (remember) {
        await TravelSkyAuth.save(platform, { username, password })
        return
      }
      await TravelSkyAuth.clear(platform)
    }

    return {
      ready,
      token,
      username: () => store.username,
      loggedIn: valid,
      login,
      async recover() {
        const saved = await TravelSkyAuth.remembered(platform)
        if (!saved.username || !saved.passwordAvailable || !saved.password) {
          await clear()
          return false
        }
        const recovered = await login(saved.username, saved.password, true)
          .then(() => true)
          .catch(async () => {
            await clear()
            return false
          })
        if (!recovered) return false
        if (valid()) return true
        await clear()
        return false
      },
      logout: clear,
    }
  },
})
