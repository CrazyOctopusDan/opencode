import { Config } from "@/config/config"
import { GlobalBus, type GlobalEvent as GlobalBusEvent } from "@/bus/global"
import { EffectBridge } from "@/effect/bridge"
import { EventV2 } from "@opencode-ai/core/event"
import { Installation } from "@/installation"
import { disposeAllInstancesAndEmitGlobalDisposed } from "@/server/global-lifecycle"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { Effect, Queue, Schema } from "effect"
import * as Stream from "effect/Stream"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import * as Sse from "effect/unstable/encoding/Sse"
import { RootHttpApi } from "../api"
import { GlobalLoginInput, GlobalUpgradeInput } from "../groups/global"
import { Flag } from "@opencode-ai/core/flag/flag"
import { AuthToken } from "@/server/auth-token"
import { ModelPolicy } from "@/provider/model-policy"
import { TempoApi } from "@/server/tempo-api"
import { TempoSession } from "@/server/tempo-session"

function eventData(data: unknown): Sse.Event {
  return {
    _tag: "Event",
    event: "message",
    id: undefined,
    data: JSON.stringify(data),
  }
}

function parseBody(body: string) {
  try {
    return JSON.parse(body || "{}") as unknown
  } catch {
    return undefined
  }
}

function auth(header: string | undefined) {
  if (!header?.startsWith("Bearer ")) return
  const token = header.slice("Bearer ".length).trim()
  if (!token) return
  return token
}

function eventResponse() {
  return Effect.gen(function* () {
    yield* Effect.logInfo("global event connected")
    const events = Stream.callback<GlobalBusEvent>((queue) => {
      const handler = (event: GlobalBusEvent) => Queue.offerUnsafe(queue, event)
      return Effect.acquireRelease(
        Effect.sync(() => GlobalBus.on("event", handler)),
        () => Effect.sync(() => GlobalBus.off("event", handler)),
      )
    })
    const heartbeat = Stream.tick("10 seconds").pipe(
      Stream.drop(1),
      Stream.map(() => ({ payload: { id: EventV2.ID.create(), type: "server.heartbeat", properties: {} } })),
    )

    return HttpServerResponse.stream(
      Stream.make({ payload: { id: EventV2.ID.create(), type: "server.connected", properties: {} } }).pipe(
        Stream.concat(events.pipe(Stream.merge(heartbeat, { haltStrategy: "left" }))),
        Stream.map(eventData),
        Stream.pipeThroughChannel(Sse.encode()),
        Stream.encodeText,
        Stream.ensuring(Effect.logInfo("global event disconnected")),
      ),
      {
        contentType: "text/event-stream",
        headers: {
          "Cache-Control": "no-cache, no-transform",
          "X-Accel-Buffering": "no",
          "X-Content-Type-Options": "nosniff",
        },
      },
    )
  })
}

