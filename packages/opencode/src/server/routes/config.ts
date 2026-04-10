import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Config } from "../../config/config"
import { Provider } from "../../provider/provider"
import { fromEntries, mapValues } from "remeda"
import { errors } from "../error"
import { Log } from "../../util/log"
import { lazy } from "../../util/lazy"
import { ModelPolicy } from "@/provider/model-policy"

const log = Log.create({ service: "server" })

function localToken(header: string | undefined) {
  if (!header?.startsWith("Bearer ")) return
  const token = header.slice("Bearer ".length).trim()
  if (!token) return
  return token
}

function enterpriseOnly(input: Record<string, any>) {
  const all = Object.values(input)
  const enterprise = all.filter((item) => item.id === "travelSky" || item.name === "travelSky")
  if (enterprise.length > 0) return fromEntries(enterprise.map((item) => [item.id, item]))
  return {}
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
                schema: resolver(Config.Info),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(await Config.get())
      },
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
                schema: resolver(Config.Info),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", Config.Info),
      async (c) => {
        const config = c.req.valid("json")
        const token = localToken(c.req.header("authorization"))
        const policy = await ModelPolicy.snapshot(false, token)
        if (policy.enabled) {
          const allowed = new Set(policy.list.map((item) => item.id))
          const provider = Object.fromEntries(
            Object.entries(config.provider ?? {})
              .filter(([providerID]) => allowed.has(providerID))
              .map(([providerID, value]) => {
                const item = policy.provider(providerID)!
                const models = Object.fromEntries(
                  Object.entries(value.models ?? {}).filter(([modelID]) => policy.allowedModel(providerID, modelID)),
                )
                return [
                  providerID,
                  {
                    ...value,
                    options: {
                      ...(value.options ?? {}),
                      baseURL: item.baseURL,
                    },
                    models,
                  },
                ]
              }),
          )
          config.provider = provider
        }
        await Config.update(config)
        return c.json(config)
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
                schema: resolver(
                  z.object({
                    providers: Provider.Info.array(),
                    default: z.record(z.string(), z.string()),
                  }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        using _ = log.time("providers")
        const token = localToken(c.req.header("authorization"))
        await ModelPolicy.snapshot(true, token)
        const providers = await Provider.list().then((x) => enterpriseOnly(mapValues(x, (item) => item)))
        const defaults = Object.fromEntries(
          Object.entries(providers).map(([id, item]) => [id, Object.keys((item as any).models ?? {})[0] ?? ""]),
        )
        return c.json({
          providers: Object.values(providers),
          default: defaults,
        })
      },
    ),
)
