import { createStore, produce } from "solid-js/store"
import type { Event } from "@opencode-ai/sdk/v2/client"

type Last = {
  type: string
  at: number
  sessionID?: string
  messageID?: string
  partID?: string
}

type Sync = {
  at?: number
  mode?: "replace" | "prepend"
  before: number
  after: number
  overwrite: boolean
  lost: string[]
}

type Row = {
  sync: Sync
}

type Dir = {
  event: {
    total: number
    coalesce: number
    by: Record<string, number>
    last?: Last
  }
  health: {
    miss: number
    log: Array<{
      at: number
      kind: string
      reason?: string
      sessionID?: string
      messageID?: string
      partID?: string
      field?: string
      deltaLen?: number
    }>
  }
  session: Record<string, Row>
}

type MetricReason = "ready" | "missing-assistant" | "not-finished" | "provider"

type MetricInput = {
  finish?: string
  providerID?: string
  messageID?: string
  modelID?: string
}

type MetricEndpoint = {
  path: string
  visible: "client" | "server-only"
}

const baseSync = (): Sync => ({
  before: 0,
  after: 0,
  overwrite: false,
  lost: [],
})

const baseRow = (): Row => ({
  sync: baseSync(),
})

const baseDir = (): Dir => ({
  event: {
    total: 0,
    coalesce: 0,
    by: {},
  },
  health: {
    miss: 0,
    log: [],
  },
  session: {},
})

const [data, setData] = createStore<Record<string, Dir>>({})
const debugKey = "opencode:stream-debug"
const generationPath = "/ai/data/api/record/saveGeneration"
const adoptionPath = "/ai/data/api/record/addAdoption"

const debugOn = () => {
  if (typeof localStorage === "undefined") return false
  return localStorage.getItem(debugKey) === "1"
}

const debugOut = (type: string, props: Record<string, unknown>) => {
  if (!debugOn()) return
  console.info("[stream-debug]", type, props)
}

const setDebug = (on: boolean) => {
  if (typeof localStorage === "undefined") return
  if (on) {
    localStorage.setItem(debugKey, "1")
    return
  }
  localStorage.removeItem(debugKey)
}

const ensureDir = (dir: string) => {
  if (data[dir]) return
  setData(dir, baseDir())
}

const ensureRow = (dir: string, sessionID: string) => {
  ensureDir(dir)
  if (data[dir].session[sessionID]) return
  setData(dir, "session", sessionID, baseRow())
}

const rec = (value: unknown) => (value && typeof value === "object" ? (value as Record<string, unknown>) : undefined)

const finalFinish = (finish: string | undefined) => !!finish && !["tool-calls", "unknown"].includes(finish)

const travelsky = (providerID: string | undefined) => providerID?.trim().toLowerCase() === "travelsky"

const metric = (input: MetricInput) => {
  const reason: MetricReason = !input.messageID
    ? "missing-assistant"
    : !finalFinish(input.finish)
      ? "not-finished"
      : !travelsky(input.providerID)
        ? "provider"
        : "ready"
  return {
    eligible: reason === "ready",
    reason,
    finish: input.finish ?? "n/a",
    providerID: input.providerID ?? "n/a",
    messageID: input.messageID ?? "n/a",
    modelID: input.modelID ?? "n/a",
    generation: {
      path: generationPath,
      visible: "server-only",
    } satisfies MetricEndpoint,
    adoption: {
      path: adoptionPath,
      visible: "server-only",
    } satisfies MetricEndpoint,
  }
}

const pick = (evt: Event): Omit<Last, "at" | "type"> => {
  const props = rec(evt.properties)
  if (!props) return {}
  if (evt.type === "message.updated") {
    const info = rec(props.info)
    return {
      sessionID: typeof info?.sessionID === "string" ? info.sessionID : undefined,
      messageID: typeof info?.id === "string" ? info.id : undefined,
    }
  }
  if (evt.type === "message.part.updated") {
    const part = rec(props.part)
    return {
      sessionID: typeof part?.sessionID === "string" ? part.sessionID : undefined,
      messageID: typeof part?.messageID === "string" ? part.messageID : undefined,
      partID: typeof part?.id === "string" ? part.id : undefined,
    }
  }
  if (evt.type === "message.part.delta") {
    return {
      sessionID: typeof props.sessionID === "string" ? props.sessionID : undefined,
      messageID: typeof props.messageID === "string" ? props.messageID : undefined,
      partID: typeof props.partID === "string" ? props.partID : undefined,
    }
  }
  if (evt.type === "message.part.removed") {
    return {
      sessionID: typeof props.sessionID === "string" ? props.sessionID : undefined,
      messageID: typeof props.messageID === "string" ? props.messageID : undefined,
      partID: typeof props.partID === "string" ? props.partID : undefined,
    }
  }
  if (evt.type === "message.removed") {
    return {
      sessionID: typeof props.sessionID === "string" ? props.sessionID : undefined,
      messageID: typeof props.messageID === "string" ? props.messageID : undefined,
    }
  }
  return {}
}

export const SessionDiagnostic = {
  data,
  debugOn,
  setDebug,
  debugOut,
  metric,
  trace(input: {
    dir: string
    kind: string
    reason?: string
    sessionID?: string
    messageID?: string
    partID?: string
    field?: string
    deltaLen?: number
  }) {
    if (!debugOn()) return
    ensureDir(input.dir)
    const row = {
      at: Date.now(),
      kind: input.kind,
      reason: input.reason,
      sessionID: input.sessionID,
      messageID: input.messageID,
      partID: input.partID,
      field: input.field,
      deltaLen: input.deltaLen,
    }
    setData(
      input.dir,
      "health",
      "log",
      produce((draft) => {
        draft.push(row)
        if (draft.length > 30) draft.splice(0, draft.length - 30)
      }),
    )
    debugOut(input.kind, row)
  },
  event(input: { dir: string; evt: Event }) {
    ensureDir(input.dir)
    const id = pick(input.evt)
    const now = Date.now()
    setData(
      input.dir,
      produce((draft) => {
        draft.event.total++
        draft.event.by[input.evt.type] = (draft.event.by[input.evt.type] ?? 0) + 1
        draft.event.last = {
          type: input.evt.type,
          at: now,
          ...id,
        }
      }),
    )
  },
  coalesce(dir: string) {
    ensureDir(dir)
    setData(dir, "event", "coalesce", (value) => value + 1)
  },
  miss(dir: string) {
    ensureDir(dir)
    setData(dir, "health", "miss", (value) => value + 1)
  },
  drop(input: {
    dir: string
    reason: "stale_delta" | "missing_parts" | "missing_part"
    sessionID?: string
    messageID: string
    partID: string
    field?: string
    deltaLen?: number
  }) {
    ensureDir(input.dir)
    setData(input.dir, "health", "miss", (value) => value + 1)
    SessionDiagnostic.trace({
      ...input,
      kind: "drop",
    })
  },
  sync(input: {
    dir: string
    sessionID: string
    mode: "replace" | "prepend"
    before: number
    after: number
    lost: string[]
  }) {
    ensureRow(input.dir, input.sessionID)
    setData(
      input.dir,
      "session",
      input.sessionID,
      "sync",
      {
        at: Date.now(),
        mode: input.mode,
        before: input.before,
        after: input.after,
        overwrite: input.lost.length > 0,
        lost: input.lost.slice(0, 8),
      },
    )
  },
}
