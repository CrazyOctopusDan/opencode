export * as TempoApi from "./api.js"

import { Effect, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import { TempoModels } from "./models.js"

const publicKey =
  "04E3E9147DC0A86E3C6E56B1EB46D2913153A284A57EB6DEC94EBB8A073F22AF8B5EC918860B5DC2CA8CDD4F89A3533A7C16EB6A6531D84EC67E4408C901457FAA"

export class Error extends Schema.TaggedError<Error>()("TempoError", {
  message: Schema.String,
  expired: Schema.Boolean,
}) {}

export function settings(env: Readonly<Record<string, string | undefined>> = {}) {
  const mode = (env.OPENCODE_TEMPO_ENV ?? "prod").trim().toLowerCase()
  const baseURL = (
    env.OPENCODE_TEMPO_BASE_URL?.trim() ||
    (mode === "dev" || mode === "test"
      ? (env.OPENCODE_TEMPO_DEV_BASE_URL ?? "https://tempodev.travelsky.com.cn")
      : (env.OPENCODE_TEMPO_PROD_BASE_URL ?? "https://tempo.travelsky.com.cn"))
  )
    .replace(/\/+$/, "")
    .replace(/\/ai\/data\/api$/i, "")
  return {
    enabled: !!env.OPENCODE_TEMPO_BASE_URL?.trim() || ["", "dev", "test", "prod"].includes(mode),
    baseURL,
    publicKey: env.OPENCODE_TEMPO_SM2_PUBLIC_KEY?.trim() || publicKey,
    ttlSeconds: Number(env.OPENCODE_AUTH_TOKEN_TTL_SECONDS) || 8 * 60 * 60,
  }
}

export function expired(payload: unknown) {
  const value = record(payload)
  return (
    value?.success === false &&
    (value.code === 401 || value.code === "401") &&
    typeof value.message === "string" &&
    value.message.startsWith("token校验失败，失败原因")
  )
}

export function create(
  http: HttpClient.HttpClient,
  config: Pick<ReturnType<typeof settings>, "baseURL" | "publicKey"> = settings(),
) {
  const post = Effect.fn("TempoApi.post")(
    function* (path: string, body: object, token?: string) {
      const request = HttpClientRequest.post(`${config.baseURL}/ai/data/api/${path}`).pipe(
        HttpClientRequest.bodyJsonUnsafe(body),
        HttpClientRequest.acceptJson,
      )
      const response = yield* http.execute(
        token ? request.pipe(HttpClientRequest.setHeader("Cookie", `crowd.token_key=${token}`)) : request,
      )
      const payload: unknown = yield* response.json
      if (response.status < 200 || response.status >= 300 || record(payload)?.success === false)
        return yield* new Error({
          message: message(payload) ?? `Tempo request failed (${response.status})`,
          expired: expired(payload),
        })
      return payload
    },
    Effect.timeout("10 seconds"),
    Effect.mapError((error) =>
      error instanceof Error ? error : new Error({ message: "Tempo service is unavailable", expired: false }),
    ),
  )

  return {
    login: Effect.fn("TempoApi.login")(function* (input: { username: string; password: string }) {
      const { sm2 } = yield* Effect.promise(() => import("sm-crypto"))
      const enPasswd = yield* Effect.try({
        try: () => sm2.doEncrypt(input.password, config.publicKey, 1),
        catch: () => new Error({ message: "Invalid Tempo encryption configuration", expired: false }),
      })
      const payload = yield* post("auth/login", { username: input.username, enPasswd, plugin: "OpenCode" })
      const token = tokenFrom(payload)
      if (!token) return yield* new Error({ message: message(payload) ?? "Tempo login token missing", expired: false })
      return token
    }),
    models: Effect.fn("TempoApi.models")(function* (token: string) {
      return TempoModels.normalizePolicy(yield* post("llm/list", { plugin: "open-code" }, token), config.baseURL)
    }),
    generation: Effect.fn("TempoApi.generation")(function* (token: string, body: object) {
      const payload = yield* post("record/saveGeneration", body, token)
      const id = record(payload)?.data
      return typeof id === "string" || typeof id === "number" ? String(id) : undefined
    }),
    adoption: (token: string, body: object) => post("record/addAdoption", body, token).pipe(Effect.asVoid),
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function tokenFrom(value: unknown): string | undefined {
  const object = record(value)
  if (!object) return
  const token = [object.token, object.access_token, object.accessToken, object.jwt].find(
    (item): item is string => typeof item === "string" && item.length > 0,
  )
  return token ?? tokenFrom(object.data)
}

function message(value: unknown): string | undefined {
  const object = record(value)
  if (!object) return
  return (
    [object.message, object.msg, object.error].find(
      (item): item is string => typeof item === "string" && item.length > 0,
    ) ?? message(object.data)
  )
}
