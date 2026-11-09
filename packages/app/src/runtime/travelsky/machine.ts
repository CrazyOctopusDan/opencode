import type { TravelSky } from "@opencode/schema/travelsky"

export type State =
  | { type: "checking"; attempt: string; ready: boolean }
  | { type: "ready"; status: TravelSky.Status }
  | { type: "form"; username: string; error?: string; retry?: boolean }
  | { type: "submitting"; attempt: string; username: string }
  | { type: "disposed" }

export type Event =
  | { type: "check"; attempt: string }
  | { type: "submit"; attempt: string; username: string }
  | { type: "logout"; attempt: string }
  | { type: "resolved"; attempt: string; status: TravelSky.Status }
  | { type: "failed"; attempt: string; message: string; retry?: boolean }
  | { type: "disposed" }

export function transition(state: State, event: Event): State {
  if (state.type === "disposed") return state

  if (event.type === "disposed") return { type: "disposed" }

  if (event.type === "check" && (state.type === "ready" || state.type === "form"))
    return { type: "checking", attempt: event.attempt, ready: state.type === "ready" }

  if (event.type === "submit" && state.type === "form")
    return { type: "submitting", attempt: event.attempt, username: event.username }

  if (event.type === "logout" && state.type === "ready")
    return { type: "submitting", attempt: event.attempt, username: state.status.username ?? "" }

  if (state.type !== "checking" && state.type !== "submitting") return state

  if (!("attempt" in event) || event.attempt !== state.attempt) return state

  if (event.type === "failed")
    return {
      type: "form",
      username: state.type === "submitting" ? state.username : "",
      error: event.message,
      retry: event.retry,
    }

  if (event.type !== "resolved") return state

  if (!event.status.enabled || event.status.authenticated) return { type: "ready", status: event.status }

  return { type: "form", username: event.status.username ?? "", error: event.status.message }
}

export function view(state: State) {
  return {
    allowed: state.type === "ready" || (state.type === "checking" && state.ready),
    enabled: state.type === "ready" && state.status.enabled,
    busy: state.type === "checking" || state.type === "submitting",
    form: state.type === "form" || state.type === "submitting",
    username: state.type === "form" || state.type === "submitting" ? state.username : "",
    error: state.type === "form" ? state.error : undefined,
    retry: state.type === "form" && state.retry === true,
  }
}
