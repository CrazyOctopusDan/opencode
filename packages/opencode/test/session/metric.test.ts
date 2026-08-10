import { describe, expect, test } from "bun:test"
import { ModelID, ProviderID } from "../../src/provider/schema"
import type { MessageV2 } from "../../src/session/message-v2"
import { SessionMetric } from "../../src/session/metric"
import { MessageID, PartID, SessionID } from "../../src/session/schema"

function mid(input: string) {
  return MessageID.make(input.startsWith("msg") ? input : `msg_${input}`)
}

const sid = SessionID.make("ses_1")

function user(input: { id: string; provider: string; model: string; text: string }): MessageV2.WithParts {
  const id = mid(input.id)
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
  const id = mid(input.id)
  return {
    info: {
      id,
      role: "assistant",
      sessionID: sid,
      parentID: mid(input.parent),
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
  test("builds generation record payload from current prompt and assistant answer", () => {
    const rows = [
      user({ id: "u1", provider: "travelSky", model: "qwen-1", text: "write code" }),
      assistant({
        id: "a1",
        parent: "u1",
        provider: "travelSky",
        model: "qwen-1",
        text: "const a = 1\nconst b = 2",
        tools: [
          {
            name: "write",
            status: "completed",
            metadata: {
              filediff: {
                file: "/tmp/opencode/src/index.ts",
                status: "added",
                additions: 2,
                deletions: 0,
                patch: "",
              },
            },
          },
        ],
      }),
    ]

    const body = SessionMetric.build({
      rows,
      parent: mid("u1"),
      model: "qwen-1",
      provider: "travelSky",
      diffs: [],
    })

    expect(body).toEqual({
      modelName: "qwen-1",
      promptName: "build",
      generatedLines: 2,
      adoptedLines: 2,
      sessionId: "ses_1",
      codeLanguage: "TS",
      toolName: "opencode-cli",
      toolVersion: "1.18.15",
      ideName: "OpenCode",
      ideVersion: "",
      projectName: "tmp",
      requestContent: "write code",
      responseContent: "const a = 1\nconst b = 2",
    })
    expect(body?.toolVersion.length).toBeLessThanOrEqual(15)
    expect(body?.ideVersion.length).toBeLessThanOrEqual(15)
  })

  test("uses explicit metric tool name before client fallback", () => {
    const previousToolName = process.env.OPENCODE_TOOL_NAME
    const previousClient = process.env.OPENCODE_CLIENT
    process.env.OPENCODE_TOOL_NAME = "opencode-desktop"
    process.env.OPENCODE_CLIENT = "cli"
    try {
      const rows = [
        user({ id: "u1", provider: "travelSky", model: "qwen-1", text: "write code" }),
        assistant({
          id: "a1",
          parent: "u1",
          provider: "travelSky",
          model: "qwen-1",
          text: "done",
        }),
      ]

      const body = SessionMetric.build({
        rows,
        parent: mid("u1"),
        model: "qwen-1",
        provider: "travelSky",
      })

      expect(body?.toolName).toBe("opencode-desktop")
    } finally {
      if (previousToolName === undefined) delete process.env.OPENCODE_TOOL_NAME
      else process.env.OPENCODE_TOOL_NAME = previousToolName
      if (previousClient === undefined) delete process.env.OPENCODE_CLIENT
      else process.env.OPENCODE_CLIENT = previousClient
    }
  })

  test("uses build-injected metric tool name before client fallback", () => {
    const previousToolName = process.env.OPENCODE_TOOL_NAME
    const previousClient = process.env.OPENCODE_CLIENT
    const globalWithTool = globalThis as typeof globalThis & { OPENCODE_TOOL_NAME?: string }
    const previousGlobalToolName = globalWithTool.OPENCODE_TOOL_NAME
    delete process.env.OPENCODE_TOOL_NAME
    process.env.OPENCODE_CLIENT = "desktop"
    globalWithTool.OPENCODE_TOOL_NAME = "opencode-cli"
    try {
      const rows = [
        user({ id: "u1", provider: "travelSky", model: "qwen-1", text: "write code" }),
        assistant({
          id: "a1",
          parent: "u1",
          provider: "travelSky",
          model: "qwen-1",
          text: "done",
        }),
      ]

      const body = SessionMetric.build({
        rows,
        parent: mid("u1"),
        model: "qwen-1",
        provider: "travelSky",
      })

      expect(body?.toolName).toBe("opencode-cli")
    } finally {
      if (previousToolName === undefined) delete process.env.OPENCODE_TOOL_NAME
      else process.env.OPENCODE_TOOL_NAME = previousToolName
      if (previousClient === undefined) delete process.env.OPENCODE_CLIENT
      else process.env.OPENCODE_CLIENT = previousClient
      if (previousGlobalToolName === undefined) delete globalWithTool.OPENCODE_TOOL_NAME
      else globalWithTool.OPENCODE_TOOL_NAME = previousGlobalToolName
    }
  })

  test("builds request and response content from visible session messages", () => {
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
      parent: mid("u1"),
      model: "qwen-1",
      provider: "travelSky",
    })

    expect(body).toBeDefined()
    expect(body?.modelName).toBe("qwen-1")
    expect(body?.promptName).toBe("build")
    expect(body?.requestContent).toBe("first")
    expect(body?.responseContent).toBe("helloworld")
  })

  test("builds generated line count and language from diffs and edit events", () => {
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
      parent: mid("u1"),
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

    expect(body?.generatedLines).toBe(3)
    expect(body?.adoptedLines).toBe(3)
    expect(body?.codeLanguage).toBe("TS")
  })

  test("builds adoption payload from final file changes with empty adopted content", () => {
    const rows = [
      user({ id: "u1", provider: "travelSky", model: "qwen-1", text: "change files" }),
      assistant({
        id: "a1",
        parent: "u1",
        provider: "travelSky",
        model: "qwen-1",
        text: "changed files",
      }),
    ]

    const adoption = SessionMetric.adoption({
      rows,
      parent: mid("u1"),
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
      ],
    })

    expect(adoption).toEqual({
      adoptedLines: 3,
      adoptedContent: "",
      deletedLines: 1,
    })
  })

  test("skips adoption payload when no files changed", () => {
    const rows = [
      user({ id: "u1", provider: "travelSky", model: "qwen-1", text: "answer only" }),
      assistant({
        id: "a1",
        parent: "u1",
        provider: "travelSky",
        model: "qwen-1",
        text: "no file changes",
      }),
    ]

    const adoption = SessionMetric.adoption({
      rows,
      parent: mid("u1"),
      provider: "travelSky",
      diffs: [],
    })

    expect(adoption).toBeUndefined()
  })

  test("builds generated line count and language from tool metadata when diffs are unavailable", () => {
    const rows = [
      user({ id: "u1", provider: "travelSky", model: "qwen-1", text: "change files" }),
      assistant({
        id: "a1",
        parent: "u1",
        provider: "travelSky",
        model: "qwen-1",
        text: "changed files",
        tools: [
          {
            name: "edit",
            status: "completed",
            metadata: {
              filediff: {
                file: "/tmp/src/edit.ts",
                status: "modified",
                additions: 3,
                deletions: 1,
                patch: "",
              },
            },
          },
          {
            name: "apply_patch",
            status: "completed",
            metadata: {
              files: [
                {
                  relativePath: "src/new.py",
                  type: "add",
                  additions: 2,
                  deletions: 0,
                  patch: "",
                },
                {
                  relativePath: "src/old.go",
                  type: "delete",
                  additions: 0,
                  deletions: 4,
                  patch: "",
                },
              ],
            },
          },
        ],
      }),
    ]

    const body = SessionMetric.build({
      rows,
      parent: mid("u1"),
      model: "qwen-1",
      provider: "travelSky",
      diffs: [],
    })

    expect(body?.generatedLines).toBe(5)
    expect(body?.adoptedLines).toBe(5)
    expect(body?.codeLanguage).toBe("TS")
  })

  test("keeps external tool file changes when snapshot diffs only cover the project", () => {
    const rows = [
      user({ id: "u1", provider: "travelSky", model: "qwen-1", text: "change project and external files" }),
      assistant({
        id: "a1",
        parent: "u1",
        provider: "travelSky",
        model: "qwen-1",
        text: "changed files",
        tools: [
          {
            name: "edit",
            status: "completed",
            metadata: {
              filediff: {
                file: "/tmp/src/project.ts",
                status: "modified",
                additions: 10,
                deletions: 10,
                patch: "",
              },
            },
          },
          {
            name: "write",
            status: "completed",
            metadata: {
              filediff: {
                file: "/Users/test/external/algorithm.ts",
                status: "added",
                additions: 5,
                deletions: 0,
                patch: "",
              },
            },
          },
        ],
      }),
    ]

    const body = SessionMetric.build({
      rows,
      parent: mid("u1"),
      model: "qwen-1",
      provider: "travelSky",
      diffs: [
        {
          file: "src/project.ts",
          status: "modified",
          additions: 2,
          deletions: 1,
          patch: "",
        },
      ],
    })

    expect(body?.generatedLines).toBe(7)
    expect(body?.adoptedLines).toBe(7)
    expect(body?.codeLanguage).toBe("TS")
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
      parent: mid("u1"),
      model: "gpt-5",
      provider: "openai",
    })

    expect(body).toBeUndefined()
  })
})
