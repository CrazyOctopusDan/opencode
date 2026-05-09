import type { Platform } from "@/context/platform"

const key = "desktop-login"

type Remembered = {
  username: string
  password: string
  remembered: boolean
  passwordAvailable: boolean
}

type SecureCredentialApi = {
  secureCredentialGet?: (
    key: string,
  ) => Promise<{ username: string; password: string | null; passwordAvailable: boolean } | null>
  secureCredentialSet?: (
    key: string,
    value: { username: string; password: string },
  ) => Promise<{ passwordSaved: boolean }>
  secureCredentialDelete?: (key: string) => Promise<void>
}

const empty = { username: "", password: "", remembered: false, passwordAvailable: false }

function api(platform: Platform) {
  if (platform.platform !== "desktop") return
  return (globalThis.window as typeof globalThis.window & { api?: SecureCredentialApi }).api
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
      ?.secureCredentialGet?.(key)
      .catch(() => null)
    if (!item) return empty
    return {
      username: item.username,
      password: item.password ?? "",
      remembered: item.passwordAvailable,
      passwordAvailable: item.passwordAvailable,
    }
  }

  export async function save(platform: Platform, input: { username: string; password: string }) {
    const result = await api(platform)
      ?.secureCredentialSet?.(key, input)
      .catch(() => undefined)
    return result?.passwordSaved === true
  }

  export async function clear(platform: Platform) {
    await api(platform)
      ?.secureCredentialDelete?.(key)
      .catch(() => undefined)
  }
}
