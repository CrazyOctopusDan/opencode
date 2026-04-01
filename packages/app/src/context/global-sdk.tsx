import type { Event } from "@opencode-ai/sdk/v2/client"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { createGlobalEmitter } from "@solid-primitives/event-bus"
import { batch, onCleanup } from "solid-js"
import z from "zod"
import { createSdkForServer } from "@/utils/server"
import { useLanguage } from "./language"
import { usePlatform } from "./platform"
import { useServer } from "./server"
import { useAuth } from "./auth"
import { SessionDiagnostic } from "./session-diagnostic"

const abortError = z.object({
  name: z.literal("AbortError"),
})

export const { use: useGlobalSDK, provider: GlobalSDKProvider } = createSimpleContext({
  name: "GlobalSDK",
  init: () => {
    const language = useLanguage()
    const server = useServer()
    const platform = usePlatform()
    const auth = useAuth()
    const abort = new AbortController()

    const currentServer = server.current
    if (!currentServer) throw new Error(language.t("error.globalSDK.noServerAvailable"))
    const canPlatform = (() => {
      if (!platform.fetch) return false
      try {
        const url = new URL(currentServer.http.url)
        const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1"
        return !loopback
      } catch {
        return false
      }
    })()
    // Prefer webview fetch for SSE first. In some desktop network stacks,
    // platform.fetch may buffer SSE chunks and flush late.
    let preferPlatform = false
    // Legacy behavior (for quick rollback):
    // let preferPlatform = canPlatform

    const emitter = createGlobalEmitter<{
      [key: string]: Event
    }>()

    type Queued = { directory: string; payload: Event }
    const FLUSH_FRAME_MS = 16
    const STREAM_YIELD_MS = 8
    const RECONNECT_DELAY_MS = 250

    let queue: Queued[] = []
    let buffer: Queued[] = []
    const coalesced = new Map<string, number>()
    // Legacy logic (for quick rollback): staleDeltas skips all delta for a part
    // once an updated event is seen in the same flush window.
    // const staleDeltas = new Set<string>()
    let timer: ReturnType<typeof setTimeout> | undefined
    let last = 0

    const deltaKey = (directory: string, messageID: string, partID: string) => `${directory}:${messageID}:${partID}`

    const key = (directory: string, payload: Event) => {
      if (payload.type === "session.status") return `session.status:${directory}:${payload.properties.sessionID}`
      if (payload.type === "lsp.updated") return `lsp.updated:${directory}`
      if (payload.type === "message.part.updated") {
        const part = payload.properties.part
        return `message.part.updated:${directory}:${part.messageID}:${part.id}`
      }
    }

    const flush = () => {
      if (timer) clearTimeout(timer)
      timer = undefined

      if (queue.length === 0) return

      const events = queue
      // Legacy logic (for quick rollback):
      // const skip = staleDeltas.size > 0 ? new Set(staleDeltas) : undefined
      const cut = new Map<string, number>()
      for (let i = 0; i < events.length; i++) {
        const event = events[i]
        if (event.payload.type !== "message.part.updated") continue
        const part = event.payload.properties.part
        cut.set(deltaKey(event.directory, part.messageID, part.id), i)
      }
      queue = buffer
      buffer = events
      queue.length = 0
      coalesced.clear()
      // Legacy logic (for quick rollback):
      // staleDeltas.clear()

      last = Date.now()
      batch(() => {
        for (let i = 0; i < events.length; i++) {
          const event = events[i]
          if (event.payload.type === "message.part.delta") {
            const props = event.payload.properties
            const k = deltaKey(event.directory, props.messageID, props.partID)
            const at = cut.get(k)
            if (at !== undefined && i < at) {
              SessionDiagnostic.trace({
                dir: event.directory,
                kind: "skip_stale_delta",
                reason: "stale_delta",
                sessionID: props.sessionID,
                messageID: props.messageID,
                partID: props.partID,
                field: props.field,
                deltaLen: props.delta.length,
              })
              SessionDiagnostic.drop({
                dir: event.directory,
                reason: "stale_delta",
                sessionID: props.sessionID,
                messageID: props.messageID,
                partID: props.partID,
                field: props.field,
                deltaLen: props.delta.length,
              })
              continue
            }
          }
          emitter.emit(event.directory, event.payload)
        }
      })

      buffer.length = 0
    }

    const schedule = () => {
      if (timer) return
      const elapsed = Date.now() - last
      timer = setTimeout(flush, Math.max(0, FLUSH_FRAME_MS - elapsed))
    }

    let streamErrorLogged = false
    const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
    const aborted = (error: unknown) => abortError.safeParse(error).success

    let attempt: AbortController | undefined
    const HEARTBEAT_TIMEOUT_MS = 15_000
    let lastEventAt = Date.now()
    let heartbeat: ReturnType<typeof setTimeout> | undefined
    const resetHeartbeat = () => {
      lastEventAt = Date.now()
      if (heartbeat) clearTimeout(heartbeat)
      heartbeat = setTimeout(() => {
        attempt?.abort()
      }, HEARTBEAT_TIMEOUT_MS)
    }
    const clearHeartbeat = () => {
      if (!heartbeat) return
      clearTimeout(heartbeat)
      heartbeat = undefined
    }

    void (async () => {
      while (!abort.signal.aborted) {
        const eventFetch = canPlatform && preferPlatform ? platform.fetch : undefined
        if (SessionDiagnostic.debugOn()) {
          SessionDiagnostic.trace({
            dir: "global",
            kind: "event_fetch_mode",
            reason: eventFetch ? "platform" : "webview",
          })
        }
        const eventSdk = createSdkForServer({
          signal: abort.signal,
          fetch: eventFetch,
          server: currentServer.http,
          token: auth.token(),
        })
        attempt = new AbortController()
        lastEventAt = Date.now()
        let seen = false
        const onAbort = () => {
          attempt?.abort()
        }
        abort.signal.addEventListener("abort", onAbort)
        try {
          const events = await eventSdk.global.event({
            signal: attempt.signal,
            onSseError: (error) => {
              if (aborted(error)) return
              if (streamErrorLogged) return
              streamErrorLogged = true
              console.error("[global-sdk] event stream error", {
                url: currentServer.http.url,
                fetch: eventFetch ? "platform" : "webview",
                error,
              })
            },
          })
          let yielded = Date.now()
          resetHeartbeat()
          for await (const event of events.stream) {
            seen = true
            resetHeartbeat()
            streamErrorLogged = false
            const directory = event.directory ?? "global"
            const payload = event.payload
            const k = key(directory, payload)
            if (k) {
              const i = coalesced.get(k)
              if (i !== undefined) {
                queue[i] = { directory, payload }
                SessionDiagnostic.coalesce(directory)
                if (payload.type === "message.part.updated" && SessionDiagnostic.debugOn()) {
                  const part = payload.properties.part
                  SessionDiagnostic.trace({
                    dir: directory,
                    kind: "coalesce_updated",
                    sessionID: part.sessionID,
                    messageID: part.messageID,
                    partID: part.id,
                  })
                  SessionDiagnostic.debugOut("coalesce_updated", {
                    dir: directory,
                    messageID: part.messageID,
                    partID: part.id,
                  })
                }
                continue
              }
              coalesced.set(k, queue.length)
            }
            queue.push({ directory, payload })
            if (SessionDiagnostic.debugOn() && payload.type === "message.part.delta") {
              const props = payload.properties
              SessionDiagnostic.trace({
                dir: directory,
                kind: "recv_delta",
                sessionID: props.sessionID,
                messageID: props.messageID,
                partID: props.partID,
                field: props.field,
                deltaLen: props.delta.length,
              })
              SessionDiagnostic.debugOut("recv_delta", {
                dir: directory,
                sessionID: props.sessionID,
                messageID: props.messageID,
                partID: props.partID,
                field: props.field,
                deltaLen: props.delta.length,
              })
            }
            if (SessionDiagnostic.debugOn() && payload.type === "message.part.updated") {
              const part = payload.properties.part
              SessionDiagnostic.trace({
                dir: directory,
                kind: "recv_updated",
                sessionID: part.sessionID,
                messageID: part.messageID,
                partID: part.id,
              })
              SessionDiagnostic.debugOut("recv_updated", {
                dir: directory,
                sessionID: part.sessionID,
                messageID: part.messageID,
                partID: part.id,
                type: part.type,
                hasEnd: "time" in part && part.time && "end" in part.time ? !!part.time.end : undefined,
                textLen: part.type === "text" ? part.text.length : undefined,
              })
            }
            SessionDiagnostic.event({ dir: directory, evt: payload })
            schedule()

            if (Date.now() - yielded < STREAM_YIELD_MS) continue
            yielded = Date.now()
            await wait(0)
          }
        } catch (error) {
          if (SessionDiagnostic.debugOn()) {
            SessionDiagnostic.trace({
              dir: "global",
              kind: "event_stream_error",
              reason: "stream_failed",
            })
          }
          if (!aborted(error) && !streamErrorLogged) {
            streamErrorLogged = true
            console.error("[global-sdk] event stream failed", {
              url: currentServer.http.url,
              fetch: eventFetch ? "platform" : "webview",
              error,
            })
          }
        } finally {
          abort.signal.removeEventListener("abort", onAbort)
          attempt = undefined
          clearHeartbeat()
        }

        if (abort.signal.aborted) return
        if (canPlatform && !seen) {
          if (SessionDiagnostic.debugOn()) {
            SessionDiagnostic.trace({
              dir: "global",
              kind: "event_fetch_switch",
              reason: preferPlatform ? "platform_to_webview" : "webview_to_platform",
            })
          }
          preferPlatform = !preferPlatform
        }
        await wait(RECONNECT_DELAY_MS)
      }
    })().finally(flush)

    const onVisibility = () => {
      if (typeof document === "undefined") return
      if (document.visibilityState !== "visible") return
      if (Date.now() - lastEventAt < HEARTBEAT_TIMEOUT_MS) return
      attempt?.abort()
    }
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibility)
    }

    onCleanup(() => {
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility)
      }
      abort.abort()
      flush()
    })

    const sdk = createSdkForServer({
      server: server.current.http,
      fetch: platform.fetch,
      throwOnError: true,
      token: auth.token(),
    })

    return {
      url: currentServer.http.url,
      client: sdk,
      event: emitter,
      createClient(opts: Omit<Parameters<typeof createSdkForServer>[0], "server" | "fetch">) {
        const s = server.current
        if (!s) throw new Error(language.t("error.globalSDK.serverNotAvailable"))
        return createSdkForServer({
          server: s.http,
          fetch: platform.fetch,
          token: auth.token(),
          ...opts,
        })
      },
    }
  },
})
