import { Button } from "@opencode-ai/ui/button"
import { Logo } from "@opencode-ai/ui/logo"
import { TextField } from "@opencode-ai/ui/text-field"
import { useNavigate } from "@solidjs/router"
import { createEffect, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useAuth } from "@/context/auth"
import { usePlatform } from "@/context/platform"
import { TravelSkyAuth } from "@/travelsky/auth"

type RememberedLoginFields = {
  username: string
  password: string
  remembered: boolean
  passwordAvailable: boolean
}

export function rememberedLoginForm(saved: RememberedLoginFields) {
  return {
    username: saved.username,
    password: saved.password,
    remember: saved.remembered && saved.passwordAvailable,
  }
}

export default function LoginPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const platform = usePlatform()
  const [form, setForm] = createStore({
    username: "",
    password: "",
    remember: false,
    loading: false,
    error: "",
  })

  createEffect(() => {
    if (!auth.loggedIn()) return
    navigate("/", { replace: true })
  })

  onMount(() => {
    void TravelSkyAuth.remembered(platform).then((saved) => {
      setForm(rememberedLoginForm(saved))
    })
  })

  const submit = async (e: SubmitEvent) => {
    e.preventDefault()
    if (form.loading) return
    if (!form.username.trim() || !form.password) {
      setForm("error", "请输入用户名和密码")
      return
    }
    setForm({
      loading: true,
      error: "",
    })
    await auth
      .login(form.username.trim(), form.password, form.remember)
      .then(() => navigate("/", { replace: true }))
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : "登录失败"
        setForm("error", message)
      })
      .finally(() => {
        setForm("loading", false)
      })
  }

  return (
    <div class="relative flex-1 h-screen w-screen min-h-0 flex flex-col items-center justify-center bg-background-base font-sans">
      <div class="w-full max-w-md flex flex-col items-center justify-center gap-8 px-6">
        <Logo class="w-58.5 opacity-12 shrink-0" />
        <form class="w-full flex flex-col gap-4" onSubmit={submit}>
          <TextField
            autofocus
            label="用户名"
            placeholder="请输入用户名"
            value={form.username}
            onChange={(value) => setForm("username", value)}
          />
          <TextField
            type="password"
            label="密码"
            placeholder="请输入密码"
            value={form.password}
            onChange={(value) => setForm("password", value)}
          />
          <label class="flex items-center gap-2 text-13-regular text-text-base">
            <input
              type="checkbox"
              checked={form.remember}
              onChange={(event) => setForm("remember", event.currentTarget.checked)}
            />
            <span>记住我</span>
          </label>
          <Show when={form.error}>
            <div class="text-12-regular text-text-danger-base">{form.error}</div>
          </Show>
          <Button type="submit" size="large" disabled={form.loading}>
            {form.loading ? "登录中..." : "登录"}
          </Button>
        </form>
      </div>
    </div>
  )
}
