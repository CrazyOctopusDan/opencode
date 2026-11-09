export * as TravelSkyAuth from "./auth.js"

import { Clock, Context, Effect, Layer, Semaphore } from "effect"
import { HttpClient } from "effect/http"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { httpClient } from "@opencode/util/effect/app-node-platform"
import { TravelSky } from "@opencode/schema/travelsky"
import { Integration } from "@opencode/schema/integration"
import { Credential } from "../credential.js"
import { TempoApi } from "./api.js"
import { TempoModels } from "./models.js"

// The Tempo login token must never be used as a model API key by ModelResolver.
export const integrationID = Integration.ID.make("travelsky-login")
type Models = ReturnType<typeof TempoModels.normalizePolicy>
export interface Snapshot {
  readonly status: TravelSky.Status
  readonly models: Models
}

export interface Interface {
  readonly snapshot: (force?: boolean) => Effect.Effect<Snapshot>
  readonly login: (input: TravelSky.Login) => Effect.Effect<TravelSky.Status, TempoApi.Error>
  readonly logout: () => Effect.Effect<void>
  readonly report: (generation: object, adoption?: object) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/TravelSkyAuth") {}

export const layer = (config: TravelSky.Options = { ...TempoApi.settings(), enabled: false }) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      const http = yield* HttpClient.HttpClient
      const api = TempoApi.create(http, config)
      const lock = yield* Semaphore.make(1)
      const state: {
        current?: { token: string; checked: number; models: Models; expired: boolean; message?: string }
      } = {}
      const current = Effect.fn("TravelSkyAuth.current")(function* () {
        const stored = (yield* credentials.list(integrationID)).at(-1)
        if (stored?.value.type !== "key") return
        const metadata = stored.value.metadata
        if (metadata?.baseURL !== config.baseURL) return
        if (typeof metadata.expiresAt !== "number" || typeof metadata.username !== "string") return
        return { token: stored.value.key, username: metadata.username, expiresAt: metadata.expiresAt }
      })
      const snapshot = Effect.fn("TravelSkyAuth.snapshot")(function* (force = false): Effect.fn.Return<Snapshot> {
        if (!config.enabled) return { status: { enabled: false, authenticated: false }, models: [] }
        const auth = yield* current()
        const now = yield* Clock.currentTimeMillis
        if (!auth || auth.expiresAt <= now)
          return {
            status: { enabled: true, authenticated: false, username: auth?.username, expiresAt: auth?.expiresAt },
            models: [],
          }
        if (force || state.current?.token !== auth.token || now - state.current.checked >= 60_000) {
          const result = yield* api.models(auth.token).pipe(Effect.result)
          if (result._tag === "Success") {
            state.current = { token: auth.token, checked: now, models: result.success, expired: false }
          } else {
            if (result.failure.expired)
              yield* Effect.forEach(yield* credentials.list(integrationID), (item) => credentials.remove(item.id), {
                discard: true,
              })
            state.current = {
              token: auth.token,
              checked: now,
              models: state.current?.token === auth.token && !result.failure.expired ? state.current.models : [],
              expired: result.failure.expired,
              message: result.failure.message,
            }
          }
        }
        return {
          status: {
            enabled: true,
            authenticated: !state.current?.expired,
            username: auth.username,
            expiresAt: auth.expiresAt,
            message: state.current?.message,
          },
          models: state.current?.models ?? [],
        }
      })
      return Service.of({
        snapshot: (force) => lock.withPermit(snapshot(force)),
        login: (input) =>
          lock.withPermit(
            Effect.gen(function* () {
              if (!config.enabled)
                return yield* new TempoApi.Error({ message: "TravelSky is disabled", expired: false })
              const token = yield* api.login(input)
              const ttl = Number(config.ttlSeconds)
              const expiresAt =
                (yield* Clock.currentTimeMillis) +
                (Number.isFinite(ttl) && ttl > 0 ? Math.floor(ttl) : 8 * 60 * 60) * 1000
              const previous = yield* credentials.list(integrationID)
              yield* credentials.create({
                integrationID,
                label: input.username,
                value: Credential.Key.make({
                  type: "key",
                  key: token,
                  metadata: { username: input.username, expiresAt, baseURL: config.baseURL },
                }),
              })
              yield* Effect.forEach(previous, (item) => credentials.remove(item.id), { discard: true })
              state.current = undefined
              return { enabled: true, authenticated: true, username: input.username, expiresAt }
            }),
          ),
        logout: () =>
          lock.withPermit(
            Effect.gen(function* () {
              yield* Effect.forEach(yield* credentials.list(integrationID), (item) => credentials.remove(item.id), {
                discard: true,
              })
              state.current = undefined
            }),
          ),
        report: (generation, adoption) =>
          Effect.gen(function* () {
            if (!config.enabled) return
            const auth = yield* current()
            if (!auth || auth.expiresAt <= (yield* Clock.currentTimeMillis)) return
            const qaid = yield* api.generation(auth.token, generation)
            if (qaid && adoption) yield* api.adoption(auth.token, { ...adoption, qaid })
          }).pipe(Effect.ignore),
      })
    }),
  )

export const configured = (config?: TravelSky.Options) =>
  makeGlobalNode({ service: Service, layer: layer(config), deps: [Credential.node, httpClient] })
export const node = configured()
