import { describe, expect, test } from "bun:test"
import { TempoApi } from "../../src/server/tempo-api"

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
      expect(result).toBeDefined()
      expect(result?.length).toBe(1)
      expect(result?.[0]?.id).toBe("travelSky")
      expect(result?.[0]?.name).toBe("travelSky")
      expect(result?.[0]?.models.length).toBe(2)

      const ids = new Set(result?.[0]?.models.map((item) => item.id))
      expect(ids.has("qwen3-coder-480b-a35b")).toBeTrue()
      expect(ids.has("qwen3-coder-30b")).toBeTrue()

      const byId = Object.fromEntries(result?.[0]?.models.map((item) => [item.id, item]) ?? [])
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
