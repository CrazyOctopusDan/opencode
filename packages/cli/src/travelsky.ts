import { confirm, log, password, text } from "@clack/prompts"
import { Effect } from "effect"
import type { OpenCodeClient } from "@opencode/client"
import { prompt, requireInteractive } from "./ui/prompt"
import { errorMessage } from "./util/error"

// Use the resolved server's client so local server authentication and reconnection stay native.
export const ensureTravelSkyLogin = Effect.fn("cli.travelsky.login")(function* (client: OpenCodeClient, force = false) {
  const status = yield* Effect.tryPromise((signal) => client.experimental.travelsky.status({ signal }))
  if (!status.enabled) return false
  if (status.authenticated && !force) return true
  yield* requireInteractive("TravelSky login required. Run `opencode auth login` in an interactive terminal first.")
  while (true) {
    const username = yield* prompt<string>((signal) =>
      text({
        message: "TravelSky username",
        initialValue: status.username,
        validate: (value) => (!value?.trim() ? "Required" : undefined),
        signal,
      }),
    )
    const secret = yield* prompt<string>((signal) =>
      password({
        message: "TravelSky password",
        validate: (value) => (!value ? "Required" : undefined),
        signal,
      }),
    )
    const result = yield* Effect.tryPromise((signal) =>
      client.experimental.travelsky.login({ username: username.trim(), password: secret }, { signal }),
    ).pipe(Effect.result)
    if (result._tag === "Success") {
      log.success("Connected to TravelSky")
      return true
    }
    log.error(errorMessage(result.failure))
    const retry = yield* prompt<boolean>((signal) =>
      confirm({ message: "Retry TravelSky login?", initialValue: true, signal }),
    )
    if (!retry) return yield* Effect.fail(new Error("TravelSky login cancelled"))
  }
})
