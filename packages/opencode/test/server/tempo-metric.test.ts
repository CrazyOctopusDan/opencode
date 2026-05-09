import { afterEach, describe, expect, test } from "bun:test"
import { TempoSession } from "../../src/server/tempo-session"
import { TempoMetric } from "../../src/server/tempo-metric"

const originalFetch = globalThis.fetch

describe("tempo metric", () => {
  afterEach(() => {
    TempoSession.remove("local")
    globalThis.fetch = originalFetch
  })

  test("posts metric to tempo host with cookie", async () => {
    let req: Request | undefined

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      req = new Request(input, init)
      return new Response(JSON.stringify({ success: true }), { status: 200 })
    }) as unknown as typeof fetch

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
  })

  test("skips when no login auth", async () => {
    let hit = false
    globalThis.fetch = (async () => {
      hit = true
      return new Response("ok", { status: 200 })
    }) as unknown as typeof fetch

    const ok = await TempoMetric.send({
      text: "8",
      other: "{}",
      modelName: "qwen-1",
    })
    expect(ok).toBeFalse()
    expect(hit).toBeFalse()
  })

  test("returns false when metric response reports token expiration", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          success: false,
          code: 401,
          message: "token校验失败，失败原因：登录已过期",
        }),
        { status: 200 },
      )) as unknown as typeof fetch

    TempoSession.set("local", { token: "expired-token" })

    const ok = await TempoMetric.send({
      text: "8",
      other: "{}",
      modelName: "qwen-1",
    })

    expect(ok).toBeFalse()
  })

  test("returns false for failed metric payload", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          success: false,
          code: 500,
          message: "metric rejected",
        }),
        { status: 200 },
      )) as unknown as typeof fetch

    TempoSession.set("local", { token: "tempo-token" })

    const ok = await TempoMetric.send({
      text: "8",
      other: "{}",
      modelName: "qwen-1",
    })

    expect(ok).toBeFalse()
  })

  test("returns false for non-ok metric response", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ success: true }), { status: 500 })) as unknown as typeof fetch

    TempoSession.set("local", { token: "tempo-token" })

    const ok = await TempoMetric.send({
      text: "8",
      other: "{}",
      modelName: "qwen-1",
    })

    expect(ok).toBeFalse()
  })
})
