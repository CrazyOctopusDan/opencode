import { Log } from "@/util/log"
import { TempoApi } from "./tempo-api"
import { TempoSession } from "./tempo-session"

const path = "/ai/data/api/open/code/metric/add"
const log = Log.create({ service: "server.tempo-metric" })

type Body = {
  text: string
  other: string
  modelName: string
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
  export type Input = Body

  export function url() {
    return `${TempoApi.baseURL()}${path}`
  }

  export async function send(input: Body) {
    if (!TempoApi.enabled()) return false
    const auth = TempoSession.get()
    if (!auth) return false
    const head = headers(auth)
    if (!head.get("Cookie")) return false
    return fetch(url(), {
      method: "POST",
      headers: head,
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(1_500),
    })
      .then((res) => res.ok)
      .catch((err) => {
        log.warn("metric send failed", {
          error: error(err),
        })
        return false
      })
  }
}
