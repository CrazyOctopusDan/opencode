import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { streamSSE } from "hono/streaming"
import z from "zod"
import { BusEvent } from "@/bus/bus-event"
import { GlobalBus } from "@/bus/global"
import { Instance } from "../../project/instance"
import { Installation } from "@/installation"
import { Log } from "../../util/log"
import { lazy } from "../../util/lazy"
import { Config } from "../../config/config"
import { errors } from "../error"
import { Flag } from "@/flag/flag"
import { AuthToken } from "../auth-token"
import { ModelPolicy } from "@/provider/model-policy"
import { TempoApi } from "../tempo-api"
import { TempoSession } from "../tempo-session"

const log = Log.create({ service: "server" })

export const GlobalDisposedEvent = BusEvent.define("global.disposed", z.object({}))

export const GlobalRoutes = lazy(() =>
  new Hono()
    .post(
      "/login",
      describeRoute({
        summary: "Login",
        description: "Authenticate with username and password, then get bearer token.",
        operationId: "global.login",
        responses: {
          200: {
            description: "Login success",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    access_token: z.string(),
                    token_type: z.literal("Bearer"),
                    expires_in: z.number(),
                  }),
                ),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          username: z.string(),
          password: z.string(),
        }),
      ),
      async (c) => {
        const body = c.req.valid("json")
        if (TempoApi.enabled()) {
          const upstream = await TempoApi.login({
            username: body.username,
            password: body.password,
          })
          const local = AuthToken.create(body.username)
          TempoSession.set(local.access_token, {
            token: upstream.token,
            cookie: upstream.cookie,
          })
          return c.json(local)
        }
        const password = Flag.OPENCODE_SERVER_PASSWORD
        const expected = Flag.OPENCODE_SERVER_USERNAME ?? "opencode"
        if (password && (body.username !== expected || body.password !== password)) {
          return c.json({ access_token: "", token_type: "Bearer", expires_in: 0 }, 401)
        }
        return c.json(AuthToken.create(body.username || expected))
      },
    )
    .post(
      "/logout",
      describeRoute({
        summary: "Logout",
        description: "Revoke bearer token from current session.",
        operationId: "global.logout",
        responses: {
          200: {
            description: "Logout success",
            content: {
              "application/json": {
                schema: resolver(z.object({ ok: z.boolean() })),
              },
            },
          },
        },
      }),
      async (c) => {
        const auth = c.req.header("authorization")
        const token = auth?.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : ""
        if (token) {
          AuthToken.revoke(token)
          TempoSession.remove(token)
        }
        return c.json({ ok: true })
      },
    )
    .get(
      "/health",
      describeRoute({
        summary: "Get health",
        description: "Get health information about the OpenCode server.",
        operationId: "global.health",
        responses: {
          200: {
            description: "Health information",
            content: {
              "application/json": {
                schema: resolver(z.object({ healthy: z.literal(true), version: z.string() })),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json({ healthy: true, version: Installation.VERSION })
      },
    )
    .get(
      "/event",
      describeRoute({
        summary: "Get global events",
        description: "Subscribe to global events from the OpenCode system using server-sent events.",
        operationId: "global.event",
        responses: {
          200: {
            description: "Event stream",
            content: {
              "text/event-stream": {
                schema: resolver(
                  z
                    .object({
                      directory: z.string(),
                      payload: BusEvent.payloads(),
                    })
                    .meta({
                      ref: "GlobalEvent",
                    }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        log.info("global event connected")
        c.header("X-Accel-Buffering", "no")
        c.header("X-Content-Type-Options", "nosniff")
        return streamSSE(c, async (stream) => {
          stream.writeSSE({
            data: JSON.stringify({
              payload: {
                type: "server.connected",
                properties: {},
              },
            }),
          })
          async function handler(event: any) {
            await stream.writeSSE({
              data: JSON.stringify(event),
            })
          }
          GlobalBus.on("event", handler)

          // Send heartbeat every 10s to prevent stalled proxy streams.
          const heartbeat = setInterval(() => {
            stream.writeSSE({
              data: JSON.stringify({
                payload: {
                  type: "server.heartbeat",
                  properties: {},
                },
              }),
            })
          }, 10_000)

          await new Promise<void>((resolve) => {
            stream.onAbort(() => {
              clearInterval(heartbeat)
              GlobalBus.off("event", handler)
              resolve()
              log.info("global event disconnected")
            })
          })
        })
      },
    )
    .get(
      "/config",
      describeRoute({
        summary: "Get global configuration",
        description: "Retrieve the current global OpenCode configuration settings and preferences.",
        operationId: "global.config.get",
        responses: {
          200: {
            description: "Get global config info",
            content: {
              "application/json": {
                schema: resolver(Config.Info),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(await Config.getGlobal())
      },
    )
    .patch(
      "/config",
      describeRoute({
        summary: "Update global configuration",
        description: "Update global OpenCode configuration settings and preferences.",
        operationId: "global.config.update",
        responses: {
          200: {
            description: "Successfully updated global config",
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
        const policy = await ModelPolicy.snapshot()
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
                    name: item.name ?? value.name,
                    npm: "@ai-sdk/openai-compatible",
                    api: item.baseURL,
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
          config.enabled_providers = [...allowed]
          config.disabled_providers = []
        }
        const next = await Config.updateGlobal(config)
        return c.json(next)
      },
    )
    .post(
      "/dispose",
      describeRoute({
        summary: "Dispose instance",
        description: "Clean up and dispose all OpenCode instances, releasing all resources.",
        operationId: "global.dispose",
        responses: {
          200: {
            description: "Global disposed",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      async (c) => {
        await Instance.disposeAll()
        GlobalBus.emit("event", {
          directory: "global",
          payload: {
            type: GlobalDisposedEvent.type,
            properties: {},
          },
        })
        return c.json(true)
      },
    ),
)
