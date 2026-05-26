import { describe, expect, test } from "bun:test"
import { isTravelSky, travelSkyProviderID } from "../../src/cli/travelsky/provider"

describe("travelsky provider helpers", () => {
  test("matches TravelSky provider case-insensitively", () => {
    expect(isTravelSky("travelSky")).toBeTrue()
    expect(isTravelSky("travelsky")).toBeTrue()
    expect(isTravelSky("openai")).toBeFalse()
  })

  test("prefers the canonical provider id used by model state", () => {
    expect(
      travelSkyProviderID({
        provider: [{ id: "travelSky" }],
        providerNext: [{ id: "travelsky" }],
      }),
    ).toBe("travelSky")
  })

  test("falls back to provider_next and then canonical default", () => {
    expect(
      travelSkyProviderID({
        provider: [],
        providerNext: [{ id: "travelsky" }],
      }),
    ).toBe("travelsky")
    expect(travelSkyProviderID({ provider: [], providerNext: [] })).toBe("travelSky")
  })
})
