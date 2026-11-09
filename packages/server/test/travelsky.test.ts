import { expect } from "bun:test"
import { OpenCode } from "@opencode/client"
import { Context, Effect, Layer } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { createRoutes } from "../src/routes"
import { settings } from "../src/travelsky"

it.live("company login uses the generated client while retaining native server authentication", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped("travelsky-server-")
    const requests: Request[] = []
    const context = yield* Layer.build(
      createRoutes({
        password: "local-password",
        database: { path: ":memory:" },
        models: { fetch: false },
        fs: { filewatcher: false },
        config: { directory: tmp.path, project: false },
        travelsky: settings({ OPENCODE_TEMPO_BASE_URL: "https://tempo.example" }),
        fetch: Object.assign(
          async (input: string | URL | Request, init?: RequestInit) => {
            const request = new Request(input, init)
            requests.push(request.clone())
            if (request.url === "https://tempo.example/ai/data/api/auth/login")
              return Response.json({ success: true, data: { token: "company-token" } })
            if (request.url === "https://tempo.example/ai/data/api/llm/list")
              return Response.json({
                success: true,
                data: [
                  { model: "Qwen3", provider: "company", apiBase: "https://models.example/v1", apiKey: "model-key" },
                ],
              })
            throw new Error(`Unexpected outgoing request: ${request.url}`)
          },
          { preconnect: fetch.preconnect },
        ),
      }).pipe(Layer.provide(HttpServer.layerServices)),
    )
    const handler = Context.get(context, HttpRouter.HttpRouter)
      .asHttpEffect()
      .pipe(HttpEffect.toWebHandlerWith(context))
    const client = OpenCode.make({
      baseUrl: "http://opencode.local",
      headers: { authorization: `Basic ${btoa("opencode:local-password")}` },
      fetch: Object.assign((input: string | URL | Request, init?: RequestInit) => handler(new Request(input, init)), {
        preconnect: fetch.preconnect,
      }),
    })
    yield* Effect.promise(async () => {
      expect((await handler(new Request("http://opencode.local/api/experimental/travelsky/status"))).status).toBe(401)
      expect(await client.experimental.travelsky.status()).toMatchObject({ enabled: true, authenticated: false })
      const logged = await client.experimental.travelsky.login({ username: "user", password: "plain-password" })
      expect(logged).toMatchObject({ enabled: true, authenticated: true, username: "user" })
      expect(JSON.stringify(logged)).not.toContain("company-token")
      expect(JSON.stringify(logged)).not.toContain("plain-password")
      const outbound = await requests[0].text()
      expect(outbound).toContain('"enPasswd"')
      expect(outbound).not.toContain("plain-password")
      expect(await client.experimental.travelsky.status()).toMatchObject({ authenticated: true })
      expect(requests.at(-1)?.headers.get("cookie")).toBe("crowd.token_key=company-token")
      expect(await client.experimental.travelsky.logout()).toMatchObject({ authenticated: false })
      expect(await client.experimental.travelsky.status()).toMatchObject({ authenticated: false })
    })
  }),
)
