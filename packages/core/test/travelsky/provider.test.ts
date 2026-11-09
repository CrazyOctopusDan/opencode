import { describe, expect } from "bun:test"
import { Cause, Effect, Exit, Layer } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"
import { Agent } from "@opencode/schema/agent"
import { Session } from "@opencode/schema/session"
import { Model } from "../../src/model"
import { Provider } from "../../src/provider"
import { Integration } from "../../src/integration"
import { Plugin } from "../../src/plugin"
import { PluginHost } from "../../src/plugin/host"
import { PluginHooks } from "../../src/plugin/hooks"
import { TravelSkyPlugin } from "../../src/plugin/provider/travelsky"
import { TravelSkyAuth } from "../../src/travelsky/auth"
import { TempoApi } from "../../src/travelsky/api"
import { PluginTestLayer } from "../plugin/fixture"
import { testEffect } from "../lib/effect"

const http = HttpClient.make((request) =>
  Effect.succeed(
    HttpClientResponse.fromWeb(
      request,
      Response.json(
        request.url.endsWith("auth/login")
          ? { success: true, data: { token: "login-token" } }
          : {
              success: true,
              data: [
                {
                  id: "database-id",
                  provider: "company",
                  model: "dsv4-flash",
                  title: "DeepSeek",
                  apiBase: "https://models.example/v1",
                  apiKey: "model-key",
                  contextLength: 64000,
                  completionOptions: { maxTokens: 4096 },
                },
              ],
            },
      ),
    ),
  ),
)
const it = testEffect(
  TravelSkyAuth.layer(TempoApi.settings({ OPENCODE_TEMPO_BASE_URL: "https://tempo.example" })).pipe(
    Layer.provide(Layer.succeed(HttpClient.HttpClient, http)),
    Layer.provideMerge(PluginTestLayer),
  ),
)

describe("TravelSky provider on the v2 plugin host", () => {
  it.effect("enforces the company catalog and denies a resolved route after logout", () =>
    Effect.gen(function* () {
      const auth = yield* TravelSkyAuth.Service
      const plugin = yield* Plugin.Service
      const providers = yield* Provider.Service
      const models = yield* Model.Service
      const integrations = yield* Integration.Service
      const hooks = yield* PluginHooks.Service
      yield* auth.login({ username: "user", password: "password" })
      yield* providers.transform((catalog) => {
        catalog.update(Provider.ID.make("other"), (provider) => {
          provider.activation = "enabled"
        })
        catalog.models.update(Provider.ID.make("other"), Model.ID.make("custom"), (model) => {
          model.enabled = true
        })
      })
      const host = yield* PluginHost.make(plugin, "travelsky-test")
      yield* TravelSkyPlugin.effect(host)
      expect((yield* providers.all()).map((provider) => provider.id)).toEqual([Provider.ID.make("travelSky")])
      expect(yield* integrations.list()).toEqual([])
      const listed = yield* models.available()
      expect(listed).toHaveLength(1)
      expect(listed[0]).toMatchObject({
        id: "dsv4-flash",
        modelID: "dsv4-flash",
        providerID: "travelSky",
        family: "deepseek",
        limit: { context: 64000, output: 4096 },
        settings: { baseURL: "https://models.example/v1", apiKey: "model-key" },
      })
      expect(JSON.stringify(listed)).not.toContain("login-token")
      const request = {
        sessionID: Session.ID.make("ses_test"),
        agent: Agent.ID.make("build"),
        model: Model.Ref.make({ providerID: Provider.ID.make("travelSky"), id: Model.ID.make("dsv4-flash") }),
        kind: "primary" as const,
        headers: {},
      }
      expect((yield* hooks.trigger("session", "model.request", request)).baseURL).toBe("https://models.example/v1")
      const sent = yield* hooks.trigger("session", "http.request", {
        ...request,
        request: new Request("https://models.example/v1/chat/completions", {
          headers: { Authorization: "Bearer stale-model-key" },
        }),
      })
      expect(sent.request.headers.get("authorization")).toBe("Bearer model-key")
      yield* auth.logout()
      const result = yield* hooks.trigger("session", "model.request", request).pipe(Effect.exit)
      expect(Exit.isFailure(result)).toBe(true)
      if (Exit.isFailure(result)) expect(Cause.pretty(result.cause)).toContain("TravelSky login required")
      expect(yield* models.available()).toEqual([])
    }),
  )
})
