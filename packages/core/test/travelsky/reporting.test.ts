import { expect } from "bun:test"
import path from "node:path"
import { DateTime, Effect, FileSystem, Layer, Schema } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"
import { Agent } from "@opencode/schema/agent"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import { SessionMessage } from "@opencode/schema/session-message"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { filesystem, httpClient } from "@opencode/util/effect/app-node-platform"
import { AppNodeBuilder } from "../../src/effect/app-node-builder"
import { Database } from "../../src/database/database"
import { ProjectTable } from "../../src/project/sql"
import { SessionTable, SessionMessageTable } from "../../src/session/sql"
import { SessionSchema } from "../../src/session/schema"
import { Location } from "../../src/location"
import { TravelSkyAuth } from "../../src/travelsky/auth"
import { TempoApi } from "../../src/travelsky/api"
import { TravelSkyReporting } from "../../src/travelsky/reporting"
import { tempLocationLayer } from "../fixture/location"
import { testEffect } from "../lib/effect"
import pkg from "../../package.json"

const reports: Array<{ url: string; body: Record<string, unknown>; cookie?: string }> = []
const http = HttpClient.make((request) => {
  if (request.url.includes("/record/") && request.body._tag === "Uint8Array")
    reports.push({
      url: request.url,
      body: JSON.parse(new TextDecoder().decode(request.body.body)),
      cookie: request.headers.cookie,
    })
  return Effect.succeed(
    HttpClientResponse.fromWeb(
      request,
      Response.json({
        success: true,
        data: request.url.endsWith("auth/login")
          ? { token: "token" }
          : request.url.endsWith("saveGeneration")
            ? 42
            : [],
      }),
    ),
  )
})
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([filesystem, TravelSkyReporting.node, TravelSkyAuth.node, Database.node, Location.node]),
    [
      Location.node.replace(tempLocationLayer),
      TravelSkyAuth.node.replace(
        TravelSkyAuth.configured(TempoApi.settings({ OPENCODE_TEMPO_BASE_URL: "https://tempo.example" })),
      ),
      httpClient.replace(Layer.succeed(HttpClient.HttpClient, http)),
    ],
  ),
)

it.live("reports one final diff for a plain directory and does not create a user repository", () =>
  Effect.gen(function* () {
    const metric = yield* TravelSkyReporting.Service
    const auth = yield* TravelSkyAuth.Service
    const location = yield* Location.Service
    const fs = yield* FileSystem.FileSystem
    const db = (yield* Database.Service).db
    const sessionID = SessionSchema.ID.make("ses_metric")
    const user = SessionMessage.User.make({
      id: SessionMessage.ID.make("msg_user"),
      type: "user",
      text: "Add lines",
      time: { created: DateTime.makeUnsafe(0) },
    })
    const assistant = SessionMessage.Assistant.make({
      id: SessionMessage.ID.make("msg_answer"),
      type: "assistant",
      agent: Agent.ID.make("build"),
      model: Model.Ref.make({ providerID: Provider.ID.make("travelSky"), id: Model.ID.make("Qwen3") }),
      content: [{ type: "text", text: "Done" }],
      finish: "stop",
      time: { created: DateTime.makeUnsafe(1), completed: DateTime.makeUnsafe(2) },
    })
    yield* db
      .insert(ProjectTable)
      .values({ id: location.project.id, worktree: location.directory, sandboxes: [] })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    yield* db
      .insert(SessionTable)
      .values({
        id: sessionID,
        project_id: location.project.id,
        slug: "metric",
        directory: location.directory,
        version: pkg.version,
      })
      .run()
      .pipe(Effect.orDie)
    yield* db
      .insert(SessionMessageTable)
      .values(
        [user, assistant].map((message, index) => {
          const encoded = Schema.encodeSync(SessionMessage.Info)(message)
          const { id, type, ...data } = encoded
          return {
            id: SessionMessage.ID.make(id),
            session_id: sessionID,
            type,
            seq: index + 1,
            time_created: encoded.time.created,
            data,
          }
        }),
      )
      .run()
      .pipe(Effect.orDie)
    yield* auth.login({ username: "user", password: "password" })
    const file = path.join(location.directory, "main.ts")
    yield* fs.writeFileString(file, "one\n")
    yield* metric.begin({ sessionID, providerID: Provider.ID.make("travelSky"), messages: [user] })
    yield* fs.writeFileString(file, "one\nintermediate\n")
    yield* fs.writeFileString(file, "one\ntwo\nthree\n")
    yield* metric.complete(sessionID)
    yield* metric.begin({ sessionID, providerID: Provider.ID.make("travelSky"), messages: [user] })
    yield* metric.complete(sessionID)
    expect(reports).toHaveLength(2)
    expect(reports[0]).toMatchObject({
      url: "https://tempo.example/ai/data/api/record/saveGeneration",
      body: { generatedLines: 2, adoptedLines: 2, responseContent: "Done", toolVersion: pkg.version },
      cookie: "crowd.token_key=token",
    })
    expect(reports[1]).toMatchObject({
      url: "https://tempo.example/ai/data/api/record/addAdoption",
      body: { qaid: "42", adoptedLines: 2, deletedLines: 0, adoptedContent: "" },
    })
    expect(yield* fs.exists(path.join(location.directory, ".git"))).toBe(false)
  }),
)
