import { TempoApi } from "./tempo-api"
import { TempoSession } from "./tempo-session"

const generationPath = "/ai/data/api/record/saveGeneration"
const adoptionPath = "/record/addAdoption"

type GenerationBody = {
  moduleName: string
  promptName: string
  generatedLines: string
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
  adoptedLines: string
  adoptedContent: string
  deletedLines: string
}

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

export namespace TempoMetric {
  export type GenerationInput = GenerationBody
  export type AdoptionInput = AdoptionBody

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

  async function post(input: { url: string; body: object }) {
    if (!TempoApi.enabled()) return false
    const auth = TempoSession.get()
    if (!auth) return false
    const head = headers(auth)
    if (!head.get("Cookie")) return false
    return fetch(input.url, {
      method: "POST",
      headers: head,
      body: JSON.stringify(input.body),
      signal: AbortSignal.timeout(1_500),
    })
      .then(async (res) => {
        if (!res.ok) return false
        const payload = await res.json().catch(() => undefined)
        if (rejected(payload)) return false
        return payload ?? true
      })
      .catch((err) => {
        console.warn("[server.tempo-metric] metric send failed", {
          error: error(err),
        })
        return false
      })
  }

  export async function sendGeneration(input: GenerationBody) {
    const payload = await post({
      url: generationUrl(),
      body: input,
    })
    return recordID(payload)
  }

  export async function sendAdoption(input: AdoptionBody) {
    return (
      (await post({
        url: adoptionUrl(),
        body: input,
      })) !== false
    )
  }
}
