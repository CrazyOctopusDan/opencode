import type { MessageV2 } from "./message-v2"
import type { MessageID } from "./schema"
import type { Snapshot } from "@/snapshot"

type FileChangeV1 = {
  modified_files: number
  added_files: number
  deleted_files: number
  line_changes: {
    added: number
    deleted: number
    total: number
    net: number
  }
  language_distribution: Record<string, number>
  max_single_file_changed_lines: number
  repeated_modified_files: number
  by_file: Array<{
    file: string
    status: string
    language: string
    additions: number
    deletions: number
    changed_lines: number
  }>
}

type ConversationV2 = {
  user_messages: number
  agent_replies: number
  agent_steps: number
  tool_calls: number
  tool_call_type_distribution: Record<string, number>
  tool_call_success_rate: number
  tool_failures: number
  tool_failure_codes: Record<string, number>
  session_end_reason: "user_stop" | "model_error" | "tool_error" | "normal_end"
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

function assistants(input: MessageV2.WithParts[]) {
  return input.filter(
    (row): row is MessageV2.WithParts & { info: MessageV2.Assistant } =>
      row.info.role === "assistant" && row.info.summary !== true,
  )
}

function count(input: string) {
  return Array.from(input).length
}

function object(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input)
}

function text(input: MessageV2.WithParts[]) {
  return String(
    count(
      input
        .flatMap((row) => row.parts)
        .filter((part): part is MessageV2.TextPart => part.type === "text" && !part.ignored)
        .map((part) => part.text)
        .join(""),
    ),
  )
}

function language(input: string) {
  const ext = input.split(".").pop()?.toLowerCase()
  if (ext === "ts" || ext === "tsx") return "TS"
  if (ext === "js" || ext === "jsx" || ext === "mjs" || ext === "cjs") return "JS"
  if (ext === "rs") return "Rust"
  if (ext === "go") return "Go"
  if (ext === "java") return "Java"
  if (ext === "py") return "Python"
  if (ext === "kt" || ext === "kts") return "Kotlin"
  if (ext === "swift") return "Swift"
  if (ext === "c" || ext === "cc" || ext === "cpp" || ext === "cxx" || ext === "h" || ext === "hpp") return "C/C++"
  if (ext === "json") return "JSON"
  if (ext === "md" || ext === "mdx") return "Markdown"
  if (ext === "css" || ext === "scss" || ext === "less") return "CSS"
  if (ext === "html" || ext === "htm") return "HTML"
  return "Other"
}

function stringValue(input: unknown) {
  if (typeof input === "string" && input.trim()) return input
  if (typeof input === "number") return String(input)
  return undefined
}

function metadataString(input: Record<string, unknown> | undefined, keys: string[]) {
  return keys.map((key) => stringValue(input?.[key])).find((item) => item)
}

function relative(input: { row: MessageV2.WithParts & { info: MessageV2.Assistant }; file: string }) {
  const file = input.file.replaceAll("\\", "/")
  const root = input.row.info.path.root.replaceAll("\\", "/")
  if (file.startsWith(`${root}/`)) return file.slice(root.length + 1)
  const cwd = input.row.info.path.cwd.replaceAll("\\", "/")
  if (file.startsWith(`${cwd}/`)) return file.slice(cwd.length + 1)
  return file
}

function targetFiles(input: { row: MessageV2.WithParts & { info: MessageV2.Assistant }; part: MessageV2.ToolPart }) {
  if (input.part.state.status !== "completed") return []
  if (!["edit", "write", "apply_patch"].includes(input.part.tool)) return []
  const state = input.part.state
  const fromFiles = Array.isArray(state.metadata.files)
    ? state.metadata.files
        .map((item) =>
          object(item) ? metadataString(item, ["relativePath", "filePath", "filepath", "path"]) : undefined,
        )
        .filter((item): item is string => item !== undefined)
    : []
  const fromMetadata = [
    metadataString(state.metadata, ["filepath", "filePath", "path"]),
    object(state.metadata.filediff) ? stringValue(state.metadata.filediff.file) : undefined,
  ].filter((item): item is string => item !== undefined)
  const fromInput = [metadataString(state.input, ["filePath", "filepath", "path"])].filter(
    (item): item is string => item !== undefined,
  )
  return Array.from(
    new Set([...fromFiles, ...fromMetadata, ...fromInput].map((file) => relative({ row: input.row, file }))),
  )
}

function repeatedModifiedFiles(input: Array<MessageV2.WithParts & { info: MessageV2.Assistant }>) {
  const counts = input
    .flatMap((row) =>
      row.parts
        .filter((part): part is MessageV2.ToolPart => part.type === "tool")
        .flatMap((part) => targetFiles({ row, part })),
    )
    .reduce<Record<string, number>>((acc, file) => {
      acc[file] = (acc[file] ?? 0) + 1
      return acc
    }, {})
  return Object.values(counts).filter((item) => item > 1).length
}

