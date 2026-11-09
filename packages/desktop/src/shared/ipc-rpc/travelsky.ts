import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"

export const TravelSkyCredential = Schema.Struct({ username: Schema.NonEmptyString, password: Schema.NonEmptyString })

export const TravelSkyRpcs = RpcGroup.make(
  Rpc.make("TravelSkyCredentialGet", {
    payload: { server: Schema.NonEmptyString },
    success: Schema.NullOr(TravelSkyCredential),
  }),
  Rpc.make("TravelSkyCredentialSet", {
    payload: { server: Schema.NonEmptyString, credential: Schema.NullOr(TravelSkyCredential) },
    success: Schema.Boolean,
  }),
)
