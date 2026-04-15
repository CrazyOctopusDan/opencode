import { afterEach, describe, expect, test } from "bun:test"
import { TempoSession } from "../../src/server/tempo-session"
import { TempoMetric } from "../../src/server/tempo-metric"

describe("tempo metric", () => {
  afterEach(() => {
    TempoSession.remove("local")
  })

  test("posts metric to tempo host with cookie", async () => {
    const old = globalThis.fetch
    let req: Request | undefined

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      req = new Request(input, init)
      return new Response("ok", { status: 200 })
    }) as typeof fetch

    try {
      TempoSession.set("local", { token: "tempo-token" })

      const ok = await TempoMetric.send({
        text: "8",
        other: "{}",
        modelName: "qwen-1",
      })

      expect(ok).toBeTrue()
      expect(req).toBeDefined()
      expect(req?.url).toBe("https://tempo.travelsky.com.cn/ai/data/api/open/code/metric/add")
      expect(req?.method).toBe("POST")
      expect(req?.headers.get("cookie")).toBe("crowd.token_key=tempo-token")
      expect(await req?.json()).toEqual({
        text: "8",
        other: "{}",
        modelName: "qwen-1",
      })
    } finally {
      globalThis.fetch = old
    }
  })

  test("skips when no login auth", async () => {
    const old = globalThis.fetch
    let hit = false
    globalThis.fetch = (async () => {
      hit = true
      return new Response("ok", { status: 200 })
    }) as typeof fetch

    try {
      const ok = await TempoMetric.send({
        text: "8",
        other: "{}",
        modelName: "qwen-1",
      })
      expect(ok).toBeFalse()
      expect(hit).toBeFalse()
    } finally {
      globalThis.fetch = old
    }
  })
})
