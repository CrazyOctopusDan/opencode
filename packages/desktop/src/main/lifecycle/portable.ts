import { existsSync, mkdirSync } from "node:fs"
import path from "node:path"

// A data directory beside the Windows executable opts the unpacked app into portable storage.
export function preparePortableData(directory: string) {
  const root = path.join(directory, "data")
  if (!existsSync(root)) return undefined

  const paths = {
    userData: path.join(root, "desktop"),
    sessionData: path.join(root, "session"),
    temp: path.join(root, "tmp"),
  }
  const env = {
    OPENCODE_PORTABLE_ROOT: root,
    XDG_DATA_HOME: path.join(root, "share"),
    XDG_CONFIG_HOME: path.join(root, "config"),
    XDG_CACHE_HOME: path.join(root, "cache"),
    XDG_STATE_HOME: path.join(root, "state"),
    TEMP: paths.temp,
    TMP: paths.temp,
    TMPDIR: paths.temp,
  }

  // Do not fall back to C: if the portable directory is read-only or full.
  new Set([...Object.values(paths), ...Object.values(env)]).forEach((dir) => mkdirSync(dir, { recursive: true }))
  Object.assign(process.env, env)
  return paths
}
