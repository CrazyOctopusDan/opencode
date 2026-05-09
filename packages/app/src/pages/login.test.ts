import { beforeAll, describe, expect, mock, test } from "bun:test"

type RememberedLoginForm = typeof import("./login").rememberedLoginForm

let rememberedLoginForm: RememberedLoginForm

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
})
