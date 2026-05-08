import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import { Config } from "@/config/config"
import { InstanceState } from "@/effect/instance-state"
import { InstanceStore } from "@/project/instance-store"
import { Provider } from "@/provider/provider"
import { errors } from "../../error"
import { lazy } from "@/util/lazy"
import { jsonRequest, runRequest } from "./trace"
import { Effect } from "effect"
import * as Log from "@opencode-ai/core/util/log"
import { ModelPolicy } from "@/provider/model-policy"

const log = Log.create({ service: "server.config" })

function auth(header: string | undefined) {
  if (!header?.startsWith("Bearer ")) return
  const token = header.slice("Bearer ".length).trim()
  if (!token) return
  return token
}

export const ConfigRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "Get configuration",
        description: "Retrieve the current OpenCode configuration settings and preferences.",
        operationId: "config.get",
        responses: {
          200: {
            description: "Get config info",
            content: {
              "application/json": {
                schema: resolver(Config.Info.zod),
              },
            },
          },
        },
      }),
      async (c) =>
        jsonRequest("ConfigRoutes.get", c, function* () {
          const cfg = yield* Config.Service
          return yield* cfg.get()
        }),
    )
    .patch(
      "/",
      describeRoute({
        summary: "Update configuration",
        description: "Update OpenCode configuration settings and preferences.",
        operationId: "config.update",
        responses: {
          200: {
            description: "Successfully updated config",
            content: {
              "application/json": {
                schema: resolver(Config.Info.zod),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", Config.Info.zod),
      async (c) => {
        const result = await runRequest(
          "ConfigRoutes.update",
          c,
          Effect.gen(function* () {
            const config = c.req.valid("json")
            const policy = yield* Effect.promise(() => ModelPolicy.snapshot(false, auth(c.req.header("authorization"))))
            if (policy.enabled) {
              const ids = new Set(policy.list.map((item) => item.id))
              config.provider = Object.fromEntries(
                Object.entries(config.provider ?? {})
                  .filter(([id]) => ids.has(id))
                  .map(([id, value]) => {
                    const item = policy.provider(id)!
                    return [
                      id,
                      {
                        ...value,
                        name: item.name ?? value.name,
                        npm: "@ai-sdk/openai-compatible",
                        api: item.baseURL,
                        options: {
                          ...(value.options ?? {}),
                          baseURL: item.baseURL,
                        },
                        models: Object.fromEntries(
                          Object.entries(value.models ?? {}).filter(([model]) => policy.allowedModel(id, model)),
                        ),
                      },
                    ]
                  }),
              )
              config.enabled_providers = [...ids]
              config.disabled_providers = []
            }
            const cfg = yield* Config.Service
            yield* cfg.update(config)
            return { config, ctx: yield* InstanceState.context }
          }),
        )
        const response = c.json(result.config)
        void runRequest(
          "ConfigRoutes.update.dispose",
          c,
          InstanceStore.Service.use((store) => store.dispose(result.ctx)).pipe(
            Effect.uninterruptible,
            Effect.catchCause((cause) => Effect.sync(() => log.warn("instance disposal failed", { cause }))),
          ),
        )
        return response
      },
    )
    .get(
      "/providers",
      describeRoute({
        summary: "List config providers",
        description: "Get a list of all configured AI providers and their default models.",
        operationId: "config.providers",
        responses: {
          200: {
            description: "List of providers",
            content: {
              "application/json": {
                schema: resolver(Provider.ConfigProvidersResult.zod),
              },
            },
          },
        },
      }),
      async (c) =>
        jsonRequest("ConfigRoutes.providers", c, function* () {
          const svc = yield* Provider.Service
          const policy = yield* Effect.promise(() => ModelPolicy.snapshot(true, auth(c.req.header("authorization"))))
          const connected = yield* svc.list()
          const providers = policy.enabled ? Object.assign({}, connected, Provider.fromModelPolicy(policy.list)) : connected
          return {
            providers: Object.values(providers),
            default: Provider.defaultModelIDs(providers),
          }
        }),
    ),
)
