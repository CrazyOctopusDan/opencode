export * as TravelSkyPrompt from "./prompt.js"

import DEEPSEEK from "./prompts/deepseek.txt"
import QWEN from "./prompts/qwen.txt"
import GLM from "./prompts/glm.txt"
import MINIMAX from "./prompts/minimax.txt"

const prompts = { deepseek: DEEPSEEK, qwen: QWEN, glm: GLM, minimax: MINIMAX }

export function family(model: { id: string; name?: string }): keyof typeof prompts | undefined {
  const id = model.id.toLowerCase()
  // Real model identity wins over a display title that happens to mention another family.
  const exact = match(id)
  if (exact) return exact
  if (["gpt", "claude", "gemini", "kimi", "trinity", "muse"].some((name) => id.includes(name))) return
  return match(model.name?.toLowerCase() ?? "")
}

export function instructions(model: { id: string; name?: string }) {
  const selected = family(model)
  return selected ? prompts[selected] : undefined
}

function match(name: string): keyof typeof prompts | undefined {
  if (name.includes("deepseek") || name.includes("dsv4")) return "deepseek"
  if (["qwen", "qwq", "tongyi"].some((family) => name.includes(family))) return "qwen"
  if (name.includes("glm")) return "glm"
  if (name.includes("minimax")) return "minimax"
}
