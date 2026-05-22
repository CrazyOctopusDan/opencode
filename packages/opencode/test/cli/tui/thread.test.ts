import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { tmpdir } from "../../fixture/fixture"
import { resolveThreadDirectory } from "../../../src/cli/cmd/tui/thread"
import * as App from "../../../src/cli/cmd/tui/app"
import { Rpc } from "../../../src/util/rpc"
import { UI } from "../../../src/cli/ui"
import * as Timeout from "../../../src/util/timeout"
import * as Win32 from "../../../src/cli/cmd/tui/win32"
import { TuiConfig } from "../../../src/cli/cmd/tui/config/tui"
import * as TravelSky from "../../../src/cli/travelsky/bootstrap"
import * as Validate from "../../../src/cli/cmd/tui/validate-session"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"

const stop = new Error("stop")
const seen = {
  tui: [] as string[],
  auth: [] as string[],
}

function auth(input: RequestInit["headers"]) {
  if (!input) return
  if (Array.isArray(input)) return input.find((item) => item[0].toLowerCase() === "authorization")?.[1]
  if (input instanceof Headers) return input.get("authorization") ?? undefined
  if ("Authorization" in input && typeof input.Authorization === "string") return input.Authorization
  if ("authorization" in input && typeof input.authorization === "string") return input.authorization
}

function setup() {
  spyOn(App, "tui").mockImplementation(async (input) => {
    if (input.directory) seen.tui.push(input.directory)
    const value = auth(input.headers)
    if (value) seen.auth.push(value)
    throw stop
  })
  spyOn(Rpc, "client").mockImplementation(() => ({
    call: async () => ({ url: "http://127.0.0.1" }) as never,
    on: () => () => {},
  }))
  spyOn(UI, "error").mockImplementation(() => {})
  spyOn(Timeout, "withTimeout").mockImplementation((input) => input)
  spyOn(Win32, "win32DisableProcessedInput").mockImplementation(() => {})
  spyOn(Win32, "win32InstallCtrlCGuard").mockReturnValue(undefined)
  spyOn(TuiConfig, "get").mockResolvedValue(createTuiResolvedConfig())
  spyOn(TravelSky, "ensureLogin").mockResolvedValue("Bearer test")
}

describe("tui thread", () => {
  afterEach(() => {
    mock.restore()
  })

  async function call(input: { project?: string; session?: string } = {}) {
    const { TuiThreadCommand } = await import("../../../src/cli/cmd/tui/thread")
    return TuiThreadCommand.handler({
      _: [],
      $0: "opencode",
      project: input.project,
      prompt: "hi",
      model: undefined,
      agent: undefined,
      session: input.session,
      continue: false,
      fork: false,
      port: 0,
      hostname: "127.0.0.1",
      mdns: false,
      "mdns-domain": "opencode.local",
      mdnsDomain: "opencode.local",
      cors: [],
    })
  }

  async function check(input: { project?: string; session?: string } = {}) {
    setup()
    await using tmp = await tmpdir({ git: true })
    const cwd = process.cwd()
    const pwd = process.env.PWD
    const worker = globalThis.Worker
    const tty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY")
    const link = path.join(path.dirname(tmp.path), path.basename(tmp.path) + "-link")
    const type = process.platform === "win32" ? "junction" : "dir"
    seen.tui.length = 0
    seen.auth.length = 0

    try {
      await fs.symlink(tmp.path, link, type)
      Object.defineProperty(process.stdin, "isTTY", {
        configurable: true,
        value: true,
      })
      globalThis.Worker = class extends EventTarget {
        onerror = null
        onmessage = null
        onmessageerror = null
        postMessage() {}
        terminate() {}
      } as unknown as typeof Worker

      process.chdir(tmp.path)
      process.env.PWD = link
      expect(resolveThreadDirectory(input.project, link, tmp.path)).toBe(tmp.path)
      await expect(call(input)).rejects.toBe(stop)
      expect(seen.tui[0]).toBe(tmp.path)
      expect(seen.auth[0]).toBe("Bearer test")
    } finally {
      process.chdir(cwd)
      if (pwd === undefined) delete process.env.PWD
      else process.env.PWD = pwd
      if (tty) Object.defineProperty(process.stdin, "isTTY", tty)
      else delete (process.stdin as { isTTY?: boolean }).isTTY
      globalThis.Worker = worker
      await fs.rm(link, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  test("uses the real cwd when PWD points at a symlink", async () => {
    await check()
  })

  test("uses the real cwd after resolving a relative project from PWD", async () => {
    await check({ project: "." })
  })

  test("passes TravelSky auth when validating an explicit session", async () => {
    const seenValidate: Parameters<typeof Validate.validateSession>[0][] = []
    spyOn(Validate, "validateSession").mockImplementation(async (input) => {
      seenValidate.push(input)
    })

    await check({ session: "ses_test" })

    expect(auth(seenValidate[0]?.headers)).toBe("Bearer test")
  })
})
