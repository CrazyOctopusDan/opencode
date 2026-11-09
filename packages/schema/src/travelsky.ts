export * as TravelSky from "./travelsky.js"

import { Schema } from "effect"
import { optional } from "./schema.js"

export interface Login extends Schema.Schema.Type<typeof Login> {}
export const Login = Schema.Struct({
  username: Schema.NonEmptyString,
  password: Schema.NonEmptyString,
}).annotate({ identifier: "TravelSky.Login" })

export interface Status extends Schema.Schema.Type<typeof Status> {}
export const Status = Schema.Struct({
  enabled: Schema.Boolean,
  authenticated: Schema.Boolean,
  username: optional(Schema.String),
  expiresAt: optional(Schema.Finite),
  message: optional(Schema.String),
}).annotate({ identifier: "TravelSky.Status" })

export const Options = Schema.Struct({
  enabled: Schema.Boolean,
  baseURL: Schema.String,
  publicKey: Schema.String,
  ttlSeconds: optional(Schema.Finite),
})
export type Options = typeof Options.Type
