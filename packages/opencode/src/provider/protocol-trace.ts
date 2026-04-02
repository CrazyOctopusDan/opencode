const MAX = 50
const CUT = 220

type Upstream = {
  status?: number
  type?: string
  sse?: boolean
  first?: string
  last?: string
}

type Parsed = {
  chunk: number
  ok: number
  err: number
  text: number
  tool: number
  finish: Record<string, number>
  hit: {
    reasoning: boolean
    text: boolean
    tool_input_start: boolean
    tool_input_delta: boolean
    tool_input_end: boolean
    tool_call: boolean
  }
  code: Record<string, number>
}

type Judge = {
  level: "ok" | "warn" | "error"
  code: string
  note: string
  tip: string
  finish?: string
  tool: boolean
}

export type ProtocolTrace = {
  id: string
  at: number
  sessionID?: string
  provider: string
  model: string
  path: string
  upstream: Upstream
  parsed: Parsed
  judge: Judge
}

const list: ProtocolTrace[] = []

const trim = (text: string) => {
  const body = text.replace(/\s+/g, " ").trim()
  if (body.length <= CUT) return body
  return `${body.slice(0, CUT)}...`
}

const make = (id: string, input: { provider: string; model: string; path: string; sessionID?: string }): ProtocolTrace => ({
  id,
  at: Date.now(),
  sessionID: input.sessionID,
  provider: input.provider,
  model: input.model,
  path: input.path,
  upstream: {},
  parsed: {
    chunk: 0,
    ok: 0,
    err: 0,
    text: 0,
    tool: 0,
    finish: {},
    hit: {
      reasoning: false,
      text: false,
      tool_input_start: false,
      tool_input_delta: false,
      tool_input_end: false,
      tool_call: false,
    },
    code: {},
  },
  judge: {
    level: "warn",
    code: "pending",
    note: "trace in progress",
    tip: "wait for stream finish",
    tool: false,
  },
})

const pick = (id: string) => list.find((item) => item.id === id)

const addCode = (row: ProtocolTrace, code: string) => {
  row.parsed.code[code] = (row.parsed.code[code] ?? 0) + 1
}

const resolveJudge = (row: ProtocolTrace) => {
  const hasTool = row.parsed.hit.tool_call || row.parsed.tool > 0
  const [finish] = Object.entries(row.parsed.finish).sort((a, b) => b[1] - a[1])[0] ?? []
  if (hasTool) {
    row.judge = {
      level: "ok",
      code: "tool_call_detected",
      note: "tool-call detected",
      tip: "model output is tool-call compatible",
      finish,
      tool: true,
    }
    return
  }
  if (row.parsed.chunk === 0) {
    row.judge = {
      level: "error",
      code: "empty_stream",
      note: "no chunks parsed",
      tip: "check upstream response body and SSE framing",
      finish,
      tool: false,
    }
    return
  }
  if (row.parsed.err > 0) {
    row.judge = {
      level: "error",
      code: "chunk_schema_error",
      note: "chunk schema parse failed",
      tip: "check OpenAI-compatible chunk shape",
      finish,
      tool: false,
    }
    return
  }
  if ((finish ?? "") === "unknown") {
    row.judge = {
      level: "warn",
      code: "unknown_finish",
      note: "finish_reason is unknown",
      tip: "model may not emit compatible finish reason",
      finish,
      tool: false,
    }
    return
  }
  row.judge = {
    level: "warn",
    code: "no_delta_tool_calls",
    note: "no tool_calls in parsed chunks",
    tip: "model did not emit tool_calls in stream",
    finish,
    tool: false,
  }
}

export namespace ProtocolTraceStore {
  export function start(input: { id: string; provider: string; model: string; path: string; sessionID?: string }) {
    const row = make(input.id, input)
    list.push(row)
    if (list.length > MAX) list.splice(0, list.length - MAX)
    return row.id
  }

  export function upstream(id: string, input: { status?: number; type?: string; sse?: boolean }) {
    const row = pick(id)
    if (!row) return
    if (typeof input.status === "number") row.upstream.status = input.status
    if (typeof input.type === "string") row.upstream.type = input.type
    if (typeof input.sse === "boolean") row.upstream.sse = input.sse
  }

  export function frame(id: string, text: string) {
    const row = pick(id)
    if (!row) return
    const next = trim(text)
    if (!next) return
    if (!row.upstream.first) row.upstream.first = next
    row.upstream.last = next
  }

  export function chunk(id: string, input: {
    ok: boolean
    hasText?: boolean
    hasTool?: boolean
    finish?: string | null
  }) {
    const row = pick(id)
    if (!row) return
    row.parsed.chunk++
    if (input.ok) row.parsed.ok++
    if (!input.ok) row.parsed.err++
    if (input.hasText) {
      row.parsed.text++
      row.parsed.hit.text = true
    }
    if (input.hasTool) {
      row.parsed.tool++
    }
    const key = typeof input.finish === "string" && input.finish ? input.finish : ""
    if (key) row.parsed.finish[key] = (row.parsed.finish[key] ?? 0) + 1
  }

  export function hit(id: string, key: keyof ProtocolTrace["parsed"]["hit"]) {
    const row = pick(id)
    if (!row) return
    row.parsed.hit[key] = true
  }

  export function code(id: string, key: string) {
    const row = pick(id)
    if (!row) return
    addCode(row, key)
  }

  export function done(id: string) {
    const row = pick(id)
    if (!row) return
    resolveJudge(row)
  }

  export function read(input: { sessionID?: string; limit?: number } = {}) {
    const limit = Math.max(1, Math.min(input.limit ?? 12, MAX))
    return list
      .filter((item) => !input.sessionID || item.sessionID === input.sessionID)
      .slice(-limit)
      .reverse()
  }
}

