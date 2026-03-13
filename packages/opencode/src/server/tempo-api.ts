import { Flag } from "@/flag/flag"
import { SM2 } from "@/util/sm2"

const loginPath = "/ai/data/api/auth/login"
const modelListPath = "/ai/data/api/llm/list"
const defaultDevBaseURL = "https://tempodev.travelsky.com.cn/"
const defaultProdBaseURL = "https://tempo.travelsky.com.cn/"

type PolicyModel = {
  id: string
  name: string
  apiKey?: string
  contextLength?: number
  maxTokens?: number
}

type PolicyProvider = {
  id: string
  name?: string
  baseURL: string
  apiKey?: string
  models: PolicyModel[]
}

function base() {
  if (Flag.OPENCODE_TEMPO_BASE_URL) return Flag.OPENCODE_TEMPO_BASE_URL.replace(/\/+$/, "")
  const env = (Flag.OPENCODE_TEMPO_ENV ?? "prod").toLowerCase()
  if (env === "dev" || env === "test") {
    return (Flag.OPENCODE_TEMPO_DEV_BASE_URL ?? defaultDevBaseURL).replace(/\/+$/, "")
  }
  return (Flag.OPENCODE_TEMPO_PROD_BASE_URL ?? defaultProdBaseURL).replace(/\/+$/, "")
}

function extractToken(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return
  const obj = value as Record<string, unknown>
  const direct = [obj.token, obj.access_token, obj.accessToken, obj.jwt].find((item) => typeof item === "string")
  if (typeof direct === "string") return direct
  return extractToken(obj.data)
}

function extractMessage(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return
  const obj = value as Record<string, unknown>
  const direct = [obj.message, obj.msg, obj.error].find((item) => typeof item === "string" && item.length > 0)
  if (typeof direct === "string") return direct
  return extractMessage(obj.data)
}

function asArray(value: unknown) {
  if (Array.isArray(value)) return value
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>
    if (Array.isArray(obj.data)) return obj.data
    if (obj.data && typeof obj.data === "object") {
      const nested = obj.data as Record<string, unknown>
      if (Array.isArray(nested.providers)) return nested.providers
      if (Array.isArray(nested.models)) return nested.models
      if (Array.isArray(nested.list)) return nested.list
      if (Array.isArray(nested.records)) return nested.records
      if (Array.isArray(nested.rows)) return nested.rows
    }
    if (Array.isArray(obj.providers)) return obj.providers
    if (Array.isArray(obj.models)) return obj.models
    if (Array.isArray(obj.list)) return obj.list
    if (Array.isArray(obj.records)) return obj.records
    if (Array.isArray(obj.rows)) return obj.rows
  }
  return []
}

function normalizeModel(item: Record<string, unknown>) {
  const id = [item.model, item.id, item.model_id, item.modelId, item.modelCode, item.code, item.name].find(
    (value) => typeof value === "string" && value.length > 0,
  )
  if (typeof id !== "string") return
  const name = [item.titile, item.title, item.name, item.modelName].find(
    (value) => typeof value === "string" && value.length > 0,
  )
  const apiKey = typeof item.apiKey === "string" && item.apiKey.length > 0 ? item.apiKey : undefined
  const contextLength = typeof item.contextLength === "number" && Number.isFinite(item.contextLength) && item.contextLength > 0
    ? Math.floor(item.contextLength)
    : undefined
  const completion = item.completionOptions
  const completionMax =
    completion && typeof completion === "object" ? (completion as Record<string, unknown>).maxTokens : undefined
  const maxTokens =
    typeof completionMax === "number" && Number.isFinite(completionMax) && completionMax > 0
      ? Math.floor(completionMax)
      : undefined
  return {
    id,
    name: typeof name === "string" ? name : id,
    apiKey,
    contextLength,
    maxTokens,
  }
}

function hasModel(input: PolicyModel | undefined): input is PolicyModel {
  return !!input
}

