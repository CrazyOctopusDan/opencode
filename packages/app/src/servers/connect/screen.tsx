import { Show } from "solid-js"
import { Button } from "@opencode/ui/button"
import { TextInput } from "@opencode/ui/text-input"
import { Wordmark } from "@opencode/ui/wordmark"
import { useLanguage } from "@/runtime/i18n/language"
import { createServerConnectController } from "./controller"
import "./screen.css"

export function ConnectServerScreen(props: { url?: string } = {}) {
  const language = useLanguage()
  // Read once: the screen leaves when the server it signs in to answers, so its address does not change while it shows.
  const form = createServerConnectController({ surface: "screen", target: { kind: "connect", url: props.url } })
  form.dispatch({ type: "method.changed", method: "password" })
  const view = form.view

  return (
    <main data-component="connect-server" aria-labelledby="server-connect-title">
      <div class="server-connect-content">
        <div class="server-connect-brand" role="img" aria-label="OpenCode">
          <Wordmark />
        </div>
        <header>
          <h1 id="server-connect-title">{language.t("server.connect.title")}</h1>
          <p>{language.t("server.connect.description")}</p>
        </header>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            form.dispatch({ type: "submitted" })
          }}
        >
          <div class="server-connect-field">
            <label for="server-connect-url">{language.t("dialog.server.add.url")}</label>
            <TextInput
              id="server-connect-url"
              name="server"
              dir="ltr"
              type="text"
              inputMode="url"
              autocomplete="url"
              autocapitalize="off"
              spellcheck={false}
              required
              appearance="large"
              placeholder={language.t("dialog.server.add.placeholder")}
              value={view().draft.url}
              disabled={view().disabled}
              aria-describedby={view().error ? "server-connect-error" : undefined}
              onInput={(event) =>
                form.dispatch({ type: "field.changed", field: "url", value: event.currentTarget.value })
              }
            />
          </div>
          <div class="server-connect-field">
            <label for="server-connect-password">{language.t("dialog.server.add.password")}</label>
            <TextInput
              id="server-connect-password"
              name="password"
              type="password"
              autocomplete="current-password"
              appearance="large"
              value={view().draft.password}
              disabled={view().disabled}
              aria-describedby="server-connect-password-hint"
              onInput={(event) =>
                form.dispatch({ type: "field.changed", field: "password", value: event.currentTarget.value })
              }
            />
            <p id="server-connect-password-hint" class="server-connect-hint">
              {language.t("server.connect.password.hint")}
            </p>
          </div>
          <Show when={view().error}>
            <p id="server-connect-error" class="server-connect-error" role="alert">
              {view().error}
            </p>
          </Show>
          <Button type="submit" variant="contrast" size="large" disabled={!view().canSubmit}>
            {language.t(view().busy ? "dialog.server.add.checking" : "server.connect.button")}
          </Button>
        </form>
      </div>
    </main>
  )
}
