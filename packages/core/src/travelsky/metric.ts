export * as TravelSkyMetric from "./metric.js"

import path from "node:path"
import type { FileDiff } from "@opencode/schema/file-diff"
import type { SessionMessage } from "@opencode/schema/session-message"

// The company backend accepts at most 15 characters and does not accept development suffixes.
export const toolVersion = "2.2.5"

export function build(input: {
  sessionID: string
  root: string
  scope: string
  messages: readonly SessionMessage.Info[]
  diffs?: readonly FileDiff.Info[]
  client?: string
}) {
  const parent = input.messages.findLastIndex((message) => message.type === "user")
  const user = input.messages[parent]
  const rows = input.messages
    .slice(parent + 1)
    .filter((message): message is SessionMessage.Assistant => message.type === "assistant" && !message.error)
  const last = rows.at(-1)
  if (user?.type !== "user" || !last || last.model.providerID !== "travelSky" || last.finish !== "stop") return
  const metadata = rows.flatMap((row) =>
    row.content.flatMap((part) => {
      if (part.type !== "tool" || part.state.status !== "completed") return []
      const data = part.state.metadata
      return [data?.filediff, ...(Array.isArray(data?.files) ? data.files : [])].flatMap((value) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return []
        const file = [value.file, value.relativePath, value.filePath, value.filepath, value.path].find(
          (item): item is string => typeof item === "string" && item.length > 0,
        )
        if (!file) return []
        return [{ file, additions: count(value.additions), deletions: count(value.deletions) }]
      })
    }),
  )
  const resolved = (file: string) => path.resolve(input.root, file)
  const files = new Map<string, { additions: number; deletions: number }>()
  const final = new Set(input.diffs?.map((diff) => resolved(diff.file)))
  input.diffs?.forEach((diff) =>
    files.set(resolved(diff.file), { additions: count(diff.additions), deletions: count(diff.deletions) }),
  )
  metadata.forEach((diff) => {
    const file = resolved(diff.file)
    const relative = path.relative(input.scope, file)
    // An empty final diff is meaningful: an edit followed by a revert must contribute zero lines.
    if (
      final.has(file) ||
      (input.diffs !== undefined &&
        !relative.startsWith(`..${path.sep}`) &&
        relative !== ".." &&
        !path.isAbsolute(relative))
    )
      return
    const before = files.get(file)
    files.set(file, {
      additions: (before?.additions ?? 0) + diff.additions,
      deletions: (before?.deletions ?? 0) + diff.deletions,
    })
  })
  const totals = [...files.values()].reduce(
    (sum, file) => ({ added: sum.added + file.additions, deleted: sum.deleted + file.deletions }),
    { added: 0, deleted: 0 },
  )
  const languages = new Map<string, number>()
  files.forEach((_, file) => languages.set(language(file), (languages.get(language(file)) ?? 0) + 1))
  return {
    id: last.id,
    generation: {
      modelName: last.model.id,
      promptName: rows[0].agent,
      generatedLines: totals.added,
      adoptedLines: totals.added,
      sessionId: input.sessionID,
      codeLanguage: [...languages].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Other",
      toolName:
        user.metadata?.travelSkyClient === "desktop" || input.client === "desktop"
          ? "opencode-desktop"
          : "opencode-cli",
      toolVersion,
      ideName: "OpenCode",
      ideVersion: "",
      projectName: path.basename(input.root),
      requestContent: user.text ?? "",
      responseContent: rows
        .flatMap((row) => row.content.flatMap((part) => (part.type === "text" ? [part.text] : [])))
        .join(""),
    },
    adoption:
      totals.added + totals.deleted > 0
        ? { adoptedLines: totals.added, deletedLines: totals.deleted, adoptedContent: "" }
        : undefined,
  }
}

function count(value: unknown) {
  const number = typeof value === "number" || typeof value === "string" ? Number(value) : 0
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0
}

function language(file: string) {
  const extension = path.extname(file).slice(1).toLowerCase()
  const groups = {
    TS: ["ts", "tsx"],
    JS: ["js", "jsx", "mjs", "cjs"],
    Rust: ["rs"],
    Go: ["go"],
    Java: ["java"],
    Python: ["py"],
    Kotlin: ["kt", "kts"],
    Swift: ["swift"],
    "C/C++": ["c", "cc", "cpp", "cxx", "h", "hpp"],
    JSON: ["json"],
    Markdown: ["md", "mdx"],
    CSS: ["css", "scss", "less"],
    HTML: ["html", "htm"],
  }
  return Object.entries(groups).find(([, extensions]) => extensions.includes(extension))?.[0] ?? "Other"
}
