import { useServerSync } from "@/context/server-sync"
import { decode64 } from "@/utils/base64"
import { useParams } from "@solidjs/router"
import { createMemo, type Accessor } from "solid-js"
import { selectProviderCatalog } from "./provider-catalog"

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

export function useProviders(directory?: Accessor<string | undefined>) {
  const serverSync = useServerSync()
  const params = useParams()
  const connectEnabled = import.meta.env.VITE_ALLOW_PROVIDER_CONNECT !== "false"
  const dir = () => (directory ? directory() : decode64(params.dir))
  const providers = () => {
    const value = dir()
    const projectStore = value ? serverSync().child(value)[0] : undefined
    if (value)
      return selectProviderCatalog({
        explicit: true,
        directory: value,
        catalog: projectStore && { ready: projectStore.provider_ready, providers: projectStore.provider },
      })
    return selectProviderCatalog({
      explicit: false,
      directory: value,
      catalog: projectStore && { ready: projectStore.provider_ready, providers: projectStore.provider },
      global: serverSync().data.provider,
    })
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
