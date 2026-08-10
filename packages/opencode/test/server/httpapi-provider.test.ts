import { afterEach, describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Effect, Layer } from "effect"
import path from "path"
import { resetDatabase } from "../fixture/db"
import { TestInstance } from "../fixture/fixture"
import { markPluginDependenciesReady } from "../fixture/plugin"
import { testEffect } from "../lib/effect"
import { httpApiLayer, request } from "./httpapi-layer"
import { Flag } from "@opencode-ai/core/flag/flag"
import { TempoSession } from "@/server/tempo-session"
import { ModelPolicy } from "@/provider/model-policy"
import { TempoMetric } from "@/server/tempo-metric"

const original = {
  fetch: globalThis.fetch,
  tempoBase: Flag.OPENCODE_TEMPO_BASE_URL,
}

afterEach(async () => {
  globalThis.fetch = original.fetch
  Flag.OPENCODE_TEMPO_BASE_URL = original.tempoBase
  TempoSession.remove("desktop-token")
  TempoSession.remove("stale-desktop-token")
  await ModelPolicy.snapshot(true)
})

const testStateLayer = Layer.effectDiscard(
  Effect.acquireRelease(
    Effect.promise(() => resetDatabase()),
    () => Effect.promise(() => resetDatabase()),
  ),
)

const it = testEffect(Layer.mergeAll(testStateLayer, LayerNode.compile(FSUtil.node), httpApiLayer))
const projectOptions = { config: { formatter: false, lsp: false } }
const providerID = "test-oauth-parity"
const oauthURL = "https://example.com/oauth"
const oauthInstructions = "Finish OAuth"

function providerListHasFetch(list: unknown) {
  if (!Array.isArray(list)) return false
  return list.some((item: unknown) => {
    if (typeof item !== "object" || item === null || !("id" in item) || !("options" in item)) return false
    if (item.id !== "google") return false
    if (typeof item.options !== "object" || item.options === null) return false
    return "fetch" in item.options
  })
}

function hasProviderWithFetch(input: unknown, key: "all" | "providers") {
  if (typeof input !== "object" || input === null) return false
  if (key === "all") return "all" in input && providerListHasFetch(input.all)
  return "providers" in input && providerListHasFetch(input.providers)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function providerList(input: unknown, key: "all" | "providers") {
  if (!isRecord(input)) return []
  if (!Array.isArray(input[key])) return []
  return input[key]
}

function providerByID(input: unknown, key: "all" | "providers", id: string) {
  return providerList(input, key).find((provider) => isRecord(provider) && provider.id === id)
}

function hasNonZeroModelCost(input: unknown, key: "all" | "providers", id: string) {
  const provider = providerByID(input, key, id)
  if (!isRecord(provider) || !isRecord(provider.models)) return false
  return Object.values(provider.models).some((model) => {
    if (!isRecord(model) || !isRecord(model.cost) || !isRecord(model.cost.cache)) return false
    return [model.cost.input, model.cost.output, model.cost.cache.read, model.cost.cache.write].some(
      (cost) => typeof cost === "number" && cost > 0,
    )
  })
}

function hasProviderMutationMarker(input: unknown, key: "all" | "providers", id: string) {
  const provider = providerByID(input, key, id)
  if (!isRecord(provider)) return false
  if (provider.name === "mutated-provider") return true
  return isRecord(provider.options) && provider.options.mutatedByPlugin === true
}

function requestAuthorize(input: {
  providerID: string
  method: number
  headers: HeadersInit
  inputs?: Record<string, string>
}) {
  return Effect.gen(function* () {
    const response = yield* request(`/provider/${input.providerID}/oauth/authorize`, {
      method: "POST",
      headers: input.headers,
      body: JSON.stringify({ method: input.method, ...(input.inputs ? { inputs: input.inputs } : {}) }),
    })
    return {
      status: response.status,
      body: yield* response.text,
    }
  })
}

function requestCallback(input: { providerID: string; method: number; headers: HeadersInit; code?: string }) {
  return Effect.gen(function* () {
    const response = yield* request(`/provider/${input.providerID}/oauth/callback`, {
      method: "POST",
      headers: input.headers,
      body: JSON.stringify({ method: input.method, ...(input.code ? { code: input.code } : {}) }),
    })
    return {
      status: response.status,
      body: yield* response.text,
    }
  })
}

function writeProviderAuthPlugin(dir: string) {
  return Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    yield* Effect.promise(() => markPluginDependenciesReady(path.join(dir, ".opencode")))

    yield* fs.writeWithDirs(
      path.join(dir, ".opencode", "plugin", "provider-oauth-parity.ts"),
      [
        "export default {",
        '  id: "test.provider-oauth-parity",',
        "  server: async () => ({",
        "    auth: {",
        `      provider: "${providerID}",`,
        "      methods: [",
        '        { type: "api", label: "API key" },',
        "        {",
        '          type: "oauth",',
        '          label: "OAuth",',
        "          authorize: async () => ({",
        `            url: "${oauthURL}",`,
        '            method: "code",',
        `            instructions: "${oauthInstructions}",`,
        "            callback: async () => ({ type: 'success', key: 'token' }),",
        "          }),",
        "        },",
        "      ],",
        "    },",
        "  }),",
        "}",
        "",
      ].join("\n"),
    )
  })
}

