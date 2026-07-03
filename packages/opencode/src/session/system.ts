import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Context, Effect, Layer } from "effect"

import { InstanceState } from "@/effect/instance-state"

import PROMPT_ANTHROPIC from "./prompt/anthropic.txt"
import PROMPT_DEFAULT from "./prompt/default.txt"
import PROMPT_BEAST from "./prompt/beast.txt"
import PROMPT_GEMINI from "./prompt/gemini.txt"
import PROMPT_GPT from "./prompt/gpt.txt"
import PROMPT_KIMI from "./prompt/kimi.txt"

import PROMPT_CODEX from "./prompt/codex.txt"
import PROMPT_DEEPSEEK from "./prompt/deepseek.txt"
import PROMPT_GLM from "./prompt/glm.txt"
import PROMPT_MINIMAX from "./prompt/minimax.txt"
import PROMPT_QWEN from "./prompt/qwen.txt"
import PROMPT_TRINITY from "./prompt/trinity.txt"
import type { Provider } from "@/provider/provider"
import type { Agent } from "@/agent/agent"
import { Permission } from "@/permission"
import { Skill } from "@/skill"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-layer"
import { PluginBoot } from "@opencode-ai/core/plugin/boot"
import { Reference } from "@opencode-ai/core/reference"

export function provider(model: Provider.Model) {
  const exact = [model.id, model.api.id].join(" ").toLowerCase()
  const display = [model.name, model.providerID].join(" ").toLowerCase()
  const includes = (values: string[], input = exact) => values.some((value) => input.includes(value))

  if (includes(["gpt-4", "o1", "o3"])) return [PROMPT_BEAST]
  if (includes(["gpt"])) {
    if (includes(["codex"])) {
      return [PROMPT_CODEX]
    }
    return [PROMPT_GPT]
  }
  if (includes(["gemini-"])) return [PROMPT_GEMINI]
  if (includes(["claude"])) return [PROMPT_ANTHROPIC]
  if (includes(["dsv4", "deepseek-v4", "deepseek"])) return [PROMPT_DEEPSEEK]
  if (includes(["qwen", "qwq", "tongyi"])) return [PROMPT_QWEN]
  if (includes(["glm"])) return [PROMPT_GLM]
  if (includes(["minimax"])) return [PROMPT_MINIMAX]
  if (includes(["trinity"])) return [PROMPT_TRINITY]
  if (includes(["kimi"])) return [PROMPT_KIMI]
  if (includes(["dsv4", "deepseek-v4", "deepseek"], display)) return [PROMPT_DEEPSEEK]
  if (includes(["qwen", "qwq", "tongyi"], display)) return [PROMPT_QWEN]
  if (includes(["glm"], display)) return [PROMPT_GLM]
  if (includes(["minimax"], display)) return [PROMPT_MINIMAX]
  if (includes(["trinity"], display)) return [PROMPT_TRINITY]
  if (includes(["kimi"], display)) return [PROMPT_KIMI]
  return [PROMPT_DEFAULT]
}

export interface Interface {
  readonly environment: (model: Provider.Model) => Effect.Effect<string[]>
  readonly skills: (agent: Agent.Info) => Effect.Effect<string | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SystemPrompt") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const skill = yield* Skill.Service
    const locations = yield* LocationServiceMap

    return Service.of({
      environment: Effect.fn("SystemPrompt.environment")(function* (model: Provider.Model) {
        const ctx = yield* InstanceState.context
        const references = yield* Effect.gen(function* () {
          yield* (yield* PluginBoot.Service).wait()
          return (yield* (yield* Reference.Service).list()).filter((reference) => reference.description !== undefined)
        }).pipe(Effect.provide(locations.get(Location.Ref.make({ directory: AbsolutePath.make(ctx.directory) }))))
        return [
          [
            `You are powered by the model named ${model.api.id}. The exact model ID is ${model.providerID}/${model.api.id}`,
            `Here is some useful information about the environment you are running in:`,
            `<env>`,
            `  Working directory: ${ctx.directory}`,
            `  Workspace root folder: ${ctx.worktree}`,
            `  Is directory a git repo: ${ctx.project.vcs === "git" ? "yes" : "no"}`,
            `  Platform: ${process.platform}`,
            `  Today's date: ${new Date().toDateString()}`,
            `</env>`,
          ].join("\n"),
          `IMPORTANT: Your response must ALWAYS strictly follow the same major language as the user.`,
          references.length === 0
            ? undefined
            : [
                "Project references provide additional directories that can be accessed when relevant.",
                "<available_references>",
                ...references
                  .toSorted((a, b) => a.name.localeCompare(b.name))
                  .flatMap((reference) => [
                    "  <reference>",
                    `    <name>${reference.name}</name>`,
                    `    <path>${reference.path}</path>`,
                    ...(reference.description === undefined
                      ? []
                      : [`    <description>${reference.description}</description>`]),
                    "  </reference>",
                  ]),
                "</available_references>",
              ].join("\n"),
        ].filter((part): part is string => part !== undefined)
      }),

      skills: Effect.fn("SystemPrompt.skills")(function* (agent: Agent.Info) {
        if (Permission.disabled(["skill"], agent.permission).has("skill")) return

        const list = yield* skill.available(agent)

        return [
          "Skills provide specialized instructions and workflows for specific tasks.",
          "Use the skill tool to load a skill when a task matches its description.",
          // the agents seem to ingest the information about skills a bit better if we present a more verbose
          // version of them here and a less verbose version in tool description, rather than vice versa.
          Skill.fmt(list, { verbose: true }),
        ].join("\n")
      }),
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Skill.defaultLayer), Layer.provide(LocationServiceMap.layer))

const locationServiceMapNode = LayerNode.make(LocationServiceMap.layer, [])

export const node = LayerNode.make(layer, [Skill.node, locationServiceMapNode])

export * as SystemPrompt from "./system"