export const globalHandlers = HttpApiBuilder.group(RootHttpApi, "global", (handlers) =>
  Effect.gen(function* () {
    const config = yield* Config.Service
    const installation = yield* Installation.Service
    const bridge = yield* EffectBridge.make()

    const health = Effect.fn("GlobalHttpApi.health")(function* () {
      return { healthy: true as const, version: InstallationVersion }
    })

    const loginRaw = Effect.fn("GlobalHttpApi.loginRaw")(function* (ctx: {
      request: HttpServerRequest.HttpServerRequest
    }) {
      const json = parseBody(yield* Effect.orDie(ctx.request.text))
      const payload = yield* Schema.decodeUnknownEffect(GlobalLoginInput)(json).pipe(
        Effect.map((value) => ({ ok: true as const, value })),
        Effect.catch(() => Effect.succeed({ ok: false as const })),
      )
      if (!payload.ok) return HttpServerResponse.jsonUnsafe({ message: "Invalid request body" }, { status: 400 })
      if (TempoApi.enabled()) {
        const upstream = yield* Effect.promise(() =>
          TempoApi.login({
            username: payload.value.username,
            password: payload.value.password,
          }).catch((err) => {
            console.error("[httpapi.global] tempo login failed", err)
            return
          }),
        )
        if (!upstream) {
          return HttpServerResponse.jsonUnsafe(
            { message: "Company login endpoint unreachable or rejected request. Check build baseURL and network route." },
            { status: 401 },
          )
        }
        const local = AuthToken.create(payload.value.username)
        TempoSession.set(local.access_token, { token: upstream.token })
        return HttpServerResponse.jsonUnsafe(local)
      }
      const password = Flag.OPENCODE_SERVER_PASSWORD
      const user = Flag.OPENCODE_SERVER_USERNAME ?? "opencode"
      if (password && (payload.value.username !== user || payload.value.password !== password)) {
        return HttpServerResponse.jsonUnsafe({ message: "Invalid username or password" }, { status: 401 })
      }
      return HttpServerResponse.jsonUnsafe(AuthToken.create(payload.value.username || user))
    })

    const logoutRaw = Effect.fn("GlobalHttpApi.logoutRaw")(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      const token = auth(request.headers.authorization)
      if (token) {
        AuthToken.revoke(token)
        TempoSession.remove(token)
      }
      return HttpServerResponse.jsonUnsafe({ ok: true })
    })

    const event = Effect.fn("GlobalHttpApi.event")(function* () {
      return yield* eventResponse()
    })

    const configGet = Effect.fn("GlobalHttpApi.configGet")(function* () {
      return yield* config.getGlobal()
    })

    const configUpdate = Effect.fn("GlobalHttpApi.configUpdate")(function* (ctx) {
      const request = yield* HttpServerRequest.HttpServerRequest
      const policy = yield* Effect.promise(() => ModelPolicy.snapshot(false, auth(request.headers.authorization)))
      if (policy.enabled) {
        const ids = new Set(policy.list.map((item) => item.id))
        ctx.payload.provider = Object.fromEntries(
          Object.entries(ctx.payload.provider ?? {})
            .filter(([id]) => ids.has(id))
            .map(([id, value]) => {
              const item = policy.provider(id)!
              const provider = value as NonNullable<typeof ctx.payload.provider>[string]
              return [
                id,
                {
                  ...provider,
                  name: item.name ?? provider.name,
                  npm: "@ai-sdk/openai-compatible",
                  api: item.baseURL,
                  options: {
                    ...(provider.options ?? {}),
                    baseURL: item.baseURL,
                  },
                  models: Object.fromEntries(
                    Object.entries(provider.models ?? {}).filter(([model]) => policy.allowedModel(id, model)),
                  ),
                },
              ]
            }),
        )
        ctx.payload.enabled_providers = [...ids]
        ctx.payload.disabled_providers = []
      }
      const result = yield* config.updateGlobal(ctx.payload)
      if (result.changed) bridge.fork(disposeAllInstancesAndEmitGlobalDisposed({ swallowErrors: true }))
      return result.info
    })

    const dispose = Effect.fn("GlobalHttpApi.dispose")(function* () {
      yield* disposeAllInstancesAndEmitGlobalDisposed()
      return true
    })

    const upgrade = Effect.fn("GlobalHttpApi.upgrade")(function* (ctx: { payload: typeof GlobalUpgradeInput.Type }) {
      const method = yield* installation.method()
      if (method === "unknown") {
        return {
          status: 400,
          body: { success: false as const, error: "Unknown installation method" },
        }
      }
      const target = ctx.payload.target || (yield* installation.latest(method))
      const result = yield* installation.upgrade(method, target).pipe(
        Effect.as({ status: 200, body: { success: true as const, version: target } }),
        Effect.catch((err) =>
          Effect.succeed({
            status: 500,
            body: {
              success: false as const,
              error: err instanceof Error ? err.message : String(err),
            },
          }),
        ),
      )
      if (!result.body.success) return result
      GlobalBus.emit("event", {
        directory: "global",
        payload: {
          type: Installation.Event.Updated.type,
          properties: { version: target },
        },
      })
      return result
    })

    const upgradeRaw = Effect.fn("GlobalHttpApi.upgradeRaw")(function* (ctx: {
      request: HttpServerRequest.HttpServerRequest
    }) {
      const body = yield* Effect.orDie(ctx.request.text)
      const json = parseBody(body)
      if (json === undefined) {
        return HttpServerResponse.jsonUnsafe({ success: false, error: "Invalid request body" }, { status: 400 })
      }
      const payload = yield* Schema.decodeUnknownEffect(GlobalUpgradeInput)(json).pipe(
        Effect.map((payload) => ({ valid: true as const, payload })),
        Effect.catch(() => Effect.succeed({ valid: false as const })),
      )
      if (!payload.valid) {
        return HttpServerResponse.jsonUnsafe({ success: false, error: "Invalid request body" }, { status: 400 })
      }
      const result = yield* upgrade({ payload: payload.payload })
      return HttpServerResponse.jsonUnsafe(result.body, { status: result.status })
    })

    return handlers
      .handleRaw("login", loginRaw)
      .handleRaw("logout", logoutRaw)
      .handle("health", health)
      .handleRaw("event", event)
      .handle("configGet", configGet)
      .handle("configUpdate", configUpdate)
      .handle("dispose", dispose)
      .handleRaw("upgrade", upgradeRaw)
  }),
)
