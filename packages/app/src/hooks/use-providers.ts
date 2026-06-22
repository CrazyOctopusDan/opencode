import { useServerSync } from "@/context/server-sync"
import { decode64 } from "@/utils/base64"
import { useParams } from "@solidjs/router"
import { createMemo } from "solid-js"

export const popularProviders = [
  "opencode",
  "opencode-go",
  "anthropic",
  "github-copilot",
  "openai",
  "google",
  "openrouter",
  "vercel",
]
const popularProviderSet = new Set(popularProviders)

export function useProviders() {
  const serverSync = useServerSync()
  const params = useParams()
  const connectEnabled = import.meta.env.VITE_ALLOW_PROVIDER_CONNECT !== "false"
  const dir = createMemo(() => decode64(params.dir) ?? "")
  const providers = () => {
    if (dir()) {
      const [projectStore] = serverSync().child(dir())
      if (projectStore.provider_ready) return projectStore.provider
    }
    return serverSync().data.provider
  }
  const enterprise = createMemo(() => {
    const all = [...providers().all.values()]
    const picked = all.filter((item) => item.id === "travelSky" || item.name === "travelSky")
    if (picked.length > 0) return picked
    return []
  })
  const connectedIDs = createMemo(() => {
    const allowed = new Set(enterprise().map((item) => item.id))
    return new Set(providers().connected.filter((id) => allowed.has(id)))
  })
  const connected = createMemo(() => enterprise().filter((p) => connectedIDs().has(p.id)))
  const paid = createMemo(() =>
    connected().filter((p) => p.id !== "opencode" || Object.values(p.models).find((m) => m.cost?.input)),
  )
  const popular = createMemo(() => enterprise().filter((p) => popularProviderSet.has(p.id)))
  const canConnect = createMemo(() => {
    if (!connectEnabled) return false
    return enterprise().some((item) => !connectedIDs().has(item.id))
  })
  return {
    all: enterprise,
    default: createMemo(() => providers().default),
    popular,
    connected,
    paid,
    canConnect,
  }
}
