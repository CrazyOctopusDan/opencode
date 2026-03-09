import { Button } from "@opencode-ai/ui/button"
import { Logo } from "@opencode-ai/ui/logo"
import { TextField } from "@opencode-ai/ui/text-field"
import { useNavigate } from "@solidjs/router"
import { createEffect, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useAuth } from "@/context/auth"

export default function LoginPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = createStore({
    username: "",
    password: "",
    loading: false,
    error: "",
  })

  createEffect(() => {
    if (!auth.loggedIn()) return
    navigate("/", { replace: true })
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
      .login(form.username.trim(), form.password)
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