function normalizeProvider(item: Record<string, unknown>, fallbackBaseURL: string): PolicyProvider | undefined {
  const providerID = [item.id, item.provider_id, item.providerId, item.vendor, item.channel].find(
    (value) => typeof value === "string" && value.length > 0,
  )
  const providerName = [item.name, item.providerName, item.vendorName].find(
    (value) => typeof value === "string" && value.length > 0,
  )
  const rawURL = [item.baseURL, item.baseUrl, item.base_url, item.api, item.url].find(
    (value) => typeof value === "string" && value.length > 0,
  )
  const baseURL = typeof rawURL === "string" ? rawURL : fallbackBaseURL
  const apiKey = typeof item.apiKey === "string" && item.apiKey.length > 0 ? item.apiKey : undefined

  const modelsSource = (item.models ?? item.modelList ?? item.model_list ?? item.children) as unknown
  const models = asArray(modelsSource)
    .map((entry) => (entry && typeof entry === "object" ? normalizeModel(entry as Record<string, unknown>) : undefined))
    .filter(hasModel)
  if (models.length === 0) return

  return {
    id: typeof providerID === "string" ? providerID : "tempo",
    name: typeof providerName === "string" ? providerName : "Tempo",
    baseURL,
    apiKey,
    models,
  }
}

function normalizePolicy(payload: unknown): PolicyProvider[] {
  const fallbackBaseURL = base()
  const sources = [payload]
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>
    sources.push(obj.data, obj.result, obj.payload)
  }

  const direct = sources
    .flatMap((source) => asArray(source))
    .map((item) => {
      if (!item || typeof item !== "object") return
      const raw = item as Record<string, unknown>
      return normalizeProvider(raw, fallbackBaseURL)
    })
    .filter((item): item is PolicyProvider => !!item)
  if (direct.length > 0) return direct

  const rows = sources
    .flatMap((source) => asArray(source))
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .filter((item) => typeof item.provider === "string" || typeof item.apiBase === "string" || typeof item.model === "string")

  if (rows.length > 0) {
    const grouped = new Map<string, PolicyProvider>()
    for (const row of rows) {
      const providerID = typeof row.provider === "string" && row.provider.length > 0 ? row.provider : "tempo"
      const baseURL = typeof row.apiBase === "string" && row.apiBase.length > 0 ? row.apiBase : fallbackBaseURL
      const apiKey = typeof row.apiKey === "string" && row.apiKey.length > 0 ? row.apiKey : undefined
      const key = `${providerID}::${baseURL}::${apiKey ?? ""}`
      const model = normalizeModel(row)
      if (!model) continue
      const current = grouped.get(key)
      if (current) {
        if (!current.models.some((item) => item.id === model.id)) current.models.push(model)
        continue
      }
      grouped.set(key, {
        id: providerID,
        name: providerID,
        baseURL,
        apiKey,
        models: [model],
      })
    }
    const providers = [...grouped.values()].filter((item) => item.models.length > 0)
    if (providers.length > 0) return providers
  }

  const list = sources.flatMap((source) => asArray(source))
  const flatModels = list
    .map((item) => (item && typeof item === "object" ? normalizeModel(item as Record<string, unknown>) : undefined))
    .filter(hasModel)
  if (flatModels.length === 0) return []
  return [
    {
      id: "tempo",
      name: "Tempo",
      baseURL: fallbackBaseURL,
      models: flatModels,
    },
  ]
}

export namespace TempoApi {
  export function enabled() {
    if (Flag.OPENCODE_TEMPO_BASE_URL?.trim()) return true
    const env = Flag.OPENCODE_TEMPO_ENV?.trim().toLowerCase()
    if (!env) return true
    return env === "dev" || env === "test" || env === "prod"
  }

  export async function login(input: { username: string; password: string }) {
    const url = `${base()}${loginPath}`
    const enPasswd = SM2.encryptPassword(input.password, Flag.OPENCODE_TEMPO_SM2_PUBLIC_KEY)
    const body = { username: input.username, enPasswd }
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    })
    const payload = await res.json().catch(() => ({}))
    const success = payload && typeof payload === "object" ? (payload as Record<string, unknown>).success : undefined
    if (!res.ok || success === false) {
      throw new Error(extractMessage(payload) ?? "Tempo login failed")
    }
    const token = extractToken(payload)
    if (!token) {
      throw new Error(extractMessage(payload) ?? "Tempo login token missing")
    }
    return {
      payload,
      token,
    }
  }

  export async function listModels(auth?: { token?: string; cookie?: string }) {
    const headers = {
      ...(() => {
        if (auth?.token) return { Cookie: `crown.token_key=${auth.token}` }
        if (auth?.cookie) return { Cookie: auth.cookie }
        return {}
      })(),
    }
    const res = await fetch(`${base()}${modelListPath}`, {
      method: "GET",
      headers,
    })
    const payload = await res.json().catch(() => ({}))
    const success = payload && typeof payload === "object" ? (payload as Record<string, unknown>).success : undefined
    if (!res.ok || success === false) return []
    return normalizePolicy(payload)
  }
}
