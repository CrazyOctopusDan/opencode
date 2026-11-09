import { expect, test } from "bun:test"
import path from "node:path"

test("TravelSky credential RPC preserves encrypted storage and fails closed", async () => {
  // Electron's native module cannot run in Bun. Isolate its OS-keyring substitute from every other test file.
  const child = Bun.spawn([process.execPath, "test", path.join(import.meta.dir, "../../../test-fixtures/travelsky.ts")], {
    stdout: "pipe",
    stderr: "pipe",
  })

  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])

  expect({ code, output: code ? stdout + stderr : "passed" }).toEqual({ code: 0, output: "passed" })
}, 15_000)
