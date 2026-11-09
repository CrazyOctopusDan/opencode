import { createContext, createEffect, on, onCleanup, onMount, Show, useContext, type ParentProps } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { Button } from "@opencode/ui/button"
import { Loader } from "@opencode/ui/loader"
import { TextInput } from "@opencode/ui/text-input"
import { uuid } from "@opencode/util/uuid"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { useServer } from "@/runtime/server/current"
import { showToast } from "@/shell/notifications/toast"
import { transition, view, type Event, type State } from "./machine"

const context = createContext<{ enabled: () => boolean; logout: () => void }>()

export const useTravelSky = () => useContext(context)

export function TravelSkyGate(props: ParentProps) {
  const server = useServer()
  const platform = usePlatform()
  const language = useLanguage()
  const controller = new AbortController()
  const initial = uuid()

  const [store, setStore] = createStore<{
    state: State
    username: string
    password: string
    remember: boolean
  }>({
    state: { type: "checking", attempt: initial, ready: false },
    username: "",
    password: "",
    remember: false,
  })

  const state = () => view(store.state)

  const dispatch = (event: Event) =>
    setStore(
      produce((draft) => {
        draft.state = transition(draft.state, event)
      }),
    )

  const api = () => server.ctx.sdk.api.experimental.travelsky
  const signal = () => AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)])

  const fail = (attempt: string, retry = false) =>
    dispatch({ type: "failed", attempt, retry, message: language.t("travelsky.failed") })

  async function check(attempt: string) {
    const result = await api()
      .status({ signal: signal() })
      .catch(() => fail(attempt, true))

    if (!result) return

    if (!result.enabled || result.authenticated) {
      dispatch({ type: "resolved", attempt, status: result })

      return
    }

    const saved = await platform.travelSkyCredentials?.get(server.key)

    if (controller.signal.aborted) return

    if (!saved) {
      dispatch({ type: "resolved", attempt, status: result })

      return
    }

    const logged = await api().login(saved, { signal: signal() })
    dispatch({ type: "resolved", attempt, status: logged })
  }

  function refresh() {
    const attempt = uuid()
    dispatch({ type: "check", attempt })

    if (store.state.type !== "checking" || store.state.attempt !== attempt) return
    void check(attempt).catch(() => fail(attempt))
  }

  async function login(attempt: string, credential: { username: string; password: string }, remember: boolean) {
    const result = await api().login(credential, { signal: signal() })

    if (controller.signal.aborted) return

    if (platform.travelSkyCredentials) {
      const saved = await platform.travelSkyCredentials.set(server.key, remember ? credential : null)

      if (!saved && remember) showToast({ variant: "error", title: language.t("travelsky.rememberUnavailable") })
    }

    setStore("password", "")
    dispatch({ type: "resolved", attempt, status: result })
  }

  function submit() {
    const attempt = uuid()
    const credential = { username: store.username.trim(), password: store.password }

    if (!credential.username || !credential.password) return
    dispatch({ type: "submit", attempt, username: credential.username })

    if (store.state.type !== "submitting" || store.state.attempt !== attempt) return
    void login(attempt, credential, store.remember).catch(() => fail(attempt))
  }

  function logout() {
    const attempt = uuid()
    dispatch({ type: "logout", attempt })

    if (store.state.type !== "submitting" || store.state.attempt !== attempt) return
    void (async () => {
      await platform.travelSkyCredentials?.set(server.key, null)
      const result = await api().logout({ signal: signal() })
      dispatch({ type: "resolved", attempt, status: result })
    })().catch(() => fail(attempt))
  }

  createEffect(() => {
    const username = state().username

    if (username) setStore("username", username)
  })
  onMount(() => {
    void check(initial).catch(() => fail(initial))
  })
  createEffect(
    on(server.ctx.sdk.connection.status, (status) => {
      if (status === "connected" && state().retry) refresh()
    }),
  )

  const timer = setInterval(() => {
    if (state().allowed && !state().busy) refresh()

    if (state().retry && server.ctx.sdk.connection.status() === "connected") refresh()
  }, 60_000)

  onCleanup(() => {
    dispatch({ type: "disposed" })
    controller.abort()
    clearInterval(timer)
  })

  return (
    <context.Provider value={{ enabled: () => state().enabled, logout }}>
      <Show
        when={state().allowed}
        fallback={
          <main class="flex h-full min-h-0 items-center justify-center p-6">
            <form
              class="flex w-full max-w-sm flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault()
                submit()
              }}
            >
              <h1 class="text-20-medium text-text-strong">{language.t("travelsky.title")}</h1>
              <Show when={state().busy}>
                <Loader />
                <p role="status">{language.t("travelsky.checking")}</p>
              </Show>
              <Show when={state().form}>
                <label for="travelsky-username">{language.t("travelsky.username")}</label>
                <TextInput
                  id="travelsky-username"
                  class="w-full"
                  autocomplete="username"
                  required
                  value={store.username}
                  disabled={state().busy}
                  onInput={(event) => setStore("username", event.currentTarget.value)}
                />
                <label for="travelsky-password">{language.t("travelsky.password")}</label>
                <TextInput
                  id="travelsky-password"
                  class="w-full"
                  type="password"
                  autocomplete="current-password"
                  required
                  value={store.password}
                  disabled={state().busy}
                  onInput={(event) => setStore("password", event.currentTarget.value)}
                />
                <Show when={platform.travelSkyCredentials}>
                  <label class="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={store.remember}
                      disabled={state().busy}
                      onChange={(event) => setStore("remember", event.currentTarget.checked)}
                    />
                    {language.t("travelsky.remember")}
                  </label>
                </Show>
                <Show when={state().error}>
                  <p role="alert" class="text-text-critical-base">
                    {state().error}
                  </p>
                </Show>
                <Button type="submit" variant="submit" disabled={state().busy}>
                  {language.t("travelsky.login")}
                </Button>
                <Button type="button" variant="ghost" disabled={state().busy} onClick={refresh}>
                  {language.t("travelsky.retry")}
                </Button>
              </Show>
            </form>
          </main>
        }
      >
        {props.children}
      </Show>
    </context.Provider>
  )
}
