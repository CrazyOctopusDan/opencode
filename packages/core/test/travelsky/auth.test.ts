import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"
import { TestClock } from "effect/testing"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { httpClient } from "@opencode/util/effect/app-node-platform"
import { Credential } from "../../src/credential"
import { TravelSkyAuth } from "../../src/travelsky/auth"
import { TempoApi } from "../../src/travelsky/api"
import { it } from "../lib/effect"

function fixture() {
  const state = {
    token: "first-token",
    models: {
      success: true,
      data: [{ model: "dsv4", provider: "company", apiBase: "https://models.example/v1", apiKey: "model-key" }],
    } as unknown,
    requests: [] as string[],
  }
  const http = HttpClient.make((request) => {
    state.requests.push(request.url)
    return Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        Response.json(
          request.url.endsWith("auth/login") ? { success: true, data: { token: state.token } } : state.models,
        ),
      ),
    )
  })
  return {
    state,
    layer: LayerNode.compile(LayerNode.group([TravelSkyAuth.node, Credential.node]), {
      replacements: [
        TravelSkyAuth.node.replace(
          TravelSkyAuth.configured({
            ...TempoApi.settings({ OPENCODE_TEMPO_BASE_URL: "https://tempo.example" }),
            ttlSeconds: 1,
          }),
        ),
        httpClient.replace(Layer.succeed(HttpClient.HttpClient, http)),
      ],
    }),
  }
}

describe("TravelSky durable authentication", () => {
  it.effect("stores only the token, reuses model access, and expires on the configured clock", () => {
    const input = fixture()
    return Effect.gen(function* () {
      const auth = yield* TravelSkyAuth.Service
      const credentials = yield* Credential.Service
      expect((yield* auth.snapshot()).status.authenticated).toBe(false)
      yield* auth.login({ username: "user", password: "plain-password" })
      const stored = yield* credentials.list(TravelSkyAuth.integrationID)
      expect(stored).toHaveLength(1)
      expect(stored[0].value).toMatchObject({
        type: "key",
        key: "first-token",
        metadata: { username: "user", baseURL: "https://tempo.example" },
      })
      expect(JSON.stringify(stored)).not.toContain("plain-password")
      expect((yield* auth.snapshot()).models[0].models[0].apiKey).toBe("model-key")
      yield* auth.snapshot()
      expect(input.state.requests.filter((url) => url.endsWith("llm/list"))).toHaveLength(1)
      yield* TestClock.adjust("2 seconds")
      expect(yield* auth.snapshot()).toMatchObject({ status: { authenticated: false }, models: [] })
    }).pipe(Effect.provide(input.layer))
  })

  it.effect("keeps last good models on transient failure but removes credentials on explicit expiry", () => {
    const input = fixture()
    return Effect.gen(function* () {
      const auth = yield* TravelSkyAuth.Service
      const credentials = yield* Credential.Service
      yield* auth.login({ username: "user", password: "password" })
      const first = yield* auth.snapshot()
      input.state.models = { success: false, code: 503, message: "temporarily unavailable" }
      expect((yield* auth.snapshot(true)).models).toEqual(first.models)
      input.state.models = { success: false, code: "401", message: "token校验失败，失败原因：过期" }
      expect(yield* auth.snapshot(true)).toMatchObject({ status: { authenticated: false }, models: [] })
      expect(yield* credentials.list(TravelSkyAuth.integrationID)).toEqual([])
      input.state.models = { success: false, code: 503 }
      expect((yield* auth.snapshot(true)).status.authenticated).toBe(false)
    }).pipe(Effect.provide(input.layer))
  })

  it.effect("replaces earlier login credentials and removes all company credentials on logout", () => {
    const input = fixture()
    return Effect.gen(function* () {
      const auth = yield* TravelSkyAuth.Service
      const credentials = yield* Credential.Service
      yield* auth.login({ username: "first", password: "password" })
      input.state.token = "latest-token"
      yield* auth.login({ username: "latest", password: "password" })
      expect(yield* credentials.list(TravelSkyAuth.integrationID)).toEqual([
        expect.objectContaining({
          value: expect.objectContaining({
            key: "latest-token",
            metadata: expect.objectContaining({ username: "latest" }),
          }),
        }),
      ])
      yield* auth.logout()
      expect((yield* auth.snapshot()).status.authenticated).toBe(false)
      expect(yield* credentials.list(TravelSkyAuth.integrationID)).toEqual([])
    }).pipe(Effect.provide(input.layer))
  })
})
