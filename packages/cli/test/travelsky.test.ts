import { describe, expect, test } from "bun:test"
import { OpenCode } from "@opencode/client"
import { Effect } from "effect"
import { ensureTravelSkyLogin } from "../src/travelsky"

describe("TravelSky CLI admission", () => {
  test.each([
    { enabled: true, authenticated: true, expected: true },
    { enabled: false, authenticated: false, expected: false },
  ])(
    "reuses authenticated=$authenticated, enabled=$enabled without prompting",
    async ({ enabled, authenticated, expected }) => {
      const requests: Request[] = []
      const client = OpenCode.make({
        baseUrl: "http://opencode.local",
        headers: { authorization: "Basic local-server-credential" },
        fetch: Object.assign(
          async (input: string | URL | Request, init?: RequestInit) => {
            requests.push(new Request(input, init))
            return Response.json({ data: { enabled, authenticated } })
          },
          { preconnect: fetch.preconnect },
        ),
      })
      expect(await Effect.runPromise(ensureTravelSkyLogin(client))).toBe(expected)
      expect(requests).toHaveLength(1)
      expect(requests[0].url).toBe("http://opencode.local/api/experimental/travelsky/status")
      expect(requests[0].headers.get("authorization")).toBe("Basic local-server-credential")
    },
  )

  test("rejects a signed-out noninteractive command before model execution", async () => {
    if (process.stdin.isTTY && process.stdout.isTTY) throw new Error("Run this test without a TTY")
    const client = OpenCode.make({
      baseUrl: "http://opencode.local",
      fetch: Object.assign(async () => Response.json({ data: { enabled: true, authenticated: false } }), {
        preconnect: fetch.preconnect,
      }),
    })
    await expect(Effect.runPromise(ensureTravelSkyLogin(client))).rejects.toThrow("TravelSky login required")
  })
})
