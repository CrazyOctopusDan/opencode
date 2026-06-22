import { describe, expect, test } from "bun:test"
import type { OpencodeClient, ProviderListResponse } from "@opencode-ai/sdk/v2/client"
import { canDisposeDirectory, pickDirectoriesToEvict } from "./global-sync/eviction"
import { listProvidersWithRecovery } from "./global-sync/bootstrap"
import { estimateRootSessionTotal, loadRootSessionsWithFallback } from "./global-sync/session-load"

const providerList = (patch?: Record<string, unknown>) =>
  ({
    all: [],
    connected: [],
    default: {},
    ...patch,
  }) as ProviderListResponse

const providerSdk = (data: ProviderListResponse | Error) =>
  ({
    provider: {
      list: async () => {
        if (data instanceof Error) throw data
        return { data }
      },
    },
  }) as unknown as OpencodeClient

describe("pickDirectoriesToEvict", () => {
  test("keeps pinned stores and evicts idle stores", () => {
    const now = 5_000
    const picks = pickDirectoriesToEvict({
      stores: ["a", "b", "c", "d"],
      state: new Map([
        ["a", { lastAccessAt: 1_000 }],
        ["b", { lastAccessAt: 4_900 }],
        ["c", { lastAccessAt: 4_800 }],
        ["d", { lastAccessAt: 3_000 }],
      ]),
      pins: new Set(["a"]),
      max: 2,
      ttl: 1_500,
      now,
    })

    expect(picks).toEqual(["d", "c"])
  })
})

describe("loadRootSessionsWithFallback", () => {
  test("uses limited roots query when supported", async () => {
    const calls: Array<{ directory: string; roots: true; limit?: number }> = []

    const result = await loadRootSessionsWithFallback({
      directory: "dir",
      limit: 10,
      list: async (query) => {
        calls.push(query)
        return { data: [] }
      },
    })

    expect(result.data).toEqual([])
    expect(result.limited).toBe(true)
    expect(calls).toEqual([{ directory: "dir", roots: true, limit: 10 }])
  })

  test("falls back to full roots query on limited-query failure", async () => {
    const calls: Array<{ directory: string; roots: true; limit?: number }> = []

    const result = await loadRootSessionsWithFallback({
      directory: "dir",
      limit: 25,
      list: async (query) => {
        calls.push(query)
        if (query.limit) throw new Error("unsupported")
        return { data: [] }
      },
    })

    expect(result.data).toEqual([])
    expect(result.limited).toBe(false)
    expect(calls).toEqual([
      { directory: "dir", roots: true, limit: 25 },
      { directory: "dir", roots: true },
    ])
  })
})

describe("listProvidersWithRecovery", () => {
  test("recovers and retries provider list when Tempo auth is expired", async () => {
    const calls: string[] = []
    const expired = providerSdk(
      providerList({
        debug_tempo: {
          auth_expired: true,
          message: "token校验失败，失败原因：登录已过期",
        },
      }),
    )
    const recovered = providerSdk(
      providerList({
        all: [
          {
            id: "travelSky",
            name: "travelSky",
            models: {
              qwen: {
                id: "qwen",
                name: "Qwen",
                release_date: "2026-01-01",
              },
            },
          },
        ],
        connected: ["travelSky"],
        default: {
          travelSky: "qwen",
        },
      }),
    )

    const result = await listProvidersWithRecovery(expired, {
      recoverProviderAuth: async () => {
        calls.push("recover")
        return recovered
      },
    })

    expect(calls).toEqual(["recover"])
    expect(result.connected).toEqual(["travelSky"])
    expect(result.all[0]?.models.qwen?.status).toBeUndefined()
  })

  test("returns an empty provider list when expired auth cannot recover", async () => {
    const result = await listProvidersWithRecovery(
      providerSdk(
        providerList({
          debug_tempo: {
            auth_expired: true,
          },
        }),
      ),
      {
        recoverProviderAuth: async () => undefined,
      },
    )

    expect(result).toEqual(providerList())
  })
})

describe("estimateRootSessionTotal", () => {
  test("keeps exact total for full fetches", () => {
    expect(estimateRootSessionTotal({ count: 42, limit: 10, limited: false })).toBe(42)
  })

  test("marks has-more for full-limit limited fetches", () => {
    expect(estimateRootSessionTotal({ count: 10, limit: 10, limited: true })).toBe(11)
  })

  test("keeps exact total when limited fetch is under limit", () => {
    expect(estimateRootSessionTotal({ count: 9, limit: 10, limited: true })).toBe(9)
  })
})

describe("canDisposeDirectory", () => {
  test("rejects pinned or inflight directories", () => {
    expect(
      canDisposeDirectory({
        directory: "dir",
        hasStore: true,
        pinned: true,
        booting: false,
        loadingSessions: false,
      }),
    ).toBe(false)
    expect(
      canDisposeDirectory({
        directory: "dir",
        hasStore: true,
        pinned: false,
        booting: true,
        loadingSessions: false,
      }),
    ).toBe(false)
    expect(
      canDisposeDirectory({
        directory: "dir",
        hasStore: true,
        pinned: false,
        booting: false,
        loadingSessions: true,
      }),
    ).toBe(false)
  })

  test("accepts idle unpinned directory store", () => {
    expect(
      canDisposeDirectory({
        directory: "dir",
        hasStore: true,
        pinned: false,
        booting: false,
        loadingSessions: false,
      }),
    ).toBe(true)
  })
})
