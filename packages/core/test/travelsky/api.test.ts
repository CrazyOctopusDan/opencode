import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { TempoApi } from "../../src/travelsky/api"
import { TempoModels } from "../../src/travelsky/models"

function fixture(payload: unknown, status = 200) {
  const requests: HttpClientRequest.HttpClientRequest[] = []
  const http = HttpClient.make((request) => {
    requests.push(request)
    return Effect.succeed(HttpClientResponse.fromWeb(request, Response.json(payload, { status })))
  })
  return {
    requests,
    api: TempoApi.create(http, TempoApi.settings({ OPENCODE_TEMPO_BASE_URL: "https://tempo.example/ai/data/api/" })),
  }
}

describe("Tempo v2 transport", () => {
  test("normalizes hosts and preserves production, development and disabled modes", () => {
    expect(TempoApi.settings({}).baseURL).toBe("https://tempo.travelsky.com.cn")
    expect(TempoApi.settings({ OPENCODE_TEMPO_ENV: "test" }).baseURL).toBe("https://tempodev.travelsky.com.cn")
    expect(TempoApi.settings({ OPENCODE_TEMPO_ENV: "off" }).enabled).toBe(false)
    expect(TempoApi.settings({ OPENCODE_TEMPO_BASE_URL: "https://company.example/ai/data/api/" })).toMatchObject({
      enabled: true,
      baseURL: "https://company.example",
    })
  })

  test("encrypts the password and keeps the company login contract", async () => {
    const client = fixture({ success: true, data: { token: "company-token" } })
    expect(await Effect.runPromise(client.api.login({ username: "user", password: "plain-password" }))).toBe(
      "company-token",
    )
    const request = client.requests[0]
    expect(request.url).toBe("https://tempo.example/ai/data/api/auth/login")
    expect(request.method).toBe("POST")
    if (request.body._tag !== "Uint8Array") throw new Error("Expected JSON body")
    const text = new TextDecoder().decode(request.body.body)
    const body = JSON.parse(text)
    expect(body.username).toBe("user")
    expect(body.plugin).toBe("OpenCode")
    expect(body.enPasswd).toMatch(/^[a-f\d]+$/i)
    expect(body.enPasswd.length).toBeGreaterThan(190)
    expect(text).not.toContain("plain-password")
    expect(body).not.toHaveProperty("password")
  })

  test("uses company model identifiers and per-model host, key and limits", async () => {
    const client = fixture({
      success: true,
      data: [
        {
          id: 42,
          provider: "company",
          model: "dsv4-flash",
          title: "DeepSeek",
          apiBase: "https://models.example/v1",
          apiKey: "model-key",
          contextLength: 64000,
          completionOptions: { maxTokens: 4096 },
        },
        { id: "db-id", provider: "company", title: "Invalid row", apiBase: "https://models.example/v1" },
      ],
    })
    const providers = await Effect.runPromise(client.api.models("company-token"))
    expect(providers).toHaveLength(1)
    expect(providers[0].models).toEqual([
      {
        id: "dsv4-flash",
        name: "DeepSeek",
        baseURL: "https://models.example/v1",
        apiKey: "model-key",
        contextLength: 64000,
        maxTokens: 4096,
      },
    ])
    expect(client.requests[0].headers.cookie).toBe("crowd.token_key=company-token")
    expect(client.requests[0].url).toBe("https://tempo.example/ai/data/api/llm/list")
  })

  test("retains nested provider inventories and model overrides", () => {
    const models = TempoModels.normalizePolicy(
      {
        data: {
          providers: [
            {
              id: "company",
              baseURL: "https://one.example/v1",
              apiKey: "provider-key",
              models: [{ id: "Qwen3", name: "Qwen", baseURL: "https://two.example/v1", apiKey: "model-key" }],
            },
          ],
        },
      },
      "https://tempo.example",
    )
    expect(models[0]).toMatchObject({
      id: "company",
      apiKey: "provider-key",
      models: [{ id: "Qwen3", baseURL: "https://two.example/v1", apiKey: "model-key" }],
    })
  })

  test("distinguishes expired company sessions from ordinary failures", async () => {
    for (const code of [401, "401"]) {
      const client = fixture({ success: false, code, message: "token校验失败，失败原因：已过期" })
      expect(await Effect.runPromise(client.api.models("expired").pipe(Effect.result))).toMatchObject({
        _tag: "Failure",
        failure: { expired: true },
      })
    }
    expect(TempoApi.expired({ success: false, code: 401, message: "other failure" })).toBe(false)
    expect(TempoApi.expired({ success: true, code: 401, message: "token校验失败，失败原因" })).toBe(false)
    expect(
      await Effect.runPromise(fixture({ message: "unavailable" }, 503).api.models("token").pipe(Effect.result)),
    ).toMatchObject({ _tag: "Failure", failure: { expired: false } })
  })

  test("does not accept successful login responses without a token", async () => {
    const result = await Effect.runPromise(
      fixture({ success: true }).api.login({ username: "user", password: "password" }).pipe(Effect.result),
    )
    expect(result).toMatchObject({ _tag: "Failure", failure: { message: "Tempo login token missing" } })
  })

  test("sends generation and adoption to the same host and returns qaid", async () => {
    const client = fixture({ success: true, data: 123 })
    expect(
      await Effect.runPromise(client.api.generation("cookie-token", { toolVersion: "2.2.5", ideVersion: "" })),
    ).toBe("123")
    await Effect.runPromise(
      client.api.adoption("cookie-token", { qaid: "123", adoptedLines: 3, deletedLines: 1, adoptedContent: "" }),
    )
    expect(client.requests.map((request) => request.url)).toEqual([
      "https://tempo.example/ai/data/api/record/saveGeneration",
      "https://tempo.example/ai/data/api/record/addAdoption",
    ])
    expect(client.requests.every((request) => request.headers.cookie === "crowd.token_key=cookie-token")).toBe(true)
  })
})
