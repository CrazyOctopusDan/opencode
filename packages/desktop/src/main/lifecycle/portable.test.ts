import { afterEach, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fallback } from "@opencode/client/service"
import { preparePortableData } from "./portable"

const keys = [
  "OPENCODE_PORTABLE_ROOT",
  "XDG_DATA_HOME",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "XDG_STATE_HOME",
  "TEMP",
  "TMP",
  "TMPDIR",
] as const
const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]))

afterEach(() => {
  keys.forEach((key) => {
    if (original[key] === undefined) delete process.env[key]
    else process.env[key] = original[key]
  })
})

test.each([false, true])("portable storage opt-in: %s", (portable) => {
  const directory = mkdtempSync(path.join(tmpdir(), "opencode-portable-"))
  try {
    const before = Object.fromEntries(keys.map((key) => [key, process.env[key]]))
    if (portable) mkdirSync(path.join(directory, "data"))
    const result = preparePortableData(directory)
    if (!portable) {
      expect(result).toBeUndefined()
      expect(Object.fromEntries(keys.map((key) => [key, process.env[key]]))).toEqual(before)
      return
    }

    expect(result).toEqual({
      userData: path.join(directory, "data", "desktop"),
      sessionData: path.join(directory, "data", "session"),
      temp: path.join(directory, "data", "tmp"),
    })
    expect(fallback()).toBe(path.join(directory, "data", "state", "opencode", "service.json"))
    expect(tmpdir()).toBe(path.join(directory, "data", "tmp"))
    keys.forEach((key) => {
      expect(
        process.env[key]?.startsWith(path.join(directory, "data") + path.sep) ||
          process.env[key] === path.join(directory, "data"),
      ).toBe(true)
      expect(statSync(process.env[key]!).isDirectory()).toBe(true)
    })
    const settings = path.join(directory, "data", "config", "existing.json")
    writeFileSync(settings, "existing settings")
    expect(preparePortableData(directory)).toEqual(result)
    expect(readFileSync(settings, "utf8")).toBe("existing settings")
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("an unusable portable data directory fails without switching back to user storage", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "opencode-portable-"))
  try {
    writeFileSync(path.join(directory, "data"), "not a directory")
    const before = Object.fromEntries(keys.map((key) => [key, process.env[key]]))
    expect(() => preparePortableData(directory)).toThrow()
    expect(Object.fromEntries(keys.map((key) => [key, process.env[key]]))).toEqual(before)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
