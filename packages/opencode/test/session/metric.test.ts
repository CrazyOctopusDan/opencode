import { describe, expect, test } from "bun:test"
import { ModelID, ProviderID } from "../../src/provider/schema"
import type { MessageV2 } from "../../src/session/message-v2"
import { SessionMetric } from "../../src/session/metric"
import { MessageID, PartID, SessionID } from "../../src/session/schema"

function msg(input: {
  id: string
  parent: string
  provider: string
  model: string
  text: string
  tool?: {
    name: string
    status: "completed" | "error" | "running" | "pending"
  }
  tokens: {
    input: number
    output: number
    reasoning: number
    read: number
    write: number
    total?: number
  }
}): MessageV2.WithParts {
  const id = MessageID.make(input.id)
  const parent = MessageID.make(input.parent)
  const sid = SessionID.make("s1")
  const model = ModelID.make(input.model)
  const provider = ProviderID.make(input.provider)
  const tools =
    input.tool
      ? [
          {
            id: PartID.ascending(),
            messageID: id,
            sessionID: sid,
            type: "tool" as const,
            callID: `${input.id}-call`,
            tool: input.tool.name,
            state:
              input.tool.status === "completed"
                ? {
                    status: "completed" as const,
                    input: {},
                    output: "ok",
                    title: "ok",
                    metadata: {},
                    time: { start: 1, end: 2 },
                  }
                : input.tool.status === "error"
                  ? {
                      status: "error" as const,
                      input: {},
                      error: "bad",
                      time: { start: 1, end: 2 },
                    }
                  : input.tool.status === "running"
                    ? {
                        status: "running" as const,
                        input: {},
                        time: { start: 1 },
                      }
                    : {
                        status: "pending" as const,
                        input: {},
                        raw: "",
                      },
          },
        ]
      : []

  return {
    info: {
      id,
      role: "assistant",
      sessionID: sid,
      parentID: parent,
      modelID: model,
      providerID: provider,
      mode: "build",
      agent: "build",
      path: { cwd: "/tmp", root: "/tmp" },
      cost: 0,
      time: { created: 1, completed: 2 },
      tokens: {
        total: input.tokens.total,
        input: input.tokens.input,
        output: input.tokens.output,
        reasoning: input.tokens.reasoning,
        cache: {
          read: input.tokens.read,
          write: input.tokens.write,
        },
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
      ...tools,
    ],
  }
}

describe("session metric", () => {
  test("builds payload from all assistant steps in one reply", () => {
    const rows = [
      msg({
        id: "a1",
        parent: "u1",
        provider: "travelSky",
        model: "qwen-1",
        text: "hello",
        tool: { name: "bash", status: "completed" },
        tokens: { input: 1, output: 2, reasoning: 3, read: 4, write: 5, total: 15 },
      }),
      msg({
        id: "a2",
        parent: "u1",
        provider: "travelSky",
        model: "qwen-1",
        text: "world",
        tool: { name: "bash", status: "error" },
        tokens: { input: 10, output: 20, reasoning: 30, read: 40, write: 50, total: 150 },
      }),
      msg({
        id: "a3",
        parent: "u2",
        provider: "travelSky",
        model: "qwen-2",
        text: "ignore",
        tokens: { input: 1, output: 1, reasoning: 1, read: 1, write: 1, total: 5 },
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
    expect(other.token).toEqual({
      input: 11,
      output: 22,
      reasoning: 33,
      cache: { read: 44, write: 55 },
      total: 165,
    })
    expect(other.tool.total).toBe(2)
    expect(other.tool.by_name).toEqual({ bash: 2 })
    expect(other.tool.by_status).toEqual({ completed: 1, error: 1 })
  })

  test("skips non-travelsky provider", () => {
    const rows = [
      msg({
        id: "a1",
        parent: "u1",
        provider: "openai",
        model: "gpt-5",
        text: "hello",
        tokens: { input: 1, output: 1, reasoning: 1, read: 1, write: 1, total: 5 },
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
