import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import * as prompts from "@clack/prompts"
import { prompt, request } from "../../src/cli/travelsky/login"

const stdinTTY = Object.getOwnPropertyDescriptor(process.stdin, "isTTY")
const stdoutTTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY")

function tty(value: boolean) {
  Object.defineProperty(process.stdin, "isTTY", {
    configurable: true,
    value,
  })
  Object.defineProperty(process.stdout, "isTTY", {
    configurable: true,
    value,
  })
}

function restoreTTY() {
  if (stdinTTY) Object.defineProperty(process.stdin, "isTTY", stdinTTY)
  else delete (process.stdin as { isTTY?: boolean }).isTTY
  if (stdoutTTY) Object.defineProperty(process.stdout, "isTTY", stdoutTTY)
  else delete (process.stdout as { isTTY?: boolean }).isTTY
}

describe("travelsky login request", () => {
  afterEach(() => {
    restoreTTY()
    mock.restore()
  })

  test("accepts login response from global login", async () => {
    const fetch = async () =>
      new Response(
        JSON.stringify({
          access_token: "abc",
          token_type: "Bearer",
          expires_in: 3600,
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      )

    const item = await request({
      base: "http://local",
      user: "u",
      pass: "p",
      fetch: fetch as unknown as typeof globalThis.fetch,
    })
    expect(item.access_token).toBe("abc")
    expect(item.token_type).toBe("Bearer")
    expect(item.expires_in).toBe(3600)
  })

  test("returns server message on failed login", async () => {
    const fetch = async () =>
      new Response(
        JSON.stringify({
          message: "invalid account",
        }),
        {
          status: 401,
          headers: {
            "Content-Type": "application/json",
          },
        },
      )

    await expect(
      request({
        base: "http://local",
        user: "u",
        pass: "p",
        fetch: fetch as unknown as typeof globalThis.fetch,
      }),
    ).rejects.toThrow("invalid account")
  })

  test("prompt retries and returns token after second attempt", async () => {
    tty(true)
    const text = spyOn(prompts, "text")
    text.mockResolvedValue("user")
    const pass = spyOn(prompts, "password")
    pass.mockResolvedValueOnce("bad")
    pass.mockResolvedValueOnce("good")
    const select = spyOn(prompts, "select")
    select.mockResolvedValue("retry")
    spyOn(prompts.log, "error").mockImplementation(() => {})
    spyOn(prompts.log, "success").mockImplementation(() => {})

    let count = 0
    const fetch = async () => {
      count++
      if (count === 1) {
        return new Response(JSON.stringify({ message: "invalid account" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        })
      }
      return new Response(
        JSON.stringify({
          access_token: "ok",
          token_type: "Bearer",
          expires_in: 60,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      )
    }

    const item = await prompt({
      base: "http://local",
      fetch: fetch as unknown as typeof globalThis.fetch,
    })
    expect(item?.access_token).toBe("ok")
    expect(item?.username).toBe("user")
    expect(select).toHaveBeenCalledTimes(1)
  })

  test("prompt returns undefined when user exits after failure", async () => {
    tty(true)
    spyOn(prompts, "text").mockResolvedValue("user")
    spyOn(prompts, "password").mockResolvedValue("bad")
    const select = spyOn(prompts, "select")
    select.mockResolvedValue("exit")
    spyOn(prompts.log, "error").mockImplementation(() => {})

    const fetch = async () =>
      new Response(JSON.stringify({ message: "invalid account" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      })

    const item = await prompt({
      base: "http://local",
      fetch: fetch as unknown as typeof globalThis.fetch,
    })
    expect(item).toBeUndefined()
    expect(select).toHaveBeenCalledTimes(1)
  })

  test("prompt fails in non-interactive terminal", async () => {
    tty(false)
    await expect(prompt({ base: "http://local" })).rejects.toThrow("TravelSky login requires an interactive terminal")
  })
})
