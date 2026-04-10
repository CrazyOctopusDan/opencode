import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Provider } from "../../provider/provider"
import { ModelsDev } from "../../provider/models"
import { ProviderAuth } from "../../provider/auth"
import { ProviderID } from "../../provider/schema"
import { fromEntries } from "remeda"
import { errors } from "../error"
import { lazy } from "../../util/lazy"
import { ModelPolicy } from "../../provider/model-policy"
import { TempoApi } from "../tempo-api"

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

export const ProviderRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List providers",
        description: "Get a list of all available AI providers, including both available and connected ones.",
        operationId: "provider.list",
        responses: {
          200: {
            description: "List of providers",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    all: ModelsDev.Provider.array(),
                    default: z.record(z.string(), z.string()),
                    connected: z.array(z.string()),
                    debug_tempo: z.any().optional(),
                  }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        const token = localToken(c.req.header("authorization"))
        const policy = await ModelPolicy.snapshot(true, token)
        const debugTempo = {
          policy: {
            enabled: policy.enabled,
            locked: policy.locked,
            providers: policy.list.length,
            models: policy.list.reduce((acc, item) => acc + item.models.length, 0),
            providerIDs: policy.list.map((item) => item.id),
          },
          tempo: TempoApi.trace(),
        }
        const connected = await Provider.list()
        const providers = enterpriseOnly(connected as any)
        const defaults = Object.fromEntries(
          Object.entries(providers).map(([id, item]) => [id, Object.keys((item as any).models ?? {})[0] ?? ""]),
        )
        return c.json({
          all: Object.values(providers),
          default: defaults,
          connected: Object.keys(providers),
          debug_tempo: debugTempo,
        })
      },
    )
    .get(
      "/debug/tempo",
      describeRoute({
        summary: "Get tempo debug trace",
        description: "Return last upstream tempo API trace and current policy snapshot.",
        operationId: "provider.debug.tempo",
        responses: {
          200: {
            description: "Tempo debug payload",
            content: {
              "application/json": {
                schema: resolver(z.any()),
              },
            },
          },
        },
      }),
      async (c) => {
        const token = localToken(c.req.header("authorization"))
        const policy = await ModelPolicy.snapshot(false, token)
        return c.json({
          policy: {
            enabled: policy.enabled,
            locked: policy.locked,
            providers: policy.list.length,
            models: policy.list.reduce((acc, item) => acc + item.models.length, 0),
            providerIDs: policy.list.map((item) => item.id),
          },
          tempo: TempoApi.trace(),
        })
      },
    )
    .get(
      "/auth",
      describeRoute({
        summary: "Get provider auth methods",
        description: "Retrieve available authentication methods for all AI providers.",
        operationId: "provider.auth",
        responses: {
          200: {
            description: "Provider auth methods",
            content: {
              "application/json": {
                schema: resolver(z.record(z.string(), z.array(ProviderAuth.Method))),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(await ProviderAuth.methods())
      },
    )
    .post(
      "/:providerID/oauth/authorize",
      describeRoute({
        summary: "OAuth authorize",
        description: "Initiate OAuth authorization for a specific AI provider to get an authorization URL.",
        operationId: "provider.oauth.authorize",
        responses: {
          200: {
            description: "Authorization URL and method",
            content: {
              "application/json": {
                schema: resolver(ProviderAuth.Authorization.optional()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "param",
        z.object({
          providerID: ProviderID.zod.meta({ description: "Provider ID" }),
        }),
      ),
      validator(
        "json",
        z.object({
          method: z.number().meta({ description: "Auth method index" }),
          inputs: z.record(z.string(), z.string()).optional().meta({ description: "Prompt inputs" }),
        }),
      ),
      async (c) => {
        const providerID = c.req.valid("param").providerID
        const { method, inputs } = c.req.valid("json")
        const result = await ProviderAuth.authorize({
          providerID,
          method,
          inputs,
        })
        return c.json(result)
      },
    )
    .post(
      "/:providerID/oauth/callback",
      describeRoute({
        summary: "OAuth callback",
        description: "Handle the OAuth callback from a provider after user authorization.",
        operationId: "provider.oauth.callback",
        responses: {
          200: {
            description: "OAuth callback processed successfully",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "param",
        z.object({
          providerID: ProviderID.zod.meta({ description: "Provider ID" }),
        }),
      ),
      validator(
        "json",
        z.object({
          method: z.number().meta({ description: "Auth method index" }),
          code: z.string().optional().meta({ description: "OAuth authorization code" }),
        }),
      ),
      async (c) => {
        const providerID = c.req.valid("param").providerID
        const { method, code } = c.req.valid("json")
        await ProviderAuth.callback({
          providerID,
          method,
          code,
        })
        return c.json(true)
      },
    ),
)
