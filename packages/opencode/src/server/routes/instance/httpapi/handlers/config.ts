import { Config } from "@/config/config"
import { Provider } from "@/provider/provider"
import * as InstanceState from "@/effect/instance-state"
import { Effect } from "effect"
import { HttpServerRequest } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { markInstanceForDisposal } from "../lifecycle"
import { ModelPolicy } from "@/provider/model-policy"

function auth(header: string | undefined) {
  if (!header?.startsWith("Bearer ")) return
  const token = header.slice("Bearer ".length).trim()
  if (!token) return
  return token
}

export const configHandlers = HttpApiBuilder.group(InstanceHttpApi, "config", (handlers) =>
  Effect.gen(function* () {
    const providerSvc = yield* Provider.Service
    const configSvc = yield* Config.Service

    const get = Effect.fn("ConfigHttpApi.get")(function* () {
      return yield* configSvc.get()
    })

    const update = Effect.fn("ConfigHttpApi.update")(function* (ctx) {
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
      yield* configSvc.update(ctx.payload)
      yield* markInstanceForDisposal(yield* InstanceState.context)
      return ctx.payload
    })

    const providers = Effect.fn("ConfigHttpApi.providers")(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      const policy = yield* Effect.promise(() => ModelPolicy.snapshot(true, auth(request.headers.authorization)))
      const connected = yield* providerSvc.list()
      const providers = policy.enabled ? Object.assign({}, connected, Provider.fromModelPolicy(policy.list)) : connected
      return {
        providers: Object.values(providers).map(Provider.toPublicInfo),
        default: Provider.defaultModelIDs(providers),
      }
    })

    return handlers.handle("get", get).handle("update", update).handle("providers", providers)
  }),
)
