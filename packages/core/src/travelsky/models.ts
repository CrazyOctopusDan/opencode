export * as TempoModels from "./models.js"

type PolicyModel = {
  id: string
  name: string
  baseURL?: string
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
  const companyRow = typeof item.provider === "string" || typeof item.apiBase === "string"
  const model = [item.model, item.model_id, item.modelId, item.modelCode, item.code].find(
    (value) => typeof value === "string" && value.length > 0,
  )
  const id =
    typeof model === "string"
      ? model
      : companyRow
        ? undefined
        : [item.id, item.name].find((value) => typeof value === "string" && value.length > 0)
  if (typeof id !== "string") return
  const title = [
    item.title,
    item.titile,
    companyRow ? undefined : item.name,
    companyRow ? undefined : item.modelName,
  ].find((value) => typeof value === "string" && value.length > 0)
  const apiKey = typeof item.apiKey === "string" && item.apiKey.length > 0 ? item.apiKey : undefined
  const baseURL =
    typeof item.apiBase === "string" && item.apiBase.length > 0
      ? item.apiBase
      : typeof item.baseURL === "string" && item.baseURL.length > 0
        ? item.baseURL
        : typeof item.baseUrl === "string" && item.baseUrl.length > 0
          ? item.baseUrl
          : undefined
  const contextLength =
    typeof item.contextLength === "number" && Number.isFinite(item.contextLength) && item.contextLength > 0
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
    name: typeof title === "string" ? title : id,
    ...(baseURL ? { baseURL } : {}),
    ...(apiKey ? { apiKey } : {}),
    ...(contextLength ? { contextLength } : {}),
    ...(maxTokens ? { maxTokens } : {}),
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
    ...(apiKey ? { apiKey } : {}),
    models,
  }
}

export function normalizePolicy(payload: unknown, baseURL: string): PolicyProvider[] {
  const fallbackBaseURL = baseURL
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
    .filter(
      (item) => typeof item.provider === "string" || typeof item.apiBase === "string" || typeof item.model === "string",
    )

  if (rows.length > 0) {
    const grouped = new Map<string, PolicyModel>()
    const urls = new Set<string>()
    for (const row of rows) {
      const baseURL = typeof row.apiBase === "string" && row.apiBase.length > 0 ? row.apiBase : fallbackBaseURL
      urls.add(baseURL)
      const model = normalizeModel(row)
      if (!model) continue
      const current = grouped.get(model.id)
      if (current) {
        if (!current.baseURL) current.baseURL = model.baseURL ?? baseURL
        if (!current.apiKey) current.apiKey = model.apiKey
        continue
      }
      grouped.set(model.id, {
        ...model,
        baseURL: model.baseURL ?? baseURL,
      })
    }
    const models = [...grouped.values()]
    if (models.length > 0) {
      return [
        {
          id: "travelSky",
          name: "travelSky",
          baseURL: urls.size === 1 ? [...urls][0] : fallbackBaseURL,
          models,
          ...(models.find((item) => item.apiKey)?.apiKey ? { apiKey: models.find((item) => item.apiKey)?.apiKey } : {}),
        },
      ]
    }
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
