import { TempoApi } from "./tempo-api"
import { TempoSession } from "./tempo-session"

const generationPath = "/ai/data/api/record/saveGeneration"
const adoptionPath = "/ai/data/api/record/addAdoption"

type GenerationBody = {
  modelName: string
  promptName: string
  generatedLines: number
  adoptedLines: number
  sessionId: string
  codeLanguage: string
  toolName: string
  toolVersion: string
  ideName: string
  ideVersion: string
  projectName: string
  requestContent: string
  responseContent: string
}

type AdoptionBody = {
  qaid: string
  adoptedLines: number
  adoptedContent: string
  deletedLines: number
}

type MetricTrace = {
  at: string
  endpoint: "saveGeneration" | "addAdoption"
  url: string
  sent: boolean
  status: "skipped" | "ok" | "rejected" | "http-error" | "error"
  reason?: string
  http?: {
    status: number
    ok: boolean
  }
  parsed?: {
    success?: unknown
    code?: unknown
    message?: string
    dataType?: string
  }
  qaid?: string
}

let lastTrace: MetricTrace | undefined
const traces: Partial<Record<MetricTrace["endpoint"], MetricTrace>> = {}

function cookie(auth: { token?: string; cookie?: string }) {
  if (auth.token) return `crowd.token_key=${auth.token}`
  if (auth.cookie) return auth.cookie
  return
}

function headers(auth: { token?: string; cookie?: string }) {
  const head = new Headers()
  head.set("Content-Type", "application/json")
  const key = cookie(auth)
  if (key) head.set("Cookie", key)
  return head
}

function error(input: unknown) {
  if (input instanceof Error) return input.message
  return String(input)
}

function object(input: unknown): input is Record<string, unknown> {
  return !!input && typeof input === "object" && !Array.isArray(input)
}

function stringValue(input: unknown) {
  if (typeof input === "string" && input.trim()) return input
  return
}

function parsed(input: unknown): MetricTrace["parsed"] {
  if (!object(input)) return
  return {
    success: input.success,
    code: input.code,
    message: stringValue(input.message) ?? stringValue(input.msg) ?? stringValue(input.error),
    dataType: input.data === undefined ? undefined : typeof input.data,
  }
}

function record(input: Omit<MetricTrace, "at">) {
  if (input.endpoint === "saveGeneration") delete traces.addAdoption
  const next = {
    at: new Date().toISOString(),
    ...input,
  }
  lastTrace = next
  traces[next.endpoint] = next
}

function format(input: MetricTrace) {
  const success = input.parsed?.success === undefined ? "" : ` success=${String(input.parsed.success)}`
  const code = input.parsed?.code === undefined ? "" : ` code=${String(input.parsed.code)}`
  const message = input.parsed?.message ? ` message=${input.parsed.message}` : ""
  const qaid = input.qaid ? ` qaid=${input.qaid}` : ""
  const http = input.http ? ` http=${input.http.status}` : ""
  const reason = input.reason ? ` reason=${input.reason}` : ""
  return `${input.endpoint} ${input.status}${http}${success}${code}${reason}${qaid}${message}`
}

export namespace TempoMetric {
  export type GenerationInput = GenerationBody
  export type AdoptionInput = AdoptionBody
  export type Trace = MetricTrace

  export function generationUrl() {
    return `${TempoApi.baseURL()}${generationPath}`
  }

  export function adoptionUrl() {
    return `${TempoApi.baseURL()}${adoptionPath}`
  }

  function recordID(input: unknown) {
    if (!input || typeof input !== "object" || Array.isArray(input)) return
    const data = (input as Record<string, unknown>).data
    if (typeof data === "string" && data.trim()) return data
    if (typeof data === "number") return String(data)
    return
  }

  function rejected(input: unknown) {
    if (TempoApi.expired(input)) return true
    return (
      !!input &&
      typeof input === "object" &&
      !Array.isArray(input) &&
      (input as Record<string, unknown>).success === false
    )
  }

  async function post(input: { endpoint: MetricTrace["endpoint"]; url: string; body: object }) {
    if (!TempoApi.enabled()) {
      record({ endpoint: input.endpoint, url: input.url, sent: false, status: "skipped", reason: "disabled" })
      return false
    }
    const auth = TempoSession.get()
    if (!auth) {
      record({ endpoint: input.endpoint, url: input.url, sent: false, status: "skipped", reason: "no-auth" })
      return false
    }
    const head = headers(auth)
    if (!head.get("Cookie")) {
      record({ endpoint: input.endpoint, url: input.url, sent: false, status: "skipped", reason: "no-cookie" })
      return false
    }
    return fetch(input.url, {
      method: "POST",
      headers: head,
      body: JSON.stringify(input.body),
      signal: AbortSignal.timeout(1_500),
    })
      .then(async (res) => {
        const payload = await res.json().catch(() => undefined)
        const info = parsed(payload)
        if (!res.ok) {
          record({
            endpoint: input.endpoint,
            url: input.url,
            sent: true,
            status: "http-error",
            reason: "non-ok",
            http: { status: res.status, ok: res.ok },
            parsed: info,
          })
          return false
        }
        if (rejected(payload)) {
          record({
            endpoint: input.endpoint,
            url: input.url,
            sent: true,
            status: "rejected",
            reason: "rejected",
            http: { status: res.status, ok: res.ok },
            parsed: info,
          })
          return false
        }
        record({
          endpoint: input.endpoint,
          url: input.url,
          sent: true,
          status: "ok",
          http: { status: res.status, ok: res.ok },
          parsed: info,
        })
        return payload ?? true
      })
      .catch((err) => {
        record({
          endpoint: input.endpoint,
          url: input.url,
          sent: true,
          status: "error",
          reason: error(err),
        })
        console.warn("[server.tempo-metric] metric send failed", {
          error: error(err),
        })
        return false
      })
  }

  export async function sendGeneration(input: GenerationBody) {
    const payload = await post({
      endpoint: "saveGeneration",
      url: generationUrl(),
      body: input,
    })
    const qaid = recordID(payload)
    if (lastTrace?.endpoint === "saveGeneration") {
      lastTrace = {
        ...lastTrace,
        ...(qaid ? { qaid } : {}),
      }
      traces.saveGeneration = lastTrace
    }
    return qaid
  }

  export async function sendAdoption(input: AdoptionBody) {
    return (
      (await post({
        endpoint: "addAdoption",
        url: adoptionUrl(),
        body: input,
      })) !== false
    )
  }

  export function trace() {
    return lastTrace
  }

  export function summary() {
    const items = [traces.saveGeneration, traces.addAdoption].filter((item): item is MetricTrace => !!item)
    if (items.length === 0) return
    return items.map(format).join(" | ")
  }
}
