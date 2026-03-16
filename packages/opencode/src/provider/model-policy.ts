import z from "zod"
import { Flag } from "@/flag/flag"
import { TempoApi } from "@/server/tempo-api"
import { TempoSession } from "@/server/tempo-session"

const PolicyModel = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
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
  list: Policy[]
  provider: (id: string) => Policy | undefined
  allowedProvider: (id: string) => boolean
  allowedModel: (providerID: string, modelID: string) => boolean
}

const refreshMs = () => Math.max(5, Flag.OPENCODE_LOCKED_MODEL_POLICY_REFRESH_SECONDS ?? 60) * 1000

let cache: Snapshot = {
  enabled: false,
  locked: false,
  list: [],
  provider: () => undefined,
  allowedProvider: () => false,
  allowedModel: () => false,
}
let expiresAt = 0

function makeSnapshot(list: Policy[], locked: boolean): Snapshot {
  const map = new Map(list.map((item) => [item.id, item]))
  return {
    enabled: locked || list.length > 0,
    locked,
    list,
    provider: (id) => map.get(id),
    allowedProvider: (id) => map.has(id),
    allowedModel: (providerID, modelID) => {
      const provider = map.get(providerID)
      if (!provider) return false
      return provider.models.some((item) => item.id === modelID)
    },
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
  return TempoApi.listModels(auth)
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
    const locked = TempoApi.enabled() && !!auth?.token
    const list = (await fromTempo(localToken)) ?? (await fromRemote()) ?? fromEnv() ?? []
    cache = makeSnapshot(list, locked)
    expiresAt = Date.now() + refreshMs()
    return cache
  }
}
