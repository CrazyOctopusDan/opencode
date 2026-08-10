import { afterEach, describe, expect, test } from "bun:test"
import type { Platform } from "@/context/platform"
import { TravelSkyAuth } from "./auth"

type SecureCredentialApi = {
  secureCredentialGet: (
    key: string,
  ) => Promise<{ username: string; password: string | null; passwordAvailable: boolean } | null>
  secureCredentialSet: (
    key: string,
    value: { username: string; password: string },
  ) => Promise<{ passwordSaved: boolean }>
  secureCredentialDelete: (key: string) => Promise<void>
}

const webPlatform: Platform = {
  platform: "web",
  openExternal() {},
  async restart() {},
  async notify() {},
}

const desktopPlatform: Platform = {
  ...webPlatform,
  platform: "desktop",
  async openDirectoryPickerDialog() {
    return null
  },
}

function setApi(api: SecureCredentialApi | undefined) {
  ;(globalThis.window as typeof globalThis.window & { api?: SecureCredentialApi }).api = api
}

afterEach(() => {
  setApi(undefined)
})

describe("TravelSkyAuth", () => {
  test("detects Tempo auth expiration debug payload", () => {
    expect(
      TravelSkyAuth.expired({
        debug_tempo: {
          auth_expired: true,
          message: "dummy expired message",
        },
      }),
    ).toBeTrue()
    expect(TravelSkyAuth.expired({ debug_tempo: { auth_expired: false } })).toBeFalse()
    expect(TravelSkyAuth.expired({})).toBeFalse()
  })

  test("returns no remembered credentials on web platform", async () => {
    setApi({
      async secureCredentialGet() {
        throw new Error("should not read desktop credentials")
      },
      async secureCredentialSet() {
        return { passwordSaved: true }
      },
      async secureCredentialDelete() {},
    })

    expect(await TravelSkyAuth.remembered(webPlatform)).toEqual({
      username: "",
      password: "",
      remembered: false,
      passwordAvailable: false,
    })
  })

  test("returns no remembered credentials when desktop IPC is missing", async () => {
    expect(await TravelSkyAuth.remembered(desktopPlatform)).toEqual({
      username: "",
      password: "",
      remembered: false,
      passwordAvailable: false,
    })
  })

  test("reads remembered desktop credentials from secure storage", async () => {
    const keys: string[] = []
    setApi({
      async secureCredentialGet(key) {
        keys.push(key)
        return { username: "dummy-user", password: "dummy-password", passwordAvailable: true }
      },
      async secureCredentialSet() {
        return { passwordSaved: false }
      },
      async secureCredentialDelete() {},
    })

    expect(await TravelSkyAuth.remembered(desktopPlatform)).toEqual({
      username: "dummy-user",
      password: "dummy-password",
      remembered: true,
      passwordAvailable: true,
    })
    expect(keys).toEqual(["desktop-login"])
  })

  test("saves desktop credentials only when the password is saved", async () => {
    const saved: { key: string; username: string; password: string }[] = []
    setApi({
      async secureCredentialGet() {
        return null
      },
      async secureCredentialSet(key, value) {
        saved.push({ key, username: value.username, password: value.password })
        return { passwordSaved: true }
      },
      async secureCredentialDelete() {},
    })

    expect(await TravelSkyAuth.save(desktopPlatform, { username: "dummy-user", password: "dummy-password" })).toBeTrue()
    expect(saved).toEqual([{ key: "desktop-login", username: "dummy-user", password: "dummy-password" }])
  })

  test("does not report saved credentials on web, missing IPC, or failed save result", async () => {
    expect(await TravelSkyAuth.save(webPlatform, { username: "dummy-user", password: "dummy-password" })).toBeFalse()
    expect(
      await TravelSkyAuth.save(desktopPlatform, { username: "dummy-user", password: "dummy-password" }),
    ).toBeFalse()

    setApi({
      async secureCredentialGet() {
        return null
      },
      async secureCredentialSet() {
        return { passwordSaved: false }
      },
      async secureCredentialDelete() {},
    })

    expect(
      await TravelSkyAuth.save(desktopPlatform, { username: "dummy-user", password: "dummy-password" }),
    ).toBeFalse()
  })

  test("clears desktop credentials and swallows IPC failures", async () => {
    const keys: string[] = []
    setApi({
      async secureCredentialGet() {
        return null
      },
      async secureCredentialSet() {
        return { passwordSaved: false }
      },
      async secureCredentialDelete(key) {
        keys.push(key)
      },
    })

    await TravelSkyAuth.clear(desktopPlatform)
    expect(keys).toEqual(["desktop-login"])

    setApi({
      async secureCredentialGet() {
        return null
      },
      async secureCredentialSet() {
        return { passwordSaved: false }
      },
      async secureCredentialDelete() {
        throw new Error("dummy delete failure")
      },
    })

    await expect(TravelSkyAuth.clear(desktopPlatform)).resolves.toBeUndefined()
  })
})
