import { beforeAll, describe, expect, mock, test } from "bun:test"

type RememberedLoginForm = typeof import("./login").rememberedLoginForm
type HydrateRememberedLoginForm = typeof import("./login").hydrateRememberedLoginForm

let rememberedLoginForm: RememberedLoginForm
let hydrateRememberedLoginForm: HydrateRememberedLoginForm

beforeAll(async () => {
  mock.module("@opencode-ai/ui/button", () => ({ Button: () => null }))
  mock.module("@opencode-ai/ui/logo", () => ({ Logo: () => null }))
  mock.module("@opencode-ai/ui/text-field", () => ({ TextField: () => null }))
  mock.module("@solidjs/router", () => ({ useNavigate: () => () => undefined }))
  mock.module("@/context/auth", () => ({
    useAuth: () => ({
      loggedIn: () => false,
      login: async () => undefined,
    }),
  }))
  mock.module("@/context/platform", () => ({ usePlatform: () => ({ platform: "desktop" }) }))
  mock.module("@/travelsky/auth", () => ({
    TravelSkyAuth: {
      remembered: async () => ({ username: "", password: "", remembered: false, passwordAvailable: false }),
    },
  }))
  const mod = await import("./login")
  rememberedLoginForm = mod.rememberedLoginForm
  hydrateRememberedLoginForm = mod.hydrateRememberedLoginForm
})

describe("login remember me form helpers", () => {
  test("fills saved credentials and checks remember only when password is available", () => {
    expect(
      rememberedLoginForm({
        username: "saved-user",
        password: "",
        remembered: true,
        passwordAvailable: false,
      }),
    ).toEqual({
      username: "saved-user",
      password: "",
      remember: false,
    })

    expect(
      rememberedLoginForm({
        username: "saved-user",
        password: "saved-password",
        remembered: true,
        passwordAvailable: true,
      }),
    ).toEqual({
      username: "saved-user",
      password: "saved-password",
      remember: true,
    })
  })

  test("applies slow remembered read when no user edits occurred", async () => {
    const applied: Array<ReturnType<RememberedLoginForm>> = []

    expect(
      await hydrateRememberedLoginForm({
        load: async () => ({
          username: "saved-user",
          password: "saved-password",
          remembered: true,
          passwordAvailable: true,
        }),
        edited: () => false,
        setForm: (form) => applied.push(form),
      }),
    ).toBeTrue()
    expect(applied).toEqual([
      {
        username: "saved-user",
        password: "saved-password",
        remember: true,
      },
    ])
  })

  test("slow remembered read does not overwrite user input or toggled checkbox", async () => {
    let resolveSaved: (value: Parameters<RememberedLoginForm>[0]) => void = () => undefined
    const saved = new Promise<Parameters<RememberedLoginForm>[0]>((resolve) => {
      resolveSaved = resolve
    })
    const applied: Array<ReturnType<RememberedLoginForm>> = []
    let edited = false

    const hydration = hydrateRememberedLoginForm({
      load: () => saved,
      edited: () => edited,
      setForm: (form) => applied.push(form),
    })

    edited = true
    resolveSaved({
      username: "saved-user",
      password: "saved-password",
      remembered: true,
      passwordAvailable: true,
    })

    expect(await hydration).toBeFalse()
    expect(applied).toEqual([])
  })
})
