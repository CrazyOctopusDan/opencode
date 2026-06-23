import { describe, expect, test } from "bun:test"

const source = await Bun.file(new URL("./app.tsx", import.meta.url)).text()

describe("AppInterface provider order", () => {
  test("wraps GlobalProvider with AuthProvider so server SDK contexts can read auth", () => {
    const authOpen = source.indexOf("<AuthProvider>")
    const authClose = source.indexOf("</AuthProvider>")
    const globalOpen = source.indexOf("<GlobalProvider>")
    const globalClose = source.indexOf("</GlobalProvider>")

    expect(authOpen).toBeGreaterThan(-1)
    expect(authClose).toBeGreaterThan(authOpen)
    expect(globalOpen).toBeGreaterThan(authOpen)
    expect(globalClose).toBeLessThan(authClose)
  })
})
