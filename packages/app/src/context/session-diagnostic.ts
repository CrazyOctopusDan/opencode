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
  }
  session: Record<string, Row>
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
  },
  session: {},
})

const [data, setData] = createStore<Record<string, Dir>>({})

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
