import { describe, expect, test } from "bun:test"
import { authFromToken, authTokenFromCredentials, createAuthRecoveringFetch } from "./server"

describe("authFromToken", () => {
  test("decodes basic auth credentials from auth_token", () => {
    expect(authFromToken(btoa("kit:secret"))).toEqual({ username: "kit", password: "secret" })
  })

  test("defaults blank username to opencode", () => {
    expect(authFromToken(btoa(":secret"))).toEqual({ username: "opencode", password: "secret" })
  })

  test("ignores malformed tokens", () => {
    expect(authFromToken("not base64")).toBeUndefined()
    expect(authFromToken(btoa("missing-separator"))).toBeUndefined()
  })
})

describe("authTokenFromCredentials", () => {
  test("encodes credentials with the default username", () => {
    expect(authTokenFromCredentials({ password: "secret" })).toBe(btoa("opencode:secret"))
  })
})

describe("createAuthRecoveringFetch", () => {
  test("recovers auth and retries once after local token is rejected", async () => {
    const calls: Array<{ url: string; authorization: string | null }> = []
    let token = "old-token"

    const fetcher = createAuthRecoveringFetch({
      token: () => token,
      recover: async () => {
        token = "new-token"
        return true
      },
      fetch: async (input, init) => {
        const request = new Request(input, init)
        calls.push({
          url: request.url,
          authorization: request.headers.get("Authorization"),
        })
        return new Response("", { status: calls.length === 1 ? 401 : 200 })
      },
    })

    const response = await fetcher("http://127.0.0.1:1234/session/abc/prompt_async", {
      method: "POST",
      headers: {
        Authorization: "Bearer old-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: "hello" }),
    })

    expect(response.status).toBe(200)
    expect(calls).toEqual([
      {
        url: "http://127.0.0.1:1234/session/abc/prompt_async",
        authorization: "Bearer old-token",
      },
      {
        url: "http://127.0.0.1:1234/session/abc/prompt_async",
        authorization: "Bearer new-token",
      },
    ])
  })

  test("does not retry when credential recovery fails", async () => {
    const calls: string[] = []
    const fetcher = createAuthRecoveringFetch({
      token: () => "old-token",
      recover: async () => false,
      fetch: async (input, init) => {
        const request = new Request(input, init)
        calls.push(request.headers.get("Authorization") ?? "")
        return new Response("", { status: 401 })
      },
    })

    const response = await fetcher("http://127.0.0.1:1234/session/abc/prompt_async", {
      headers: {
        Authorization: "Bearer old-token",
      },
    })

    expect(response.status).toBe(401)
    expect(calls).toEqual(["Bearer old-token"])
  })

  test("uses the current token before sending the first request", async () => {
    let token = "new-token"
    const calls: string[] = []
    const fetcher = createAuthRecoveringFetch({
      token: () => token,
      recover: async () => false,
      fetch: async (input, init) => {
        const request = new Request(input, init)
        calls.push(request.headers.get("Authorization") ?? "")
        return new Response("", { status: 200 })
      },
    })

    await fetcher("http://127.0.0.1:1234/session/abc/prompt_async", {
      headers: {
        Authorization: "Bearer stale-token",
      },
    })

    expect(calls).toEqual(["Bearer new-token"])
  })
})
