import { Hono, type Context } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { streamSSE } from "hono/streaming"
import z from "zod"
import { BusEvent } from "@/bus/bus-event"
import { SyncEvent } from "@/sync"
import { GlobalBus } from "@/bus/global"
import { AsyncQueue } from "@/util/queue"
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

function localToken(header: string | undefined) {
  if (!header?.startsWith("Bearer ")) return
  const token = header.slice("Bearer ".length).trim()
  if (!token) return
  return token
}

export const GlobalDisposedEvent = BusEvent.define("global.disposed", z.object({}))

async function streamEvents(c: Context, subscribe: (q: AsyncQueue<string | null>) => () => void) {
  return streamSSE(c, async (stream) => {
    const q = new AsyncQueue<string | null>()
    let done = false

    q.push(
      JSON.stringify({
        payload: {
          type: "server.connected",
          properties: {},
        },
      }),
    )

    // Send heartbeat every 10s to prevent stalled proxy streams.
    const heartbeat = setInterval(() => {
      q.push(
        JSON.stringify({
          payload: {
            type: "server.heartbeat",
            properties: {},
          },
        }),
      )
    }, 10_000)

    const stop = () => {
      if (done) return
      done = true
      clearInterval(heartbeat)
      unsub()
      q.push(null)
      log.info("global event disconnected")
    }

    const unsub = subscribe(q)

    stream.onAbort(stop)

    try {
      for await (const data of q) {
        if (data === null) return
        await stream.writeSSE({ data })
      }
    } finally {
      stop()
    }
  })
}

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
        const tempo = TempoApi.enabled()
        log.warn("global login mode", {
          tempo,
          tempo_env: Flag.OPENCODE_TEMPO_ENV,
          tempo_base_url: Flag.OPENCODE_TEMPO_BASE_URL,
          tempo_dev_base_url: Flag.OPENCODE_TEMPO_DEV_BASE_URL,
          tempo_prod_base_url: Flag.OPENCODE_TEMPO_PROD_BASE_URL,
          tempo_sm2_public_key: !!Flag.OPENCODE_TEMPO_SM2_PUBLIC_KEY?.trim(),
        })

        if (tempo) {
          const upstream = await TempoApi.login({
            username: body.username,
            password: body.password,
          }).catch((error) => {
            log.error("tempo login failed", { error })
            return
          })
          if (!upstream) {
            return c.json({ message: "Company login endpoint unreachable or rejected request. Check build baseURL and network route." }, 401)
          }
          const local = AuthToken.create(body.username)
          TempoSession.set(local.access_token, {
            token: upstream.token,
          })
          return c.json(local)
        }
        const password = Flag.OPENCODE_SERVER_PASSWORD
        const expected = Flag.OPENCODE_SERVER_USERNAME ?? "opencode"
        if (password && (body.username !== expected || body.password !== password)) {
          return c.json({ message: "Invalid username or password" }, 401)
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
        c.header("Cache-Control", "no-cache, no-transform")
        c.header("X-Accel-Buffering", "no")
        c.header("X-Content-Type-Options", "nosniff")

        return streamEvents(c, (q) => {
          async function handler(event: any) {
            q.push(JSON.stringify(event))
          }
          GlobalBus.on("event", handler)
          return () => GlobalBus.off("event", handler)
        })
      },
    )
    .get(
      "/sync-event",
      describeRoute({
        summary: "Subscribe to global sync events",
        description: "Get global sync events",
        operationId: "global.sync-event.subscribe",
        responses: {
          200: {
            description: "Event stream",
            content: {
              "text/event-stream": {
                schema: resolver(
                  z
                    .object({
                      payload: SyncEvent.payloads(),
                    })
                    .meta({
                      ref: "SyncEvent",
                    }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        log.info("global sync event connected")
        c.header("Cache-Control", "no-cache, no-transform")
        c.header("X-Accel-Buffering", "no")
        c.header("X-Content-Type-Options", "nosniff")
        return streamEvents(c, (q) => {
          return SyncEvent.subscribeAll(({ def, event }) => {
            // TODO: don't pass def, just pass the type (and it should
            // be versioned)
            q.push(
              JSON.stringify({
                payload: {
                  ...event,
                  type: SyncEvent.versionedType(def.type, def.version),
                },
              }),
            )
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
    )
    .post(
      "/upgrade",
      describeRoute({
        summary: "Upgrade opencode",
        description: "Upgrade opencode to the specified version or latest if not specified.",
        operationId: "global.upgrade",
        responses: {
          200: {
            description: "Upgrade result",
            content: {
              "application/json": {
                schema: resolver(
                  z.union([
                    z.object({
                      success: z.literal(true),
                      version: z.string(),
                    }),
                    z.object({
                      success: z.literal(false),
                      error: z.string(),
                    }),
                  ]),
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
          target: z.string().optional(),
        }),
      ),
      async (c) => {
        const method = await Installation.method()
        if (method === "unknown") {
          return c.json({ success: false, error: "Unknown installation method" }, 400)
        }
        const target = c.req.valid("json").target || (await Installation.latest(method))
        const result = await Installation.upgrade(method, target)
          .then(() => ({ success: true as const, version: target }))
          .catch((e) => ({ success: false as const, error: e instanceof Error ? e.message : String(e) }))
        if (result.success) {
          GlobalBus.emit("event", {
            directory: "global",
            payload: {
              type: Installation.Event.Updated.type,
              properties: { version: target },
            },
          })
          return c.json(result)
        }
        return c.json(result, 500)
      },
    ),
)
