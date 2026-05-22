import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import type { ServerConnection } from "@/context/server"
import { decode64 } from "@/utils/base64"

type Fetcher = (resource: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => Promise<Response>
type FetchArgs = [Parameters<typeof fetch>[0], Parameters<typeof fetch>[1]?]

export function authTokenFromCredentials(input: { username?: string; password: string }) {
  return btoa(`${input.username ?? "opencode"}:${input.password}`)
}

export function authFromToken(token: string | null) {
  const decoded = decode64(token ?? undefined)
  if (!decoded) return
  const separator = decoded.indexOf(":")
  if (separator === -1) return
  return {
    username: decoded.slice(0, separator) || "opencode",
    password: decoded.slice(separator + 1),
  }
}

function requestWithBearer(input: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1] | undefined, token: string): FetchArgs {
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
  headers.set("Authorization", `Bearer ${token}`)
  if (input instanceof Request) return [new Request(input, { ...init, headers }), undefined]
  return [input, { ...init, headers }]
}

export function createAuthRecoveringFetch(input: {
  fetch?: Fetcher
  token: () => string | undefined
  recover: () => Promise<boolean>
}): typeof fetch {
  const base = input.fetch ?? globalThis.fetch
  const fetcher: Fetcher = async (resource, init) => {
    const token = input.token()
    const firstRequest: FetchArgs = token
      ? requestWithBearer(resource instanceof Request ? resource.clone() : resource, init, token)
      : [resource instanceof Request ? resource.clone() : resource, init]
    const first = await base(firstRequest[0], firstRequest[1])
    if (first.status !== 401) return first
    const recovered = await input.recover().catch(() => false)
    if (!recovered) return first
    const next = input.token()
    if (!next) return first
    const retry = requestWithBearer(resource instanceof Request ? resource.clone() : resource, init, next)
    return base(retry[0], retry[1])
  }
  return fetcher as typeof fetch
}

export function createSdkForServer({
  server,
  token,
  ...config
}: Omit<NonNullable<Parameters<typeof createOpencodeClient>[0]>, "baseUrl"> & {
  server: ServerConnection.HttpBase
  token?: string
}) {
  const auth = (() => {
    if (token) {
      return {
        Authorization: `Bearer ${token}`,
      }
    }
    if (!server.password) return
    return {
      Authorization: `Basic ${authTokenFromCredentials({ username: server.username, password: server.password })}`,
    }
  })()

  return createOpencodeClient({
    ...config,
    headers: {
      ...(config.headers instanceof Headers ? Object.fromEntries(config.headers.entries()) : config.headers),
      ...auth,
    },
    baseUrl: server.url,
  })
}
