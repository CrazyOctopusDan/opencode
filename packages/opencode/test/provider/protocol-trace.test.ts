import { expect, test } from "bun:test"
import { ProtocolTraceStore } from "../../src/provider/protocol-trace"

test("protocol trace reports tool-call success", () => {
  const id = `pt_test_${Date.now()}`
  ProtocolTraceStore.start({
    id,
    provider: "openai-compatible",
    model: "qwen3.5-27b",
    path: "/chat/completions",
    sessionID: "ses_1",
  })
  ProtocolTraceStore.upstream(id, {
    status: 200,
    type: "text/event-stream",
    sse: true,
  })
  ProtocolTraceStore.chunk(id, { ok: true, hasTool: true, finish: "tool-calls" })
  ProtocolTraceStore.hit(id, "tool_call")
  ProtocolTraceStore.done(id)

  const [row] = ProtocolTraceStore.read({ sessionID: "ses_1", limit: 1 })
  expect(row.id).toBe(id)
  expect(row.judge.level).toBe("ok")
  expect(row.judge.code).toBe("tool_call_detected")
})

test("protocol trace reports unknown finish", () => {
  const id = `pt_test_${Date.now()}_b`
  ProtocolTraceStore.start({
    id,
    provider: "openai-compatible",
    model: "qwen3.5-27b",
    path: "/chat/completions",
  })
  ProtocolTraceStore.chunk(id, { ok: true, finish: "unknown" })
  ProtocolTraceStore.done(id)

  const [row] = ProtocolTraceStore.read({ limit: 1 })
  expect(row.id).toBe(id)
  expect(row.judge.code).toBe("unknown_finish")
})
