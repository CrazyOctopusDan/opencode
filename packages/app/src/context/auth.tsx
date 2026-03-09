import { createSimpleContext } from "@opencode-ai/ui/context"
import { createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { Persist, persisted, removePersisted } from "@/utils/persist"
import { usePlatform } from "./platform"
import { useServer } from "./server"

const target = Persist.global("auth", ["auth.v1"])

type LoginResult = {
  access_token: string
  token_type: "Bearer"
  expires_in: number
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

    const valid = createMemo(() => {
      if (!store.accessToken) return false
      if (!store.expiresAt) return false
      return store.expiresAt > Date.now()
    })

    const token = createMemo(() => {
      if (!valid()) return undefined
      return store.accessToken
    })

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

    return {
      ready,
      token,
      username: () => store.username,
      loggedIn: valid,
      async login(username: string, password: string) {
        const conn = server.current
        if (!conn) throw new Error("Server not available")
        const fetcher = platform.fetch ?? globalThis.fetch
        const res = await fetcher(`${conn.http.url}/global/login`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ username, password }),
        })
        if (!res.ok) throw new Error("Invalid username or password")
        const data = (await res.json()) as LoginResult
        const expiresAt = Date.now() + Math.max(1, data.expires_in) * 1000
        setStore({
          accessToken: data.access_token,
          username,
          expiresAt,
        })
      },
      logout: clear,
    }
  },
})
