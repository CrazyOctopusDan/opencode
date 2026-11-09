import { SystemPart } from "@opencode/ai/effect"
import type { SessionHooks } from "@opencode/plugin/effect/session"
import { TravelSkyPrompt } from "../../travelsky/prompt.js"
import { define } from "@opencode/plugin/effect/plugin"
import { Effect, Schedule, Stream } from "effect"
import { Credential } from "../../credential.js"
import { Model } from "../../model.js"
import { TravelSkyAuth } from "../../travelsky/auth.js"
import type { PluginInternal } from "../internal.js"

export const TravelSkyPlugin = define({
  id: "opencode.provider.travelsky",
  effect: Effect.fn(function* (ctx) {
    const auth = yield* TravelSkyAuth.Service
    const loaded = { current: yield* auth.snapshot() }
    if (!loaded.current.status.enabled) return

    yield* ctx.integration.transform((integrations) => {
      for (const item of integrations.list()) integrations.remove(item.id)
    })
    yield* ctx.provider.transform((providers) => {
      for (const item of providers.list()) providers.remove(item.provider.id)
      if (!loaded.current.status.authenticated) return
      const models = new Map(
        loaded.current.models.flatMap((provider) =>
          provider.models.map(
            (model) =>
              [
                model.id,
                { ...model, baseURL: model.baseURL ?? provider.baseURL, apiKey: model.apiKey ?? provider.apiKey },
              ] as const,
          ),
        ),
      )
      if (models.size === 0) return
      providers.update("travelSky", (provider) => {
        provider.name = "TravelSky"
        provider.activation = "enabled"
        provider.package = "@opencode/ai/providers/openai-compatible"
        provider.settings = { provider: "travelSky" }
      })
      for (const model of models.values()) {
        providers.models.update("travelSky", model.id, (draft) => {
          draft.modelID = Model.ID.make(model.id)
          draft.name = model.name
          draft.family = Model.Family.make(TravelSkyPrompt.family(model) ?? model.id.toLowerCase())
          draft.capabilities = { tools: true, input: ["text", "image", "pdf"], output: ["text"] }
          draft.limit = { context: model.contextLength ?? 32_000, output: model.maxTokens ?? 8_192 }
          // Model routes may use different hosts and credentials within one company provider.
          draft.settings = { baseURL: model.baseURL, apiKey: model.apiKey ?? "" }
        })
      }
    })

    const prompt = (event: SessionHooks["context"]) =>
      Effect.gen(function* () {
        if (event.model.providerID !== "travelSky") return
        const model = loaded.current.models
          .flatMap((provider) => provider.models)
          .find((model) => model.id === event.model.id)
        const template = model && TravelSkyPrompt.instructions(model)
        if (template && !(yield* ctx.agent.get({ agentID: event.agent })).data.system)
          event.system.push(SystemPart.make(template))
        event.system.push(
          SystemPart.make("IMPORTANT: Your response must ALWAYS strictly follow the same major language as the user."),
        )
      }).pipe(Effect.catch(() => Effect.void))
    yield* ctx.session.hook("context", prompt)
    yield* ctx.session.hook("compaction", prompt)
    yield* ctx.session.hook("generate", prompt)

    const refresh = Effect.fn("TravelSkyPlugin.refresh")(function* () {
      const next = yield* auth.snapshot()
      if (JSON.stringify(next) === JSON.stringify(loaded.current)) return
      loaded.current = next
      yield* ctx.provider.reload()
    })
    // A previously resolved model must not outlive company access. This hook runs before every provider turn,
    // including auxiliary requests; hook failures abort the request rather than silently using the cached route.
    yield* ctx.session.hook("model.request", (event) =>
      Effect.gen(function* () {
        yield* refresh()
        if (!loaded.current.status.authenticated)
          return yield* Effect.die(new Error("TravelSky login required. Sign in again to continue."))
        if (
          event.model.providerID !== "travelSky" ||
          !loaded.current.models.some((provider) => provider.models.some((model) => model.id === event.model.id))
        )
          return yield* Effect.die(new Error("This model is not available in your TravelSky account."))
        const provider = loaded.current.models.find((provider) =>
          provider.models.some((model) => model.id === event.model.id),
        )
        const model = provider?.models.find((model) => model.id === event.model.id)
        event.baseURL = model?.baseURL ?? provider?.baseURL
      }),
    )
    // A running Session may still hold a model resolved before the catalog refreshed. Replace its wire credential
    // after the native route's auth step, which otherwise reapplies the old API key over model.request headers.
    yield* ctx.session.hook("http.request", (event) =>
      Effect.sync(() => {
        const provider = loaded.current.models.find((provider) =>
          provider.models.some((model) => model.id === event.model.id),
        )
        const model = provider?.models.find((model) => model.id === event.model.id)
        const key = model?.apiKey ?? provider?.apiKey
        event.request.headers.delete("authorization")
        if (key) event.request.headers.set("authorization", `Bearer ${key}`)
      }),
    )
    yield* ctx.event
      .subscribe({ types: [Credential.Event.Updated.type] })
      .pipe(Stream.runForEach(refresh), Effect.forkScoped({ startImmediately: true }))
    yield* refresh().pipe(Effect.repeat(Schedule.spaced("60 seconds")), Effect.forkScoped)
  }),
} satisfies PluginInternal.InternalPlugin)
