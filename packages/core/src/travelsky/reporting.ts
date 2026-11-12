export * as TravelSkyReporting from "./reporting.js"

import path from "node:path"
import { Context, Effect, FileSystem, Layer, Scope } from "effect"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { filesystem } from "@opencode/util/effect/app-node-platform"
import { App } from "../app.js"
import { Git } from "../git.js"
import { KV } from "../kv.js"
import { Location } from "../location.js"
import { AbsolutePath, RelativePath } from "../schema.js"
import { Snapshot } from "../snapshot.js"
import type { Model } from "../model.js"
import { SessionMessage } from "../session/message.js"
import { SessionSchema } from "../session/schema.js"
import { SessionStore } from "../session/store.js"
import { TravelSkyAuth } from "./auth.js"
import { TravelSkyMetric } from "./metric.js"

export interface Interface {
  readonly begin: (input: {
    sessionID: SessionSchema.ID
    providerID: Model.Ref["providerID"]
    messages: readonly SessionMessage.Info[]
  }) => Effect.Effect<void>
  readonly complete: (sessionID: SessionSchema.ID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/TravelSkyReporting") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const auth = yield* TravelSkyAuth.Service
    const sessions = yield* SessionStore.Service
    const snapshots = yield* Snapshot.Service
    const location = yield* Location.Service
    const git = yield* Git.Service
    const fs = yield* FileSystem.FileSystem
    const scope = yield* Scope.Scope
    const kv = yield* KV.Service
    const app = yield* App.Service
    const started = new Map<SessionSchema.ID, { parent: SessionMessage.ID; tree?: Git.TreeID }>()
    // The native snapshot service intentionally only handles Git projects. Keep metric-only snapshots private
    // for plain directories, without creating a .git directory or altering the user's index.
    const repository = yield* Effect.cached(
      Effect.gen(function* () {
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: "opencode-travelsky-metric-" })
        const repository = yield* git.repo.create({
          worktree: location.directory,
          gitDirectory: AbsolutePath.make(directory),
        })
        yield* fs.writeFileString(path.join(directory, "info", "exclude"), ".git/\nnode_modules/\n")
        return repository
      }).pipe(Effect.provideService(Scope.Scope, scope)),
    )
    const capture = Effect.fn("TravelSkyReporting.capture")(function* () {
      return yield* git.tree.capture({
        repository: yield* repository,
        scopes: [RelativePath.make(".")],
        maximumUntrackedFileBytes: 2 * 1024 * 1024,
      })
    })

    return Service.of({
      begin: Effect.fn("TravelSkyReporting.begin")(function* (input) {
        if (input.providerID !== "travelSky" || !(yield* auth.snapshot()).status.enabled) return
        const parent = input.messages.findLast((message) => message.type === "user")
        if (!parent || started.get(input.sessionID)?.parent === parent.id) return
        const tree =
          location.vcs?.type === "git" ? undefined : yield* capture().pipe(Effect.orElseSucceed(() => undefined))
        started.set(input.sessionID, { parent: parent.id, tree })
      }),
      complete: Effect.fn("TravelSkyReporting.complete")(
        function* (sessionID) {
          const state = started.get(sessionID)
          if (!state) return
          started.delete(sessionID)
          const parent = yield* sessions.message(state.parent)
          if (!parent) return
          const rows = yield* sessions.messages({
            sessionID,
            order: "asc",
            cursor: { id: state.parent, direction: "next" },
          })
          const assistants = rows.filter((row): row is SessionMessage.Assistant => row.type === "assistant")
          const from = assistants.find((row) => row.snapshot?.start)?.snapshot?.start
          const to = assistants.findLast((row) => row.snapshot?.end)?.snapshot?.end
          const diffs = state.tree
            ? yield* Effect.gen(function* () {
                return yield* git.tree.diff({
                  repository: yield* repository,
                  from: state.tree!,
                  to: yield* capture(),
                  context: 0,
                })
              }).pipe(Effect.orElseSucceed(() => undefined))
            : from && to
              ? yield* snapshots.diff({ from, to, context: 0 }).pipe(Effect.orElseSucceed(() => undefined))
              : undefined
          const body = TravelSkyMetric.build({
            sessionID,
            root: location.project.directory,
            scope: location.directory,
            messages: [parent.message, ...rows],
            diffs,
            client: app.name,
          })
          if (!body) return
          const key = `travelsky.metric.${body.id}`
          if (yield* kv.get(key)) return
          // Claim before sending: retrying provider work or reopening a completed session cannot duplicate a report.
          yield* kv.set(key, true)
          yield* auth.report(body.generation, body.adoption)
        },
        (effect) => effect.pipe(Effect.ignore),
      ),
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [TravelSkyAuth.node, SessionStore.node, Snapshot.node, Location.node, Git.node, filesystem, KV.node, App.node],
})
