import { Flag } from "@/flag/flag"
import { SM2 } from "@/util/sm2"

const loginPath = "/ai/data/api/auth/login"
const modelListPath = "/ai/data/api/llm/list"
const defaultDevBaseURL = "https://tempodev.travelsky.com.cn/"
const defaultProdBaseURL = "https://tempo.travelsky.com.cn/"

type PolicyModel = {
  id: string
  name: string
}

type PolicyProvider = {
  id: string
  name?: string
  baseURL: string
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

function asArray(value: unknown) {
  if (Array.isArray(value)) return value
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>
    if (Array.isArray(obj.data)) return obj.data
    if (Array.isArray(obj.list)) return obj.list
    if (Array.isArray(obj.records)) return obj.records
    if (Array.isArray(obj.rows)) return obj.rows
  }
  return []
}

function normalizeModel(item: Record<string, unknown>) {
  const id = [item.id, item.model_id, item.modelId, item.modelCode, item.code, item.name].find(
    (value) => typeof value === "string" && value.length > 0,
  )
  if (typeof id !== "string") return
  const name = [item.name, item.modelName, item.title].find((value) => typeof value === "string" && value.length > 0)
  return {
    id,
    name: typeof name === "string" ? name : id,
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
  const rawURL = [item.baseURL, item.baseUrl, item.api, item.url].find(
    (value) => typeof value === "string" && value.length > 0,
  )
  const baseURL = typeof rawURL === "string" ? rawURL : fallbackBaseURL

  const modelsSource = (item.models ?? item.modelList ?? item.children) as unknown
  const models = asArray(modelsSource)
    .map((entry) => (entry && typeof entry === "object" ? normalizeModel(entry as Record<string, unknown>) : undefined))
    .filter(hasModel)
  if (models.length === 0) return

  return {
    id: typeof providerID === "string" ? providerID : "tempo",
    name: typeof providerName === "string" ? providerName : "Tempo",
    baseURL,
    models,
  }
}

function normalizePolicy(payload: unknown): PolicyProvider[] {
  const fallbackBaseURL = base()
  const direct = asArray(payload)
    .map((item) => {
      if (!item || typeof item !== "object") return
      const raw = item as Record<string, unknown>
      if (raw.baseURL && raw.models) {
        return normalizeProvider(raw, fallbackBaseURL)
      }
      return undefined
    })
    .filter((item): item is PolicyProvider => !!item)
  if (direct.length > 0) return direct

  const list = asArray(payload)
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
    if (!res.ok) {
      throw new Error("Tempo login failed")
    }
    const token = extractToken(payload)
    const cookie = res.headers.get("set-cookie") ?? undefined
    return {
      payload,
      token,
      cookie,
    }
  }

  export async function listModels(auth?: { token?: string; cookie?: string }) {
    const headers = {
      ...(auth?.token ? { Authorization: `Bearer ${auth.token}` } : {}),
      ...(auth?.cookie ? { Cookie: auth.cookie } : {}),
    }
    const res = await fetch(`${base()}${modelListPath}`, {
      method: "GET",
      headers,
    })
    const payload = await res.json().catch(() => ({}))
    if (!res.ok) return []
    return normalizePolicy(payload)
  }
}
