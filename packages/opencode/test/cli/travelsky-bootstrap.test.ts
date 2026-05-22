import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import * as Login from "../../src/cli/travelsky/login"
import { ensureLogin } from "../../src/cli/travelsky/bootstrap"
import { clear, write } from "../../src/cli/travelsky/auth-store"

describe("travelsky bootstrap", () => {
  beforeEach(async () => {
    await clear()
  })

  afterEach(async () => {
    await clear()
    mock.restore()
  })

  test("reuses stored token when provider endpoint is valid", async () => {
    await write({
      access_token: "stored-token",
      expires_in: 3600,
      username: "one",
    })

    const fetch = async () =>
      new Response(
        JSON.stringify({
          all: [{ id: "travelSky", name: "travelSky" }],
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      )

    const auth = await ensureLogin({
      base: "http://local",
      fetch: fetch as unknown as typeof globalThis.fetch,
    })
    expect(auth).toBe("Bearer stored-token")
  })

  test("logs in when token missing", async () => {
    spyOn(Login, "prompt").mockResolvedValue({
      access_token: "new-token",
      token_type: "Bearer",
      expires_in: 3600,
      username: "two",
    })

    const fetch = async () =>
      new Response(
        JSON.stringify({
          all: [{ id: "travelsky", name: "travelSky" }],
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      )

    const auth = await ensureLogin({
      base: "http://local",
      fetch: fetch as unknown as typeof globalThis.fetch,
    })
    expect(auth).toBe("Bearer new-token")
  })

  test("logs in again when the stored token is rejected by the local server", async () => {
    await write({
      access_token: "stored-token",
      expires_in: 3600,
      username: "old",
    })
    spyOn(Login, "prompt").mockResolvedValue({
      access_token: "new-token",
      token_type: "Bearer",
      expires_in: 3600,
      username: "new",
    })

    const headers: string[] = []
    const fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      const authorization = new Headers(init?.headers).get("Authorization") ?? ""
      headers.push(authorization)
      if (authorization === "Bearer stored-token") return new Response("", { status: 401 })
      return new Response(JSON.stringify({ all: [{ id: "travelsky", name: "travelSky" }] }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      })
    }

    const auth = await ensureLogin({
      base: "http://local",
      fetch: fetch as unknown as typeof globalThis.fetch,
    })

    expect(auth).toBe("Bearer new-token")
    expect(headers).toEqual(["Bearer stored-token", "Bearer stored-token", "Bearer new-token"])
  })

  test("accepts travelSky from config providers fallback", async () => {
    await write({
      access_token: "stored-token",
      expires_in: 3600,
      username: "three",
    })

    const paths: string[] = []
    const fetch = async (input: RequestInfo | URL) => {
      const url = new URL(input.toString())
      paths.push(url.pathname)
      if (url.pathname === "/provider") {
        return new Response(JSON.stringify({ all: [] }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        })
      }
      return new Response(JSON.stringify({ providers: [{ id: "travelSky", name: "travelSky" }] }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      })
    }

    const auth = await ensureLogin({
      base: "http://local",
      fetch: fetch as unknown as typeof globalThis.fetch,
    })
    expect(auth).toBe("Bearer stored-token")
    expect(paths).toEqual(["/provider", "/config/providers"])
  })
})