function fileChange(input: {
  diffs?: Snapshot.FileDiff[]
  rows: Array<MessageV2.WithParts & { info: MessageV2.Assistant }>
}): FileChangeV1 {
  const list = (input.diffs ?? []).map((item) => ({
    file: item.file,
    status: item.status ?? "modified",
    language: language(item.file),
    additions: item.additions,
    deletions: item.deletions,
    changed_lines: item.additions + item.deletions,
  }))
  const added = list.reduce((acc, item) => acc + item.additions, 0)
  const deleted = list.reduce((acc, item) => acc + item.deletions, 0)
  return {
    modified_files: list.filter((item) => item.status === "modified").length,
    added_files: list.filter((item) => item.status === "added").length,
    deleted_files: list.filter((item) => item.status === "deleted").length,
    line_changes: {
      added,
      deleted,
      total: added + deleted,
      net: added - deleted,
    },
    language_distribution: list.reduce<Record<string, number>>((acc, item) => {
      acc[item.language] = (acc[item.language] ?? 0) + 1
      return acc
    }, {}),
    max_single_file_changed_lines: list.reduce((acc, item) => Math.max(acc, item.changed_lines), 0),
    repeated_modified_files: repeatedModifiedFiles(input.rows),
    by_file: list,
  }
}

function tools(input: MessageV2.WithParts[]) {
  return input.flatMap((row) => row.parts).filter((part): part is MessageV2.ToolPart => part.type === "tool")
}

function failureCode(input: MessageV2.ToolPart) {
  if (input.state.status !== "error") return undefined
  const fromMetadata = metadataString(input.state.metadata, ["code", "errorCode", "error_code"])
  if (fromMetadata) return fromMetadata
  const error = input.state.error.toLowerCase()
  if (error.includes("permission") || error.includes("denied") || error.includes("not allowed")) return "permission"
  if (error.includes("not found") || error.includes("no such file") || error.includes("enoent")) return "path"
  if (input.tool === "bash" || error.includes("command") || error.includes("exit code")) return "command"
  return "unknown"
}

function aborted(input: MessageV2.Assistant["error"]) {
  if (!input) return false
  const name = input.name.toLowerCase()
  const message = object(input.data) ? stringValue(input.data.message)?.toLowerCase() : undefined
  return name.includes("abort") || message?.includes("abort") === true || message?.includes("cancel") === true
}

function sessionEnd(input: {
  current: Array<MessageV2.WithParts & { info: MessageV2.Assistant }>
  currentToolFailures: MessageV2.ToolPart[]
}): ConversationV2["session_end_reason"] {
  const errors = input.current
    .map((row) => row.info.error)
    .filter((item): item is MessageV2.Assistant["error"] => !!item)
  if (errors.some(aborted)) return "user_stop"
  if (errors.length > 0) return "model_error"
  if (input.currentToolFailures.length > 0) return "tool_error"
  return "normal_end"
}

function conversation(input: {
  rows: MessageV2.WithParts[]
  current: Array<MessageV2.WithParts & { info: MessageV2.Assistant }>
}): ConversationV2 {
  const assistant = assistants(input.rows)
  const parts = tools(assistant)
  const completed = parts.filter((part) => part.state.status === "completed").length
  const failures = parts.filter((part) => part.state.status === "error")
  const currentFailures = tools(input.current).filter((part) => part.state.status === "error")
  return {
    user_messages: input.rows.filter((row) => row.info.role === "user" && !row.info.summary).length,
    agent_replies: assistant.length,
    agent_steps: assistant.flatMap((row) => row.parts).filter((part) => part.type === "step-finish").length,
    tool_calls: parts.length,
    tool_call_type_distribution: parts.reduce<Record<string, number>>((acc, part) => {
      acc[part.tool] = (acc[part.tool] ?? 0) + 1
      return acc
    }, {}),
    tool_call_success_rate: parts.length === 0 ? 0 : Number((completed / parts.length).toFixed(4)),
    tool_failures: failures.length,
    tool_failure_codes: failures.reduce<Record<string, number>>((acc, part) => {
      const code = failureCode(part) ?? "unknown"
      acc[code] = (acc[code] ?? 0) + 1
      return acc
    }, {}),
    session_end_reason: sessionEnd({
      current: input.current,
      currentToolFailures: currentFailures,
    }),
  }
}

export namespace SessionMetric {
  export type Input = {
    rows: MessageV2.WithParts[]
    parent: MessageID
    model: string
    provider: string
    diffs?: Snapshot.FileDiff[]
  }

  export function build(input: Input): Body | undefined {
    if (!travel(input.provider)) return
    const rows = picks({
      rows: input.rows,
      parent: input.parent,
    })
    if (rows.length === 0) return
    return {
      text: text(rows),
      other: JSON.stringify({
        v1: fileChange({ diffs: input.diffs, rows }),
        v2: conversation({
          rows: input.rows,
          current: rows,
        }),
      }),
      modelName: input.model,
    }
  }
}
