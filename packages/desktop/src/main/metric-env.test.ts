import { expect, test } from "bun:test"

test("desktop sidecar env marks metric tool name", async () => {
  const source = await Bun.file(new URL("./server.ts", import.meta.url)).text()

  expect(source).toContain('OPENCODE_TOOL_NAME: "opencode-desktop"')
})

test("wsl sidecar env marks metric tool name", async () => {
  const source = await Bun.file(new URL("./wsl/sidecar.ts", import.meta.url)).text()

  expect(source).toContain("export OPENCODE_TOOL_NAME=opencode-desktop")
})
