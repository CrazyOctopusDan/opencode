import { expect, test } from "bun:test"
import { cp, mkdir, mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { Service } from "@opencode/client/service"
import pkg from "../package.json"
import { stageName } from "../src/main/service/cli-version"

// This runs against the packaged Windows x64 app in CI, not the developer's installed Desktop.
test.skipIf(process.platform !== "win32" || !process.env.OPENCODE_DESKTOP_APP)(
  "unpacked Desktop starts its bundled service using portable storage",
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), "opencode-portable-startup-"))
    const directory = path.join(root, "win-unpacked")
    const file = path.join(directory, "data", "state", "opencode", "service.json")
    await cp(process.env.OPENCODE_DESKTOP_APP!, directory, { recursive: true })
    await mkdir(path.join(directory, "data"))
    const child = Bun.spawn([path.join(directory, "OpenCode.exe")], { stdout: "ignore", stderr: "ignore" })

    try {
      const deadline = Date.now() + 90_000
      while (!(await Service.discover({ file, version: pkg.version }))) {
        if (child.exitCode !== null) throw new Error(`Desktop exited with ${child.exitCode}`)
        if (Date.now() >= deadline) throw new Error("Desktop did not start its portable background service")
        await Bun.sleep(100)
      }
      expect(
        (await stat(path.join(directory, "data", "desktop", "cli", stageName(pkg.version), "opencode-cli.exe"))).size,
      ).toBeGreaterThan(0)
      expect((await stat(path.join(directory, "data", "share", "opencode"))).isDirectory()).toBe(true)
    } finally {
      if (child.exitCode === null)
        await Bun.spawn(["taskkill", "/PID", String(child.pid), "/T", "/F"], { stdout: "ignore", stderr: "ignore" })
          .exited
      await Service.stop({ file }).catch(() => undefined)
      await child.exited
      await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
    }
  },
  // A fresh packaged CLI and Electron startup includes Windows antivirus scanning.
  120_000,
)
