import { describe, expect, test } from "bun:test"
import { transition, view, type State } from "./machine"

describe("TravelSky login lifecycle", () => {
  test("claims submissions before async work and rejects duplicate and stale completions", () => {
    const form: State = { type: "form", username: "user" }
    const active = transition(form, { type: "submit", attempt: "one", username: "user" })
    expect(transition(active, { type: "submit", attempt: "two", username: "other" })).toBe(active)
    expect(
      transition(active, { type: "resolved", attempt: "two", status: { enabled: true, authenticated: true } }),
    ).toBe(active)
    expect(
      view(transition(active, { type: "resolved", attempt: "one", status: { enabled: true, authenticated: true } }))
        .allowed,
    ).toBe(true)
  })

  test("keeps the app mounted while checking and locks it when authentication expires", () => {
    const ready: State = { type: "ready", status: { enabled: true, authenticated: true } }
    const checking = transition(ready, { type: "check", attempt: "check" })
    expect(view(checking)).toMatchObject({ allowed: true, busy: true })

    const expired = transition(checking, {
      type: "resolved",
      attempt: "check",
      status: { enabled: true, authenticated: false, username: "user" },
    })

    expect(view(expired)).toMatchObject({ allowed: false, busy: false, form: true, username: "user" })
  })

  test("failure and timeout unlock retry, while disposal rejects every late result", () => {
    const active: State = { type: "submitting", attempt: "one", username: "user" }
    const failed = transition(active, { type: "failed", attempt: "one", message: "timeout" })
    expect(view(failed)).toMatchObject({ busy: false, error: "timeout", username: "user" })
    expect(transition(failed, { type: "submit", attempt: "two", username: "user" }).type).toBe("submitting")
    const disposed = transition(active, { type: "disposed" })
    expect(
      transition(disposed, { type: "resolved", attempt: "one", status: { enabled: true, authenticated: true } }),
    ).toBe(disposed)
    expect(transition(disposed, { type: "check", attempt: "two" })).toBe(disposed)
  })

  test("logout locks immediately and an earlier login cannot restore access", () => {
    const ready: State = { type: "ready", status: { enabled: true, authenticated: true, username: "user" } }
    const logout = transition(ready, { type: "logout", attempt: "out" })
    expect(view(logout).allowed).toBe(false)
    expect(
      transition(logout, { type: "resolved", attempt: "in", status: { enabled: true, authenticated: true } }),
    ).toBe(logout)
    expect(
      view(transition(logout, { type: "resolved", attempt: "out", status: { enabled: true, authenticated: false } }))
        .form,
    ).toBe(true)
  })

  test("disabled enterprise mode leaves native server access available", () => {
    const state = transition(
      { type: "checking", attempt: "one", ready: false },
      { type: "resolved", attempt: "one", status: { enabled: false, authenticated: false } },
    )

    expect(view(state)).toMatchObject({ allowed: true, enabled: false })
  })

  test("retries connection failures after recovery without repeatedly submitting rejected passwords", () => {
    const checking: State = { type: "checking", attempt: "status", ready: false }
    const offline = transition(checking, { type: "failed", attempt: "status", message: "offline", retry: true })
    expect(view(offline).retry).toBe(true)
    expect(transition(offline, { type: "check", attempt: "reconnected" }).type).toBe("checking")
    const login: State = { type: "submitting", attempt: "login", username: "user" }
    expect(view(transition(login, { type: "failed", attempt: "login", message: "rejected" })).retry).toBe(false)
  })
})
