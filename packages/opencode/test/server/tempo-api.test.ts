import { describe, expect, test } from "bun:test"
import { TempoApi } from "../../src/server/tempo-api"
import { Flag } from "@opencode-ai/core/flag/flag"

describe("tempo api login", () => {
  test("normalizes explicit api base before appending tempo paths", async () => {
    const originalFetch = globalThis.fetch
    const previousBase = Flag.OPENCODE_TEMPO_BASE_URL
    Flag.OPENCODE_TEMPO_BASE_URL = "https://tempo.travelsky.com.cn/ai/data/api/"
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      expect(input.toString()).toBe("https://tempo.travelsky.com.cn/ai/data/api/auth/login")
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            token: "tempo-login-token",
          },
        }),
      )
    }) as typeof fetch

    try {
      const result = await TempoApi.login({
        username: "dummy-user",
        password: "dummy-password",
      })
      expect(result.token).toBe("tempo-login-token")
    } finally {
      globalThis.fetch = originalFetch
      Flag.OPENCODE_TEMPO_BASE_URL = previousBase
    }
  })

  test("posts username with encrypted password to company login endpoint", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(input.toString()).toBe("https://tempo.travelsky.com.cn/ai/data/api/auth/login")
      expect(init?.method).toBe("POST")
      expect(new Headers(init?.headers).get("Content-Type")).toBe("application/json")

      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      expect(body.username).toBe("dummy-user")
      expect(body.plugin).toBe("OpenCode")
      expect(typeof body.enPasswd).toBe("string")
      expect(body.enPasswd).not.toBe("dummy-password")
      expect(String(body.enPasswd).length).toBeGreaterThan(20)

      return new Response(
        JSON.stringify({
          success: true,
          data: {
            token: "tempo-login-token",
          },
        }),
      )
    }) as typeof fetch

    try {
      const result = await TempoApi.login({
        username: "dummy-user",
        password: "dummy-password",
      })
      expect(result.token).toBe("tempo-login-token")
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe("tempo api model normalization", () => {
  test("maps row payload into single travelSky provider with model-level baseURL", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe("POST")
      expect(init?.body).toBe(JSON.stringify({ plugin: "open-code" }))
      const header = new Headers(init?.headers).get("Cookie")
      expect(header).toBe("crowd.token_key=test-token")
      return new Response(
        JSON.stringify({
          success: true,
          message: "success",
          code: 0,
          data: [
            {
              id: 1000001,
              title: "Qwen3 Coder 480B A35B",
              provider: "openai",
              apiBase: "https://tempo.travelsky.com.cn/ai_qwen3-coder-480b-a35b/v1",
              model: "qwen3-coder-480b-a35b",
              apiKey: "sk-1",
              contextLength: 32000,
              completionOptions: { maxTokens: 20000 },
            },
            {
              id: 1000002,
              title: "Qwen3 Coder 30B",
              provider: "openai",
              apiBase: "https://tempo.travelsky.com.cn/ai_qwen3-coder-30b/v1",
              model: "qwen3-coder-30b",
              apiKey: "sk-2",
              contextLength: 32000,
              completionOptions: { maxTokens: 20000 },
            },
          ],
        }),
      )
    }) as typeof fetch

    try {
      const result = await TempoApi.listModels({ token: "test-token" })
      expect(result.status).toBe("ok")
      if (result.status !== "ok") throw new Error("expected ok model list")
      expect(result.providers.length).toBe(1)
      expect(result.providers[0]?.id).toBe("travelSky")
      expect(result.providers[0]?.name).toBe("travelSky")
      expect(result.providers[0]?.models.length).toBe(2)

      const ids = new Set(result.providers[0]?.models.map((item) => item.id))
      expect(ids.has("qwen3-coder-480b-a35b")).toBeTrue()
      expect(ids.has("qwen3-coder-30b")).toBeTrue()

      const byId = Object.fromEntries(result.providers[0]?.models.map((item) => [item.id, item]) ?? [])
      expect(byId["qwen3-coder-480b-a35b"].name).toBe("Qwen3 Coder 480B A35B")
      expect(byId["qwen3-coder-480b-a35b"].baseURL).toBe(
        "https://tempo.travelsky.com.cn/ai_qwen3-coder-480b-a35b/v1",
      )
      expect(byId["qwen3-coder-30b"].name).toBe("Qwen3 Coder 30B")
      expect(byId["qwen3-coder-30b"].baseURL).toBe("https://tempo.travelsky.com.cn/ai_qwen3-coder-30b/v1")
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe("tempo api token expiration", () => {
  test("detects company token expiration payload", () => {
    expect(
      TempoApi.expired({
        success: false,
        code: 401,
        message: "token校验失败，失败原因：登录已过期",
      }),
    ).toBeTrue()
    expect(
      TempoApi.expired({
        success: false,
        code: 401,
        message: "invalid token",
      }),
    ).toBeFalse()
    expect(
      TempoApi.expired({
        success: false,
        code: 500,
        message: "token校验失败，失败原因：服务异常",
      }),
    ).toBeFalse()
  })

  test("accepts string 401 code in company token expiration payload", () => {
    expect(
      TempoApi.expired({
        success: false,
        code: "401",
        message: "token校验失败，失败原因：登录已过期",
      }),
    ).toBeTrue()
  })

  test("returns expired status when model list reports token expiration", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          success: false,
          code: 401,
          message: "token校验失败，失败原因：登录已过期",
        }),
      )) as unknown as typeof fetch

    try {
      const result = await TempoApi.listModels({ token: "expired-token" })
      expect(result).toEqual({
        status: "expired",
        message: "token校验失败，失败原因：登录已过期",
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
