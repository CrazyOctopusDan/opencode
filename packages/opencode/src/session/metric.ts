import type { MessageV2 } from "./message-v2"
import type { MessageID } from "./schema"

type Token = {
  input: number
  output: number
  reasoning: number
  cache: {
    read: number
    write: number
  }
  total: number
}

type Tool = {
  total: number
  by_name: Record<string, number>
  by_status: Record<string, number>
}

type Body = {
  text: string
  other: string
  modelName: string
}

function travel(input: string) {
  return input.trim().toLowerCase() === "travelsky"
}

function picks(input: { rows: MessageV2.WithParts[]; parent: MessageID }) {
  return input.rows.filter(
    (row): row is MessageV2.WithParts & { info: MessageV2.Assistant } =>
      row.info.role === "assistant" && row.info.parentID === input.parent && row.info.summary !== true,
  )
}

function count(input: string) {
  return Array.from(input).length
}

function text(input: MessageV2.WithParts[]) {
  const raw = input
    .flatMap((row) => row.parts)
    .filter((part): part is MessageV2.TextPart => part.type === "text" && !part.ignored)
    .map((part) => part.text)
    .join("")
  return String(count(raw))
}

function token(input: Array<MessageV2.WithParts & { info: MessageV2.Assistant }>): Token {
  return input.reduce(
    (acc, row) => ({
      input: acc.input + row.info.tokens.input,
      output: acc.output + row.info.tokens.output,
      reasoning: acc.reasoning + row.info.tokens.reasoning,
      cache: {
        read: acc.cache.read + row.info.tokens.cache.read,
        write: acc.cache.write + row.info.tokens.cache.write,
      },
      total:
        acc.total +
        (row.info.tokens.total ??
          row.info.tokens.input +
            row.info.tokens.output +
            row.info.tokens.reasoning +
            row.info.tokens.cache.read +
            row.info.tokens.cache.write),
    }),
    {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
      total: 0,
    },
  )
}

function tool(input: MessageV2.WithParts[]): Tool {
  return input
    .flatMap((row) => row.parts)
    .filter((part): part is MessageV2.ToolPart => part.type === "tool")
    .reduce(
      (acc, part) => ({
        total: acc.total + 1,
        by_name: {
          ...acc.by_name,
          [part.tool]: (acc.by_name[part.tool] ?? 0) + 1,
        },
        by_status: {
          ...acc.by_status,
          [part.state.status]: (acc.by_status[part.state.status] ?? 0) + 1,
        },
      }),
      { total: 0, by_name: {}, by_status: {} },
    )
}

export namespace SessionMetric {
  export type Input = {
    rows: MessageV2.WithParts[]
    parent: MessageID
    model: string
    provider: string
  }

  export function build(input: Input): Body | undefined {
    if (!travel(input.provider)) return
    const rows = picks({
      rows: input.rows,
      parent: input.parent,
    })
    if (rows.length === 0) return
    const out = {
      token: token(rows),
      tool: tool(rows),
    }
    return {
      text: text(rows),
      other: JSON.stringify(out),
      modelName: input.model,
    }
  }
}
