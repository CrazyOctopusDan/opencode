import { describe, expect, test } from "bun:test"
import { ModelID, ProviderID } from "../../src/provider/schema"
import type { MessageV2 } from "../../src/session/message-v2"
import { SessionMetric } from "../../src/session/metric"
import { MessageID, PartID, SessionID } from "../../src/session/schema"

function user(input: { id: string; provider: string; model: string; text: string }): MessageV2.WithParts {
  const id = MessageID.make(input.id)
  const sid = SessionID.make("s1")
  return {
    info: {
      id,
      role: "user",
      sessionID: sid,
      time: { created: 1 },
      agent: "build",
      model: {
        modelID: ModelID.make(input.model),
        providerID: ProviderID.make(input.provider),
      },
    },
    parts: [
      {
        id: PartID.ascending(),
        messageID: id,
        sessionID: sid,
        type: "text",
        text: input.text,
      },
    ],
  }
}

function tool(input: {
  id: MessageID
  sid: SessionID
  name: string
  status: "completed" | "error" | "running" | "pending"
  toolInput?: Record<string, unknown>
  metadata?: Record<string, unknown>
  error?: string
}): MessageV2.ToolPart {
  return {
    id: PartID.ascending(),
    messageID: input.id,
    sessionID: input.sid,
    type: "tool",
    callID: `${input.id}-${input.name}-${PartID.ascending()}`,
    tool: input.name,
    state:
      input.status === "completed"
        ? {
            status: "completed",
            input: input.toolInput ?? {},
            output: "ok",
            title: "ok",
            metadata: input.metadata ?? {},
            time: { start: 1, end: 2 },
          }
        : input.status === "error"
          ? {
              status: "error",
              input: input.toolInput ?? {},
              error: input.error ?? "bad",
              metadata: input.metadata,
              time: { start: 1, end: 2 },
            }
          : input.status === "running"
            ? {
                status: "running",
                input: input.toolInput ?? {},
                metadata: input.metadata,
                time: { start: 1 },
              }
            : {
                status: "pending",
                input: input.toolInput ?? {},
                raw: "",
              },
  }
}

function assistant(input: {
  id: string
  parent: string
  provider: string
  model: string
  text: string
  tools?: Array<{
    name: string
    status: "completed" | "error" | "running" | "pending"
    toolInput?: Record<string, unknown>
    metadata?: Record<string, unknown>
    error?: string
  }>
  stepCount?: number
  finish?: string
}): MessageV2.WithParts {
  const id = MessageID.make(input.id)
  const sid = SessionID.make("s1")
  return {
    info: {
      id,
      role: "assistant",
      sessionID: sid,
      parentID: MessageID.make(input.parent),
      modelID: ModelID.make(input.model),
      providerID: ProviderID.make(input.provider),
      mode: "build",
      agent: "build",
      path: { cwd: "/tmp", root: "/tmp" },
      cost: 0,
      time: { created: 1, completed: 2 },
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: {
          read: 0,
          write: 0,
        },
      },
      finish: input.finish,
    },
    parts: [
      {
        id: PartID.ascending(),
        messageID: id,
        sessionID: sid,
        type: "text",
        text: input.text,
      },
      ...Array.from({ length: input.stepCount ?? 0 }, () => ({
        id: PartID.ascending(),
        messageID: id,
        sessionID: sid,
        type: "step-finish" as const,
        reason: "stop",
        cost: 0,
        tokens: {
          input: 0,
          output: 0,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
      })),
      ...(input.tools ?? []).map((item) =>
        tool({
          id,
          sid,
          name: item.name,
          status: item.status,
          toolInput: item.toolInput,
          metadata: item.metadata,
          error: item.error,
        }),
      ),
    ],
  }
}

