import { TravelSky } from "@opencode/schema/travelsky"
import { Schema } from "effect"
import { HttpApiEndpoint, OpenApi } from "effect/http-api"
import { InvalidRequestError } from "../errors.js"

export const TravelSkyEndpoints = [
  HttpApiEndpoint.get("travelsky.status", "/api/experimental/travelsky/status", {
    success: Schema.Struct({ data: TravelSky.Status }),
  }).annotateMerge(
    OpenApi.annotations({
      identifier: "experimental.travelsky.status",
      summary: "Read TravelSky login status",
      description:
        "Validate the company session and refresh model access. Experimental: may change without compatibility guarantees.",
    }),
  ),
  HttpApiEndpoint.post("travelsky.login", "/api/experimental/travelsky/login", {
    payload: TravelSky.Login,
    success: Schema.Struct({ data: TravelSky.Status }),
    error: [InvalidRequestError],
  }).annotateMerge(
    OpenApi.annotations({
      identifier: "experimental.travelsky.login",
      summary: "Log in to TravelSky",
      description:
        "Store a company session without storing the password. Local server authentication is unchanged. Experimental: may change without compatibility guarantees.",
    }),
  ),
  HttpApiEndpoint.post("travelsky.logout", "/api/experimental/travelsky/logout", {
    success: Schema.Struct({ data: TravelSky.Status }),
  }).annotateMerge(
    OpenApi.annotations({
      identifier: "experimental.travelsky.logout",
      summary: "Log out of TravelSky",
      description: "Remove the stored company session. Experimental: may change without compatibility guarantees.",
    }),
  ),
] as const
