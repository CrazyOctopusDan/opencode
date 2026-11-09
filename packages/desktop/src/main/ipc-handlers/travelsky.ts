import { safeStorage } from "electron"
import { Effect, Option, Schema } from "effect"
import { TravelSkyCredential, TravelSkyRpcs } from "../../shared/ipc-rpc/travelsky"
import { DesktopStorage } from "../storage"

const namespace = "travelsky-credentials"

const decode = Schema.decodeUnknownOption(Schema.fromJsonString(TravelSkyCredential))

export const travelSkyHandlers = TravelSkyRpcs.toLayer(
  Effect.gen(function* () {
    const storage = yield* DesktopStorage.Service

    const available = () =>
      safeStorage.isEncryptionAvailable() &&
      (process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text")

    return TravelSkyRpcs.of({
      TravelSkyCredentialGet: ({ server }) =>
        Effect.try(() => {
          if (!available()) return null
          const stored = storage.state.get(namespace, server)

          if (!stored) return null

          return Option.getOrNull(decode(safeStorage.decryptString(Buffer.from(stored, "base64"))))
        }).pipe(Effect.orElseSucceed(() => null)),
      TravelSkyCredentialSet: ({ server, credential }) =>
        Effect.try(() => {
          if (!credential) {
            storage.state.delete(namespace, server)
            storage.flush()

            return true
          }

          if (!available()) return false
          storage.state.set(namespace, server, safeStorage.encryptString(JSON.stringify(credential)).toString("base64"))
          storage.flush()

          return true
        }).pipe(Effect.orElseSucceed(() => false)),
    })
  }),
)
