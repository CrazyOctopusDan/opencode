import { expect, test } from "bun:test"

test("node server build injects installation version for desktop sidecar metrics", async () => {
  const source = await Bun.file(new URL("../../script/build-node.ts", import.meta.url)).text()

  expect(source).toContain("OPENCODE_VERSION")
  expect(source).toContain("Script.version")
})

test("cli binary build injects metric tool name", async () => {
  const source = await Bun.file(new URL("../../script/build.ts", import.meta.url)).text()

  expect(source).toContain("OPENCODE_TOOL_NAME")
  expect(source).toContain("opencode-cli")
})
