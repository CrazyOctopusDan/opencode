import z from "zod"
import { Flag } from "@opencode-ai/core/flag/flag"
import { TempoApi } from "@/server/tempo-api"
import { TempoSession } from "@/server/tempo-session"

const PolicyModel = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  baseURL: z.string().url().optional(),
  apiKey: z.string().min(1).optional(),
  contextLength: z.number().int().positive().optional(),
  maxTokens: z.number().int().positive().optional(),
})

const PolicyProvider = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  baseURL: z.string().url(),
  apiKey: z.string().min(1).optional(),
  models: z.array(PolicyModel).min(1),
})

const PolicySchema = z.array(PolicyProvider).min(1)
const PolicyWrappedSchema = z.union([
  PolicySchema,
  z.object({ providers: PolicySchema }),
  z.object({ data: PolicySchema }),
])

type Policy = z.infer<typeof PolicySchema>[number]
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

const refreshMs = () => Math.max(5, Flag.OPENCODE_LOCKED_MODEL_POLICY_REFRESH_SECONDS ?? 60) * 1000

let cache: Snapshot = {
  enabled: false,
  locked: false,
  expired: false,
  list: [],
  provider: () => undefined,
  allowedProvider: () => false,
  allowedModel: () => false,
}
let expiresAt = 0

function normalizeTravelSky(list: Policy[]) {
  if (list.length === 0) return list
  const first = list[0]
  const models = new Map<string, Policy["models"][number]>()
  for (const item of list) {
    for (const model of item.models) {
      if (models.has(model.id)) continue
      const apiKey = model.apiKey ?? item.apiKey
      models.set(model.id, {
        ...model,
        baseURL: model.baseURL ?? item.baseURL,
        ...(apiKey ? { apiKey } : {}),
      })
    }
  }
  return [
    {
      id: "travelSky",
      name: "travelSky",
      baseURL: first.baseURL,
      ...(first.apiKey ? { apiKey: first.apiKey } : {}),
      models: [...models.values()],
    },
  ]
}

function makeSnapshot(list: Policy[], locked: boolean): Snapshot {
  const normalized = normalizeTravelSky(list)
  const map = new Map(normalized.map((item) => [item.id, item]))
  return {
    enabled: normalized.length > 0,
    locked: locked && normalized.length > 0,
    expired: false,
    list: normalized,
    provider: (id) => map.get(id),
    allowedProvider: (id) => map.has(id),
    allowedModel: (providerID, modelID) => {
      const provider = map.get(providerID)
      if (!provider) return false
      return provider.models.some((item) => item.id === modelID)
    },
  }
}

function makeExpiredSnapshot(message: string, locked: boolean): Snapshot {
  return {
    enabled: false,
    locked,
    expired: true,
    expiredMessage: message,
    list: [],
    provider: () => undefined,
    allowedProvider: () => false,
    allowedModel: () => false,
  }
}

function parsePayload(value: unknown): Policy[] | undefined {
  const parsed = PolicyWrappedSchema.safeParse(value)
  if (!parsed.success) return
  if (Array.isArray(parsed.data)) return parsed.data
  if ("providers" in parsed.data) return parsed.data.providers
  return parsed.data.data
}

async function fromRemote() {
  const url = Flag.OPENCODE_LOCKED_MODEL_POLICY_URL
  if (!url) return
  const token = Flag.OPENCODE_LOCKED_MODEL_POLICY_TOKEN
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined
  const body = await fetch(url, { headers })
    .then((res) => (res.ok ? res.json() : undefined))
    .catch(() => undefined)
  if (!body) return
  return parsePayload(body)
}

async function fromTempo(localToken?: string) {
  if (!TempoApi.enabled()) return
  const auth = TempoSession.get(localToken)
  if (!auth?.token && !auth?.cookie) return
  return TempoApi.listModels(auth)
}

async function fromFallbackPolicy() {
  return (await fromRemote()) ?? fromEnv()
}

function fromEnv() {
  const raw = Flag.OPENCODE_LOCKED_MODEL_POLICY
  if (!raw) return
  const payload = (() => {
    try {
      return JSON.parse(raw)
    } catch {
      return undefined
    }
  })()
  if (!payload) return
  return parsePayload(payload)
}

export namespace ModelPolicy {
  export async function snapshot(force = false, localToken?: string) {
    if (!force && Date.now() < expiresAt) return cache
    const auth = TempoSession.get(localToken)
    const hasTempoAuth = !!auth?.token || !!auth?.cookie
    const missingTempoAuth = TempoApi.enabled() && !!localToken && !hasTempoAuth
    if (missingTempoAuth) {
      const list = await fromFallbackPolicy()
      if (list) {
        cache = makeSnapshot(list, false)
        expiresAt = Date.now() + refreshMs()
        return cache
      }
      return makeExpiredSnapshot("Tempo auth missing for current local session; login recovery required", true)
    }

    const locked = TempoApi.enabled() && hasTempoAuth
    const tempo = await fromTempo(localToken)
    if (tempo?.status === "expired") {
      return makeExpiredSnapshot(tempo.message, locked)
    }
    const list = (tempo?.status === "ok" ? tempo.providers : undefined) ?? (await fromFallbackPolicy()) ?? []
    cache = makeSnapshot(list, locked)
    expiresAt = Date.now() + refreshMs()
    return cache
  }
}
