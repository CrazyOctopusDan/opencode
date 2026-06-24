import { afterEach, describe, expect, test } from "bun:test"
import { Flag } from "@opencode-ai/core/flag/flag"
import { ModelPolicy } from "../../src/provider/model-policy"
import { Provider } from "../../src/provider/provider"
import { ProviderID } from "../../src/provider/schema"
import { TempoSession } from "../../src/server/tempo-session"

const original = {
  fetch: globalThis.fetch,
  base: Flag.OPENCODE_TEMPO_BASE_URL,
  env: Flag.OPENCODE_TEMPO_ENV,
  policy: Flag.OPENCODE_LOCKED_MODEL_POLICY,
}

const envPolicy = [
  {
    id: "env-provider",
    name: "Env Provider",
    baseURL: "https://env.test/v1",
    models: [
      {
        id: "env-model",
        name: "Env Model",
      },
    ],
  },
]

async function reset() {
  TempoSession.remove("model-policy-token")
  TempoSession.remove("empty-policy-token")
  TempoSession.remove("expired-policy-token")
  TempoSession.remove("stale-policy-token")
  Flag.OPENCODE_TEMPO_BASE_URL = original.base
  Flag.OPENCODE_TEMPO_ENV = original.env
  Flag.OPENCODE_LOCKED_MODEL_POLICY = original.policy
  globalThis.fetch = (async () => new Response(JSON.stringify({ success: true, data: [] }))) as unknown as typeof fetch
  await ModelPolicy.snapshot(true)
  globalThis.fetch = original.fetch
}

describe("model policy", () => {
  afterEach(async () => {
    await reset()
  })

  test("normalizes tempo providers into travelSky for cli readiness", async () => {
    Flag.OPENCODE_TEMPO_BASE_URL = "https://tempo.test"
    TempoSession.set("model-policy-token", { token: "upstream-token" })
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("Cookie")).toBe("crowd.token_key=upstream-token")
      return new Response(
        JSON.stringify({
          success: true,
          data: [
            {
              id: "openai",
              name: "OpenAI Compatible",
              api: "https://tempo.test/openai/v1",
              models: [
                {
                  id: "qwen-coder",
                  name: "Qwen Coder",
                  contextLength: 64000,
                  completionOptions: {
                    maxTokens: 12000,
                  },
                },
              ],
            },
          ],
        }),
      )
    }) as typeof fetch

    const policy = await ModelPolicy.snapshot(true, "model-policy-token")
    expect(policy.enabled).toBeTrue()
    expect(policy.locked).toBeTrue()
    expect(policy.allowedProvider("travelSky")).toBeTrue()
    expect(policy.allowedProvider("openai")).toBeFalse()
    expect(policy.allowedModel("travelSky", "qwen-coder")).toBeTrue()
    expect(policy.list).toEqual([
      {
        id: "travelSky",
        name: "travelSky",
        baseURL: "https://tempo.test/openai/v1",
        models: [
          {
            id: "qwen-coder",
            name: "Qwen Coder",
            baseURL: "https://tempo.test/openai/v1",
            contextLength: 64000,
            maxTokens: 12000,
          },
        ],
      },
    ])

    const providers = Provider.fromModelPolicy(policy.list)
    expect(providers[ProviderID.make("travelSky")]?.models["qwen-coder"]?.api.url).toBe(
      "https://tempo.test/openai/v1",
    )
  })

  test("does not lock providers when tempo returns no models", async () => {
    Flag.OPENCODE_TEMPO_BASE_URL = "https://tempo.test"
    TempoSession.set("empty-policy-token", { token: "empty-upstream-token" })
    globalThis.fetch = (async () => new Response(JSON.stringify({ success: true, data: [] }))) as unknown as typeof fetch

    const policy = await ModelPolicy.snapshot(true, "empty-policy-token")
    expect(policy.enabled).toBeFalse()
    expect(policy.locked).toBeFalse()
    expect(policy.list).toEqual([])
  })

  test("preserves tempo auth expiration status", async () => {
    Flag.OPENCODE_TEMPO_BASE_URL = "https://tempo.test"
    TempoSession.set("expired-policy-token", { token: "expired-upstream-token" })
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          success: false,
          code: 401,
          message: "token校验失败，失败原因：登录已过期",
        }),
      )) as unknown as typeof fetch

    const policy = await ModelPolicy.snapshot(true, "expired-policy-token")
    expect(policy.enabled).toBeFalse()
    expect(policy.locked).toBeTrue()
    expect(policy.expired).toBeTrue()
    expect(policy.expiredMessage).toBe("token校验失败，失败原因：登录已过期")
    expect(policy.list).toEqual([])
  })

  test("marks persisted local tokens with missing Tempo auth as recoverable expiration", async () => {
    Flag.OPENCODE_TEMPO_BASE_URL = "https://tempo.test"

    const policy = await ModelPolicy.snapshot(true, "stale-policy-token")
    expect(policy.enabled).toBeFalse()
    expect(policy.locked).toBeTrue()
    expect(policy.expired).toBeTrue()
    expect(policy.expiredMessage).toContain("Tempo auth missing")
    expect(policy.list).toEqual([])
  })

  test("does not cache forced tempo auth expiration over existing policy", async () => {
    Flag.OPENCODE_LOCKED_MODEL_POLICY = JSON.stringify(envPolicy)

    const cached = await ModelPolicy.snapshot(true, "missing-policy-token")
    expect(cached.enabled).toBeTrue()
    expect(cached.expired).toBeFalse()
    expect(cached.allowedModel("travelSky", "env-model")).toBeTrue()

    Flag.OPENCODE_TEMPO_BASE_URL = "https://tempo.test"
    TempoSession.set("expired-policy-token", { token: "expired-upstream-token" })
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          success: false,
          code: 401,
          message: "token校验失败，失败原因：登录已过期",
        }),
      )) as unknown as typeof fetch

    const expired = await ModelPolicy.snapshot(true, "expired-policy-token")
    expect(expired.expired).toBeTrue()

    const policy = await ModelPolicy.snapshot(false, "missing-policy-token")
    expect(policy.enabled).toBeTrue()
    expect(policy.expired).toBeFalse()
    expect(policy.allowedModel("travelSky", "env-model")).toBeTrue()
  })
})
