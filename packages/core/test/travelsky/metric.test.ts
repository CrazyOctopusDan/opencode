import { describe, expect, test } from "bun:test"
import { DateTime } from "effect"
import { Agent } from "@opencode/schema/agent"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import { SessionMessage } from "@opencode/schema/session-message"
import { TravelSkyMetric } from "../../src/travelsky/metric"
import pkg from "../../package.json"

const user = SessionMessage.User.make({
  id: SessionMessage.ID.make("msg_user"),
  type: "user",
  text: "Update the code",
  time: { created: DateTime.makeUnsafe(0) },
})
const assistant = SessionMessage.Assistant.make({
  id: SessionMessage.ID.make("msg_assistant"),
  type: "assistant",
  agent: Agent.ID.make("build"),
  model: Model.Ref.make({ providerID: Provider.ID.make("travelSky"), id: Model.ID.make("dsv4") }),
  content: [{ type: "text", text: "Updated." }],
  finish: "stop",
  time: { created: DateTime.makeUnsafe(1), completed: DateTime.makeUnsafe(2) },
})
const base = { sessionID: "ses_test", root: "/project", scope: "/project", messages: [user, assistant] }

describe("TravelSky completed response payload", () => {
  test("reports final file changes and uses the source release version within the backend limit", () => {
    const result = TravelSkyMetric.build({
      ...base,
      diffs: [{ file: "src/a.ts", patch: "", additions: 4, deletions: 2, status: "modified" }],
    })
    expect(result?.generation).toMatchObject({
      modelName: "dsv4",
      generatedLines: 4,
      adoptedLines: 4,
      codeLanguage: "TS",
      toolName: "opencode-cli",
      toolVersion: pkg.version,
      ideVersion: "",
      projectName: "project",
      requestContent: "Update the code",
      responseContent: "Updated.",
    })
    expect(result?.generation.toolVersion.length).toBeLessThanOrEqual(15)
    expect(result?.adoption).toEqual({ adoptedLines: 4, deletedLines: 2, adoptedContent: "" })
  })

  test("collects the whole response and keeps Desktop attribution when the server is shared", () => {
    const result = TravelSkyMetric.build({
      ...base,
      client: "opencode",
      messages: [
        { ...user, metadata: { travelSkyClient: "desktop" } },
        {
          ...assistant,
          id: SessionMessage.ID.make("msg_first"),
          finish: "tool-calls",
          content: [{ type: "text", text: "Working. " }],
        },
        assistant,
      ],
    })
    expect(result?.generation.toolName).toBe("opencode-desktop")
    expect(result?.generation.responseContent).toBe("Working. Updated.")
  })

  test("does not count reverted files and retains external tool metadata as a fallback", () => {
    const tool = SessionMessage.AssistantTool.make({
      type: "tool",
      id: "call_edit",
      name: "external_edit",
      state: {
        status: "completed",
        input: {},
        content: [{ type: "text", text: "done" }],
        metadata: {
          files: [
            { file: "src/reverted.ts", additions: 8, deletions: 5 },
            { file: "/outside/a.py", additions: "3.9", deletions: -1 },
          ],
        },
      },
      time: { created: DateTime.makeUnsafe(1), completed: DateTime.makeUnsafe(2) },
    })
    const messages = [user, { ...assistant, content: [tool, ...assistant.content] }]
    expect(TravelSkyMetric.build({ ...base, messages, diffs: [] })?.generation.generatedLines).toBe(3)
    expect(TravelSkyMetric.build({ ...base, messages, diffs: [] })?.adoption).toEqual({
      adoptedLines: 3,
      deletedLines: 0,
      adoptedContent: "",
    })
    expect(TravelSkyMetric.build({ ...base, messages })?.generation.generatedLines).toBe(11)
    expect(TravelSkyMetric.build({ ...base, diffs: [] })?.adoption).toBeUndefined()
  })

  test("ignores unfinished, failed and noncompany responses", () => {
    expect(TravelSkyMetric.build({ ...base, messages: [user, { ...assistant, finish: "length" }] })).toBeUndefined()
    expect(
      TravelSkyMetric.build({
        ...base,
        messages: [user, { ...assistant, error: { type: "aborted", message: "cancelled" } }],
      }),
    ).toBeUndefined()
    expect(
      TravelSkyMetric.build({
        ...base,
        messages: [user, { ...assistant, model: { ...assistant.model, providerID: Provider.ID.make("openai") } }],
      }),
    ).toBeUndefined()
  })
})
