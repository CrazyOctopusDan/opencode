import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { FILE, clear, current, read, write } from "../../src/cli/travelsky/auth-store"
import { Filesystem } from "../../src/util/filesystem"

describe("travelsky auth store", () => {
  beforeEach(async () => {
    await clear()
  })

  afterEach(async () => {
    await clear()
  })

  test("writes and reads token", async () => {
    await write({
      access_token: "token-1",
      expires_in: 120,
      username: "user-1",
    })

    const item = await current()
    expect(item?.access_token).toBe("token-1")
    expect(item?.username).toBe("user-1")
    expect(typeof item?.expires_at).toBe("number")
  })

  test("returns undefined when expired", async () => {
    await Filesystem.writeJson(
      FILE,
      {
        access_token: "token-old",
        expires_at: Date.now() - 10_000,
        username: "old",
      },
      0o600,
    )

    const all = await read()
    const item = await current()
    expect(all?.access_token).toBe("token-old")
    expect(item).toBeUndefined()
  })
})