function writeProviderAuthValidationPlugin(dir: string) {
  return Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    yield* Effect.promise(() => markPluginDependenciesReady(path.join(dir, ".opencode")))

    yield* fs.writeWithDirs(
      path.join(dir, ".opencode", "plugin", "provider-oauth-validation.ts"),
      [
        "export default {",
        '  id: "test.provider-oauth-validation",',
        "  server: async () => ({",
        "    auth: {",
        '      provider: "test-oauth-validation",',
        "      methods: [",
        "        {",
        '          type: "oauth",',
        '          label: "OAuth",',
        "          prompts: [",
        "            {",
        '              type: "text",',
        '              key: "token",',
        '              message: "Token",',
        "              validate: (value) => value === 'ok' ? undefined : 'Token must be ok',",
        "            },",
        "          ],",
        "          authorize: async () => ({",
        `            url: "${oauthURL}",`,
        '            method: "code",',
        `            instructions: "${oauthInstructions}",`,
        "            callback: async () => ({ type: 'success', key: 'token' }),",
        "          }),",
        "        },",
        "      ],",
        "    },",
        "  }),",
        "}",
        "",
      ].join("\n"),
    )
  })
}

function writeFunctionOptionsPlugin(dir: string) {
  return Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    yield* Effect.promise(() => markPluginDependenciesReady(path.join(dir, ".opencode")))

    yield* fs.writeWithDirs(
      path.join(dir, ".opencode", "plugin", "provider-function-options.ts"),
      [
        "export default {",
        '  id: "test.provider-function-options",',
        "  server: async () => ({",
        "    auth: {",
        '      provider: "google",',
        "      loader: async (_getAuth, provider) => {",
        "        for (const model of Object.values(provider.models ?? {})) {",
        "          model.cost = { input: 0, output: 0 }",
        "        }",
        "        return {",
        '        apiKey: "",',
        "        fetch: async (input, init) => fetch(input, init),",
        "        }",
        "      },",
        "      methods: [{ type: 'api', label: 'API key' }],",
        "    },",
        "  }),",
        "}",
        "",
      ].join("\n"),
    )
  })
}

function writeProviderModelsMutationPlugin(dir: string) {
  return Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    yield* Effect.promise(() => markPluginDependenciesReady(path.join(dir, ".opencode")))

    yield* fs.writeWithDirs(
      path.join(dir, ".opencode", "plugin", "provider-models-mutation.ts"),
      [
        "export default {",
        '  id: "test.provider-models-mutation",',
        "  server: async () => ({",
        "    provider: {",
        '      id: "google",',
        "      models: async (provider) => {",
        "        const models = Object.fromEntries(",
        "          Object.entries(provider.models ?? {}).map(([id, model]) => [id, { ...model }]),",
        "        )",
        '        provider.name = "mutated-provider"',
        "        provider.options = { ...provider.options, mutatedByPlugin: true }",
        "        for (const model of Object.values(provider.models ?? {})) {",
        "          model.cost = { input: 0, output: 0 }",
        "        }",
        "        return models",
        "      },",
        "    },",
        "  }),",
        "}",
        "",
      ].join("\n"),
    )
  })
}

