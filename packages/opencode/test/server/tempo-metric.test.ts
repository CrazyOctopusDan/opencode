import { afterEach, describe, expect, test } from "bun:test"
import { TempoSession } from "../../src/server/tempo-session"
import { TempoMetric } from "../../src/server/tempo-metric"

const originalFetch = globalThis.fetch

function generationInput(): TempoMetric.GenerationInput {
  return {
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
  }
}

describe("tempo metric", () => {
  afterEach(() => {
    TempoSession.remove("local")
    globalThis.fetch = originalFetch
  })

  test("posts generation record to tempo host with cookie and returns qaid", async () => {
    let req: Request | undefined

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      req = new Request(input, init)
      return new Response(JSON.stringify({ success: true, data: "qa-123" }), { status: 200 })
    }) as unknown as typeof fetch

    TempoSession.set("local", { token: "tempo-token" })

    const qaid = await TempoMetric.sendGeneration({
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
    })

    expect(qaid).toBe("qa-123")
    expect(req).toBeDefined()
    expect(req?.url).toBe("https://tempo.travelsky.com.cn/ai/data/api/record/saveGeneration")
    expect(req?.method).toBe("POST")
    expect(req?.headers.get("cookie")).toBe("crowd.token_key=tempo-token")
    expect(await req?.json()).toEqual({
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
    })
  })

  test("posts adoption record with generation qaid", async () => {
    let req: Request | undefined

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      req = new Request(input, init)
      return new Response(JSON.stringify({ success: true }), { status: 200 })
    }) as unknown as typeof fetch

    TempoSession.set("local", { token: "tempo-token" })

    const ok = await TempoMetric.sendAdoption({
      qaid: "qa-123",
      adoptedLines: 5,
      adoptedContent: "",
      deletedLines: 1,
    })

    expect(ok).toBeTrue()
    expect(req).toBeDefined()
    expect(req?.url).toBe("https://tempo.travelsky.com.cn/ai/data/api/record/addAdoption")
    expect(req?.method).toBe("POST")
    expect(req?.headers.get("cookie")).toBe("crowd.token_key=tempo-token")
    expect(await req?.json()).toEqual({
      qaid: "qa-123",
      adoptedLines: 5,
      adoptedContent: "",
      deletedLines: 1,
    })
  })

  test("skips when no login auth", async () => {
    let hit = false
    globalThis.fetch = (async () => {
      hit = true
      return new Response("ok", { status: 200 })
    }) as unknown as typeof fetch

    const qaid = await TempoMetric.sendGeneration({
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
    })
    expect(qaid).toBeUndefined()
    expect(hit).toBeFalse()
  })

  test("records trace when generation skips before fetch", async () => {
    let hit = false
    globalThis.fetch = (async () => {
      hit = true
      return new Response("ok", { status: 200 })
    }) as unknown as typeof fetch

    const qaid = await TempoMetric.sendGeneration(generationInput())
    const trace = TempoMetric.trace()

    expect(qaid).toBeUndefined()
    expect(hit).toBeFalse()
    expect(trace?.endpoint).toBe("saveGeneration")
    expect(trace?.status).toBe("skipped")
    expect(trace?.reason).toBe("no-auth")
    expect(trace?.sent).toBe(false)
  })

  test("records rejected generation response details for debugging", async () => {
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

    const qaid = await TempoMetric.sendGeneration(generationInput())
    const trace = TempoMetric.trace()

    expect(qaid).toBeUndefined()
    expect(trace?.endpoint).toBe("saveGeneration")
    expect(trace?.status).toBe("rejected")
    expect(trace?.sent).toBe(true)
    expect(trace?.http?.status).toBe(200)
    expect(trace?.parsed?.success).toBe(false)
    expect(trace?.parsed?.code).toBe(401)
    expect(trace?.parsed?.message).toBe("token校验失败，失败原因：登录已过期")
    expect(TempoMetric.summary()).toContain("saveGeneration rejected http=200 success=false code=401")
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

    const qaid = await TempoMetric.sendGeneration({
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
    })

    expect(qaid).toBeUndefined()
  })

  test("returns undefined for failed generation payload", async () => {
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

    const qaid = await TempoMetric.sendGeneration({
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
    })

    expect(qaid).toBeUndefined()
  })

  test("returns undefined for non-ok generation response", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ success: true }), { status: 500 })) as unknown as typeof fetch

    TempoSession.set("local", { token: "tempo-token" })

    const qaid = await TempoMetric.sendGeneration({
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
    })

    expect(qaid).toBeUndefined()
  })
})
