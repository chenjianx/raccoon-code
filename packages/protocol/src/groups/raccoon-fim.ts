import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { InvalidRequestError } from "../errors.js"

export const FimRequest = Schema.Struct({
  prefix: Schema.String,
  suffix: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  language: Schema.optional(Schema.String),
  maxTokens: Schema.optional(Schema.Number),
  temperature: Schema.optional(Schema.Number),
}).annotate({ identifier: "RaccoonFimRequest" })

export const FimChunk = Schema.Union([
  Schema.Struct({ type: Schema.Literal("delta"), text: Schema.String }),
  Schema.Struct({ type: Schema.Literal("done") }),
  Schema.Struct({ type: Schema.Literal("error"), message: Schema.String }),
]).annotate({ identifier: "RaccoonFimChunk" })

export const RaccoonFimGroup = HttpApiGroup.make("server.fim")
  .add(
    HttpApiEndpoint.post("fim.complete", "/api/fim", {
      payload: FimRequest,
      success: HttpApiSchema.StreamSse({ data: FimChunk }),
      error: InvalidRequestError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "fim.complete",
        summary: "Inline FIM completion",
        description: "Stream a fill-in-the-middle text completion for inline autocomplete.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "fim", description: "Inline completion route." }))
