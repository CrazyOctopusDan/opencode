import { describe, expect, test } from "bun:test"
import { TravelSkyPrompt } from "../../src/travelsky/prompt"

describe("TravelSky model prompts", () => {
  test.each([
    ["dsv4", "deepseek"],
    ["DSV4-flash", "deepseek"],
    ["DeepSeek-V4", "deepseek"],
    ["Qwen3", "qwen"],
    ["qwq-32b", "qwen"],
    ["tongyi", "qwen"],
    ["GLM-5", "glm"],
    ["MiniMax-M2", "minimax"],
  ] as const)("selects company model %s", (id, expected) => {
    expect(TravelSkyPrompt.family({ id })).toBe(expected)
    expect(TravelSkyPrompt.instructions({ id })).toContain("software engineering")
  })

  test("prefers real model identifiers and uses display titles only for unknown aliases", () => {
    expect(TravelSkyPrompt.family({ id: "gpt-6-astra", name: "Qwen" })).toBeUndefined()
    expect(TravelSkyPrompt.family({ id: "dsv4", name: "Qwen" })).toBe("deepseek")
    expect(TravelSkyPrompt.family({ id: "company-model", name: "Qwen" })).toBe("qwen")
  })
})