describe("session metric", () => {
  test("builds v2 conversation stats from visible session messages", () => {
    const rows = [
      user({ id: "u1", provider: "travelSky", model: "qwen-1", text: "first" }),
      assistant({
        id: "a1",
        parent: "u1",
        provider: "travelSky",
        model: "qwen-1",
        text: "hello",
        stepCount: 1,
        tools: [{ name: "bash", status: "completed" }],
      }),
      assistant({
        id: "a2",
        parent: "u1",
        provider: "travelSky",
        model: "qwen-1",
        text: "world",
        stepCount: 2,
        tools: [{ name: "grep", status: "error", metadata: { code: "EACCES" }, error: "permission denied" }],
      }),
      user({ id: "u2", provider: "travelSky", model: "qwen-1", text: "second" }),
      assistant({
        id: "a3",
        parent: "u2",
        provider: "travelSky",
        model: "qwen-2",
        text: "ignore",
        stepCount: 1,
      }),
    ]

    const body = SessionMetric.build({
      rows,
      parent: MessageID.make("u1"),
      model: "qwen-1",
      provider: "travelSky",
    })

    expect(body).toBeDefined()
    expect(body?.text).toBe("10")
    expect(body?.modelName).toBe("qwen-1")

    const other = JSON.parse(body?.other ?? "{}")
    expect(other.token).toBeUndefined()
    expect(other.tool).toBeUndefined()
    expect(other.answer_code).toBeUndefined()
    expect(other.v2).toEqual({
      user_messages: 2,
      agent_replies: 3,
      agent_steps: 4,
      tool_calls: 2,
      tool_call_type_distribution: {
        bash: 1,
        grep: 1,
      },
      tool_call_success_rate: 0.5,
      tool_failures: 1,
      tool_failure_codes: {
        EACCES: 1,
      },
      session_end_reason: "tool_error",
    })
  })

  test("builds v1 file change stats from diffs and edit events", () => {
    const rows = [
      user({ id: "u1", provider: "travelSky", model: "qwen-1", text: "change files" }),
      assistant({
        id: "a1",
        parent: "u1",
        provider: "travelSky",
        model: "qwen-1",
        text: "changed files",
        tools: [
          { name: "edit", status: "completed", toolInput: { filePath: "/tmp/src/old.js" } },
          { name: "edit", status: "completed", toolInput: { filePath: "/tmp/src/old.js" } },
        ],
      }),
    ]

    const body = SessionMetric.build({
      rows,
      parent: MessageID.make("u1"),
      model: "qwen-1",
      provider: "travelSky",
      diffs: [
        {
          file: "src/new.ts",
          status: "added",
          additions: 2,
          deletions: 0,
          patch: "",
        },
        {
          file: "src/old.js",
          status: "modified",
          additions: 1,
          deletions: 1,
          patch: "",
        },
        {
          file: "cmd/main.go",
          status: "deleted",
          additions: 0,
          deletions: 4,
          patch: "",
        },
      ],
    })

    const other = JSON.parse(body?.other ?? "{}")
    expect(other.v1).toEqual({
      modified_files: 1,
      added_files: 1,
      deleted_files: 1,
      line_changes: {
        added: 3,
        deleted: 5,
        total: 8,
        net: -2,
      },
      language_distribution: {
        TS: 1,
        JS: 1,
        Go: 1,
      },
      max_single_file_changed_lines: 4,
      repeated_modified_files: 1,
      by_file: [
        {
          file: "src/new.ts",
          status: "added",
          language: "TS",
          additions: 2,
          deletions: 0,
          changed_lines: 2,
        },
        {
          file: "src/old.js",
          status: "modified",
          language: "JS",
          additions: 1,
          deletions: 1,
          changed_lines: 2,
        },
        {
          file: "cmd/main.go",
          status: "deleted",
          language: "Go",
          additions: 0,
          deletions: 4,
          changed_lines: 4,
        },
      ],
    })
  })

  test("skips non-travelsky provider", () => {
    const rows = [
      user({ id: "u1", provider: "openai", model: "gpt-5", text: "hello" }),
      assistant({
        id: "a1",
        parent: "u1",
        provider: "openai",
        model: "gpt-5",
        text: "hello",
      }),
    ]

    const body = SessionMetric.build({
      rows,
      parent: MessageID.make("u1"),
      model: "gpt-5",
      provider: "openai",
    })

    expect(body).toBeUndefined()
  })
})