function setEnvScoped(key: string, value: string) {
  return Effect.acquireRelease(
    Effect.sync(() => {
      const previous = process.env[key]
      process.env[key] = value
      return previous
    }),
    (previous) =>
      Effect.sync(() => {
        if (previous === undefined) delete process.env[key]
        else process.env[key] = previous
      }),
  )
}

describe("provider HttpApi", () => {
  it.instance.skip(
    "returns public v2 provider not found errors",
    Effect.gen(function* () {
      const directory = (yield* TestInstance).directory
      const response = yield* request("/api/provider/missing", {
        headers: { "x-opencode-directory": directory },
      })

      expect(response.status).toBe(404)
      expect(yield* response.json).toEqual({
        _tag: "ProviderNotFoundError",
        providerID: "missing",
        message: "Provider not found: missing",
      })
    }),
    projectOptions,
  )

  it.instance(
    "serves OAuth authorize response shapes",
    Effect.gen(function* () {
      const directory = (yield* TestInstance).directory
      const headers = { "x-opencode-directory": directory, "content-type": "application/json" }
      const api = yield* requestAuthorize({
        providerID,
        method: 0,
        headers,
      })
      // method 0 (api-key style) — authorize() resolves with no further
      // redirect; #26474 changed the wire format to JSON `null` so clients
      // can `.json()` parse uniformly instead of getting an empty body
      // that throws.
      expect(api).toEqual({ status: 200, body: "null" })

      const oauth = yield* requestAuthorize({
        providerID,
        method: 1,
        headers,
      })
      expect(JSON.parse(oauth.body)).toEqual({
        url: oauthURL,
        method: "code",
        instructions: oauthInstructions,
      })
    }),
    { ...projectOptions, init: writeProviderAuthPlugin },
    30000,
  )

  it.instance(
    "returns declared provider auth validation errors",
    Effect.gen(function* () {
      const directory = (yield* TestInstance).directory
      const response = yield* requestAuthorize({
        providerID: "test-oauth-validation",
        method: 0,
        inputs: { token: "nope" },
        headers: { "x-opencode-directory": directory, "content-type": "application/json" },
      })

      expect(response.status).toBe(400)
      expect(JSON.parse(response.body)).toEqual({
        name: "ProviderAuthValidationFailed",
        data: { field: "token", message: "Token must be ok" },
      })
    }),
    { ...projectOptions, init: writeProviderAuthValidationPlugin },
    30000,
  )

  it.instance(
    "returns declared provider auth callback errors",
    Effect.gen(function* () {
      const directory = (yield* TestInstance).directory
      const response = yield* requestCallback({
        providerID,
        method: 0,
        headers: { "x-opencode-directory": directory, "content-type": "application/json" },
      })

      expect(response.status).toBe(400)
      expect(JSON.parse(response.body)).toEqual({
        name: "ProviderAuthOauthMissing",
        data: { providerID },
      })
    }),
    projectOptions,
    30000,
  )

  it.instance(
    "serves provider lists when auth loaders add runtime fetch options",
    Effect.gen(function* () {
      const directory = (yield* TestInstance).directory
      yield* setEnvScoped(
        "OPENCODE_AUTH_CONTENT",
        JSON.stringify({
          google: { type: "oauth", refresh: "dummy", access: "dummy", expires: 9999999999999 },
        }),
      )
      const headers = { "x-opencode-directory": directory }
      const providerResponse = yield* request("/provider", { headers })
      const configResponse = yield* request("/config/providers", { headers })

      expect(providerResponse.status).toBe(200)
      expect(configResponse.status).toBe(200)

      const providerBody = yield* providerResponse.json
      const configBody = yield* configResponse.json
      expect(hasProviderWithFetch(providerBody, "all")).toBe(false)
      expect(hasProviderWithFetch(configBody, "providers")).toBe(false)
      expect(hasNonZeroModelCost(providerBody, "all", "google")).toBe(true)
      expect(hasNonZeroModelCost(configBody, "providers", "google")).toBe(true)
    }),
    { ...projectOptions, init: writeFunctionOptionsPlugin },
  )

  it.instance(
    "keeps provider.models hook input mutations out of provider state",
    Effect.gen(function* () {
      const directory = (yield* TestInstance).directory

      const headers = { "x-opencode-directory": directory }
      const providerResponse = yield* request("/provider", { headers })
      const configResponse = yield* request("/config/providers", { headers })

      expect(providerResponse.status).toBe(200)
      expect(configResponse.status).toBe(200)

      const providerBody = yield* providerResponse.json
      const configBody = yield* configResponse.json
      expect(hasProviderMutationMarker(providerBody, "all", "google")).toBe(false)
      expect(hasProviderMutationMarker(configBody, "providers", "google")).toBe(false)
      expect(hasNonZeroModelCost(providerBody, "all", "google")).toBe(true)
    }),
    { ...projectOptions, init: writeProviderModelsMutationPlugin },
  )

  it.instance(
    "includes TravelSky in connected providers when Tempo returns models",
    Effect.gen(function* () {
      yield* Effect.promise(() => ModelPolicy.snapshot(true, "missing-desktop-token"))
      Flag.OPENCODE_TEMPO_BASE_URL = "https://tempo.test"
      TempoSession.set("desktop-token", { token: "upstream-token" })
      globalThis.fetch = (async () =>
        new Response(
          JSON.stringify({
            success: true,
            data: [
              {
                id: "openai",
                name: "OpenAI Compatible",
                api: "https://tempo.test/openai/v1",
                models: [{ id: "Qwen3.5-27B", name: "Qwen3.5-27B" }],
              },
            ],
          }),
        )) as unknown as typeof fetch

      const directory = (yield* TestInstance).directory
      const response = yield* request("/provider", {
        headers: {
          "x-opencode-directory": directory,
          Authorization: "Bearer desktop-token",
        },
      })
      const body = yield* response.json

      expect(response.status).toBe(200)
      expect(providerByID(body, "all", "travelSky")).toBeDefined()
      expect(isRecord(body) && Array.isArray(body.connected) ? body.connected : []).toContain("travelSky")
    }),
    projectOptions,
  )

  it.instance(
    "reports recoverable Tempo auth when local desktop token has no server session",
    Effect.gen(function* () {
      Flag.OPENCODE_TEMPO_BASE_URL = "https://tempo.test"

      const directory = (yield* TestInstance).directory
      const response = yield* request("/provider", {
        headers: {
          "x-opencode-directory": directory,
          Authorization: "Bearer stale-desktop-token",
        },
      })
      const body = yield* response.json

      expect(response.status).toBe(200)
      expect(isRecord(body) && Array.isArray(body.connected) ? body.connected : []).toEqual([])
      expect(isRecord(body) && isRecord(body.debug_tempo) ? body.debug_tempo.auth_expired : undefined).toBe(true)
      expect(isRecord(body) && isRecord(body.debug_tempo) ? body.debug_tempo.message : undefined).toContain(
        "Tempo auth missing",
      )
    }),
    projectOptions,
  )

  it.instance(
    "includes latest Tempo metric debug summary in provider list",
    Effect.gen(function* () {
      yield* Effect.promise(() =>
        TempoMetric.sendGeneration({
          modelName: "qwen-1",
          promptName: "build",
          generatedLines: 8,
          adoptedLines: 8,
          sessionId: "ses_1",
          codeLanguage: "TS",
          toolName: "opencode-cli",
          toolVersion: "local",
          ideName: "OpenCode",
          ideVersion: "local",
          projectName: "opencode",
          requestContent: "write code",
          responseContent: "done",
        }),
      )

      const directory = (yield* TestInstance).directory
      const response = yield* request("/provider", {
        headers: {
          "x-opencode-directory": directory,
        },
      })
      const body = yield* response.json

      expect(response.status).toBe(200)
      expect(isRecord(body) && isRecord(body.debug_tempo) ? body.debug_tempo.message : undefined).toContain(
        "saveGeneration skipped",
      )
    }),
    projectOptions,
  )
})
