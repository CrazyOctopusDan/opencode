import { expect, mock, test } from "bun:test"
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"
import { Effect, Layer, Option, Predicate, Queue, Schema, Stream } from "effect"
import { RpcMessage, RpcServer } from "effect/rpc"
import { TravelSkyRpcs } from "../src/shared/ipc-rpc/travelsky"

const key = randomBytes(32)

const native = { available: true, backend: "gnome_libsecret" }

mock.module("electron", () => ({
  default: {},
  app: {},
  BrowserWindow: {},
  ipcMain: {},
  safeStorage: {
    isEncryptionAvailable: () => native.available,
    getSelectedStorageBackend: () => native.backend,
    encryptString(value: string) {
      const iv = randomBytes(16)
      const cipher = createCipheriv("aes-256-cbc", key, iv)

      return Buffer.concat([iv, cipher.update(value, "utf8"), cipher.final()])
    },
    decryptString(value: Buffer) {
      const cipher = createDecipheriv("aes-256-cbc", key, value.subarray(0, 16))

      return Buffer.concat([cipher.update(value.subarray(16)), cipher.final()]).toString("utf8")
    },
  },
}))

const { DesktopStorage } = await import("../src/main/storage")

const { travelSkyHandlers } = await import("../src/main/ipc-handlers/travelsky")

// SAFETY: these literals are the encoded RPC request/response format, not application tagged values.
/* oxlint-disable anti-slop-effect/no-manual-tagged-construction -- see SAFETY above */
test("raw renderer RPC validates payloads, encrypts SQLite values, scopes servers and refuses insecure storage", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const storage = DesktopStorage.make(":memory:")
      yield* Effect.addFinalizer(() => Effect.sync(() => storage.close()))
      const requests = yield* Queue.unbounded<RpcMessage.FromClientEncoded>()
      const responses = yield* Queue.unbounded<RpcMessage.FromServerEncoded>()
      const disconnects = yield* Queue.unbounded<number>()

      const protocol = RpcServer.Protocol.of({
        run: (receive) =>
          Stream.fromQueue(requests).pipe(
            Stream.runForEach((request) => receive(0, request)),
            Effect.andThen(Effect.never),
          ),
        send: (_, response) => Queue.offer(responses, response).pipe(Effect.asVoid),
        disconnects,
        end: () => Effect.void,
        clientIds: Effect.succeed(new Set([0])),
        initialMessage: Effect.succeed(Option.none()),
        supportsAck: false,
        supportsTransferables: false,
        supportsSpanPropagation: false,
        supportsNotifications: false,
        codecFor: Schema.toCodecJson,
      })

      yield* RpcServer.make(TravelSkyRpcs).pipe(
        Effect.provide(travelSkyHandlers.pipe(Layer.provide(Layer.succeed(DesktopStorage.Service, storage)))),
        Effect.provideService(RpcServer.Protocol, protocol),
        Effect.forkScoped({ startImmediately: true }),
      )

      const call = Effect.fn(function* (tag: string, payload: RpcMessage.RequestEncoded["payload"]) {
        yield* Queue.offer(requests, { _tag: "Request", id: 1, tag, payload, headers: [] })
        const response = yield* Queue.take(responses)

        if (!Predicate.isTagged(response, "Exit")) throw new Error(`Unexpected ${response._tag}`)

        return response.exit
      })

      const credential = { username: "company-user", password: "private-password" }
      expect(yield* call("TravelSkyCredentialSet", { server: "local", credential })).toEqual({
        _tag: "Success",
        value: true,
      })
      const stored = storage.state.get("travelsky-credentials", "local")
      expect(stored).toBeTruthy()
      expect(stored).not.toContain(credential.password)
      expect(Buffer.from(stored!, "base64").toString()).not.toContain(credential.password)
      expect(yield* call("TravelSkyCredentialGet", { server: "local" })).toEqual({ _tag: "Success", value: credential })
      expect(yield* call("TravelSkyCredentialGet", { server: "remote" })).toEqual({ _tag: "Success", value: null })
      expect(
        (yield* call("TravelSkyCredentialSet", { server: "local", credential: { username: "", password: "" } }))._tag,
      ).toBe("Failure")
      storage.state.set("travelsky-credentials", "local", "corrupted")
      expect(yield* call("TravelSkyCredentialGet", { server: "local" })).toEqual({ _tag: "Success", value: null })
      const platform = process.platform
      Object.defineProperty(process, "platform", { value: "linux" })
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => Object.defineProperty(process, "platform", { value: platform })),
      )

      for (const state of [
        { available: false, backend: "gnome_libsecret" },
        { available: true, backend: "basic_text" },
      ]) {
        Object.assign(native, state)
        expect(yield* call("TravelSkyCredentialSet", { server: "insecure", credential })).toEqual({
          _tag: "Success",
          value: false,
        })
        expect(storage.state.get("travelsky-credentials", "insecure")).toBeNull()
        expect(yield* call("TravelSkyCredentialGet", { server: "local" })).toEqual({ _tag: "Success", value: null })
      }

      expect(yield* call("TravelSkyCredentialSet", { server: "local", credential: null })).toEqual({
        _tag: "Success",
        value: true,
      })
      expect(storage.state.get("travelsky-credentials", "local")).toBeNull()
    }).pipe(Effect.scoped, Effect.timeout("10 seconds")),
  ))
