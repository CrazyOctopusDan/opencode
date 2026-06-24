import { describe, expect, test } from "bun:test"
import type { Event } from "@opencode-ai/sdk/v2/client"
import { SessionDiagnostic } from "./session-diagnostic"

describe("session diagnostic", () => {
  test("describes TravelSky metric trigger eligibility from the visible assistant finish", () => {
    const state = SessionDiagnostic.metric({
      finish: "stop",
      providerID: "travelsky",
      messageID: "msg_1",
      modelID: "qwen",
    })
    expect(state.eligible).toBe(true)
    expect(state.reason).toBe("ready")
    expect(state.generation.path).toBe("/ai/data/api/record/saveGeneration")
    expect(state.adoption.path).toBe("/record/addAdoption")
  })

  test("does not mark incomplete or non-TravelSky messages as metric eligible", () => {
    expect(SessionDiagnostic.metric({ finish: "tool-calls", providerID: "travelsky" }).eligible).toBe(false)
    expect(SessionDiagnostic.metric({ finish: "unknown", providerID: "travelsky" }).eligible).toBe(false)
    expect(SessionDiagnostic.metric({ finish: "stop", providerID: "anthropic" }).eligible).toBe(false)
  })

  test("tracks event count and coalesce", () => {
    const dir = "/tmp/a"
    SessionDiagnostic.event({
      dir,
      evt: {
        type: "message.updated",
        properties: {
          info: { id: "msg_1", sessionID: "ses_1" },
        },
      } as Event,
    })
    SessionDiagnostic.coalesce(dir)
    expect(SessionDiagnostic.data[dir]?.event.by["message.updated"]).toBe(1)
    expect(SessionDiagnostic.data[dir]?.event.coalesce).toBe(1)
    expect(SessionDiagnostic.data[dir]?.event.last?.messageID).toBe("msg_1")
  })

  test("tracks match miss and sync overwrite", () => {
    const dir = "/tmp/b"
    const sessionID = "ses_1"
    SessionDiagnostic.miss(dir)
    SessionDiagnostic.sync({
      dir,
      sessionID,
      mode: "replace",
      before: 2,
      after: 1,
      lost: ["msg_1"],
    })
    expect(SessionDiagnostic.data[dir]?.health.miss).toBe(1)
    expect(SessionDiagnostic.data[dir]?.session[sessionID]?.sync.overwrite).toBe(true)
    expect(SessionDiagnostic.data[dir]?.session[sessionID]?.sync.lost).toEqual(["msg_1"])
  })
})
