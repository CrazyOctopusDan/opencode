import type { MessageV2 } from "./message-v2"
import type { MessageID } from "./schema"
import { Flag } from "@opencode-ai/core/flag/flag"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
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

type Body = {
  moduleName: string
  promptName: string
  generatedLines: string
  sessionId: string
  codeLanguage: string
  toolName: "opencode-desktop" | "opencode-cli"
  toolVersion: string
  ideName: string
  ideVersion: string
  projectName: string
  requestContent: string
  responseContent: string
}

type AdoptionBody = {
  adoptedLines: string
  adoptedContent: string
  deletedLines: string
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

function object(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input)
}

function content(input: MessageV2.WithParts[]) {
  return input
    .flatMap((row) => row.parts)
    .filter((part): part is MessageV2.TextPart => part.type === "text" && !part.ignored)
    .map((part) => part.text)
    .join("")
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

function numberValue(input: unknown) {
  if (typeof input === "number" && Number.isFinite(input)) return input
  if (typeof input === "string" && input.trim()) {
    const parsed = Number(input)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function statusValue(input: unknown): "added" | "deleted" | "modified" | undefined {
  if (input === "added" || input === "add") return "added"
  if (input === "deleted" || input === "delete") return "deleted"
  if (input === "modified" || input === "modify" || input === "update" || input === "move") return "modified"
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

function metadataDiff(input: {
  row: MessageV2.WithParts & { info: MessageV2.Assistant }
  value: unknown
}): Snapshot.FileDiff[] {
  if (!object(input.value)) return []
  const file = metadataString(input.value, ["relativePath", "filePath", "filepath", "path", "file"])
  const additions = numberValue(input.value.additions)
  const deletions = numberValue(input.value.deletions)
  if (!file || additions === undefined || deletions === undefined) return []
  return [
    {
      file: relative({ row: input.row, file }),
      status: statusValue(input.value.status ?? input.value.type) ?? "modified",
      additions,
      deletions,
      patch: stringValue(input.value.patch),
    },
  ]
}

function toolDiffs(input: Array<MessageV2.WithParts & { info: MessageV2.Assistant }>) {
  return input.flatMap((row) =>
    row.parts
      .filter((part): part is MessageV2.ToolPart => part.type === "tool")
      .flatMap((part) => {
        if (part.state.status !== "completed") return []
        if (!["edit", "write", "apply_patch"].includes(part.tool)) return []
        return [
          ...metadataDiff({ row, value: part.state.metadata.filediff }),
          ...(Array.isArray(part.state.metadata.files)
            ? part.state.metadata.files.flatMap((item) => metadataDiff({ row, value: item }))
            : []),
        ]
      }),
  )
}

function fileChange(input: {
  diffs?: Snapshot.FileDiff[]
  rows: Array<MessageV2.WithParts & { info: MessageV2.Assistant }>
}): FileChangeV1 {
  const diffs = input.diffs ?? []
  const fromTools = toolDiffs(input.rows)
  const source = diffs.length
    ? [...diffs, ...fromTools.filter((item) => item.file && !diffs.some((diff) => diff.file === item.file))]
    : fromTools
  const list = Array.from(
    source
      .flatMap((item) => {
        if (!item.file) return []
        return [
          {
            file: item.file,
            status: item.status ?? "modified",
            language: language(item.file),
            additions: item.additions,
            deletions: item.deletions,
            changed_lines: item.additions + item.deletions,
          },
        ]
      })
      .reduce<
        Map<
          string,
          {
            file: string
            status: string
            language: string
            additions: number
            deletions: number
            changed_lines: number
          }
        >
      >((acc, item) => {
        const hit = acc.get(item.file)
        if (!hit) {
          acc.set(item.file, item)
          return acc
        }
        hit.status = item.status
        hit.additions += item.additions
        hit.deletions += item.deletions
        hit.changed_lines = hit.additions + hit.deletions
        return acc
      }, new Map())
      .values(),
  )
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

function prompt(input: { rows: MessageV2.WithParts[]; parent: MessageID }) {
  return input.rows.find((row) => row.info.role === "user" && row.info.id === input.parent && !row.info.summary)
}

function dominant(input: FileChangeV1) {
  return Object.entries(input.language_distribution).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Other"
}

function projectName(input: MessageV2.WithParts & { info: MessageV2.Assistant }) {
  return input.info.path.root.replaceAll("\\", "/").split("/").filter(Boolean).pop() ?? input.info.path.root
}

function toolName(): Body["toolName"] {
  if (Flag.OPENCODE_TOOL_NAME === "opencode-desktop" || Flag.OPENCODE_TOOL_NAME === "opencode-cli") {
    return Flag.OPENCODE_TOOL_NAME
  }
  if (Flag.OPENCODE_CLIENT === "desktop") return "opencode-desktop"
  return "opencode-cli"
}

export namespace SessionMetric {
  export type Input = {
    rows: MessageV2.WithParts[]
    parent: MessageID
    model: string
    provider: string
    diffs?: Snapshot.FileDiff[]
  }

  export type AdoptionInput = Omit<Input, "model">

  export function build(input: Input): Body | undefined {
    if (!travel(input.provider)) return
    const rows = picks({
      rows: input.rows,
      parent: input.parent,
    })
    if (rows.length === 0) return
    const request = prompt({
      rows: input.rows,
      parent: input.parent,
    })
    const changes = fileChange({ diffs: input.diffs, rows })
    return {
      moduleName: input.model,
      promptName: rows[0].info.agent,
      generatedLines: String(changes.line_changes.added),
      sessionId: rows[0].info.sessionID,
      codeLanguage: dominant(changes),
      toolName: toolName(),
      toolVersion: InstallationVersion,
      ideName: "OpenCode",
      ideVersion: InstallationVersion,
      projectName: projectName(rows[0]),
      requestContent: request ? content([request]) : "",
      responseContent: content(rows),
    }
  }

  export function adoption(input: AdoptionInput): AdoptionBody | undefined {
    if (!travel(input.provider)) return
    const rows = picks({
      rows: input.rows,
      parent: input.parent,
    })
    if (rows.length === 0) return
    const changes = fileChange({ diffs: input.diffs, rows })
    if (changes.line_changes.total === 0) return
    return {
      adoptedLines: String(changes.line_changes.added),
      adoptedContent: "",
      deletedLines: String(changes.line_changes.deleted),
    }
  }
}
