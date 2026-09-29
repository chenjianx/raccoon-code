// raccoon_change start - register Raccoon authentication, models, and gateway in the v2 plugin host
import { Effect, Semaphore, Stream } from "effect"
import { define } from "@opencode/plugin/effect/plugin"
import { Bus } from "../../bus.js"
import { Credential } from "../../credential.js"
import { Integration } from "../../integration.js"
import { IntegrationConnection } from "../../integration/connection.js"
import { Provider } from "../../provider.js"
import { RaccoonConnection } from "../../raccoon/auth/connection.js"
import { RaccoonGateway } from "../../raccoon/auth/gateway.js"
import { RaccoonModels } from "../../raccoon/auth/models.js"
import { RaccoonOAuth } from "../../raccoon/auth/oauth.js"

export const RaccoonPlugin = define({
  id: "raccoon.provider",
  effect: Effect.fn(function* (ctx) {
    const bus = yield* Bus.Service
    const loading = Semaphore.makeUnsafe(1)
    let snapshot: {
      baseURL: string
      models: ReturnType<typeof RaccoonModels.fromProfiles>
      connection?: Effect.Success<ReturnType<typeof ctx.integration.connection.active>>
    } = {
      baseURL: RaccoonConnection.baseURL(),
      models: RaccoonModels.fromProfiles(RaccoonConnection.baseURL(), [{ model: "raccoon-chat", name: "Raccoon" }]),
    }

    yield* ctx.integration.transform((editor) => {
      editor.update("raccoon", (integration) => {
        integration.name = "Raccoon"
      })
      editor.method.update(RaccoonOAuth.browser())
      editor.method.update(RaccoonOAuth.phone())
    })

    const load = Effect.fn("RaccoonPlugin.load")(function* () {
      const selected = yield* ctx.integration.connection.active("raccoon")
      if (!selected) {
        snapshot = {
          baseURL: RaccoonConnection.baseURL(),
          models: RaccoonModels.fromProfiles(RaccoonConnection.baseURL(), [{ model: "raccoon-chat", name: "Raccoon" }]),
        }
        return
      }
      const current = yield* RaccoonConnection.resolvePlugin(ctx.integration).pipe(
        Effect.orElseSucceed(() => undefined),
      )
      if (!current) {
        snapshot = {
          baseURL: RaccoonConnection.baseURL(),
          models: [],
          connection: selected,
        }
        return
      }
      const models = yield* Effect.tryPromise({
        try: () => RaccoonModels.discover(current.baseURL, current.access, current.orgCode),
        catch: (cause) => cause,
      }).pipe(
        Effect.tapError((cause) => Effect.logWarning("failed to load Raccoon profiles", { cause })),
        Effect.orElseSucceed(() => []),
      )
      const active = yield* ctx.integration.connection.active("raccoon")
      if (IntegrationConnection.key(active) !== IntegrationConnection.key(current.connection)) return
      snapshot = { baseURL: current.baseURL, models, connection: current.connection }
    })

    yield* ctx.provider.transform((editor) => {
      editor.add({
        info: {
          id: Provider.ID.make("raccoon"),
          name: "Raccoon",
          integrationID: Integration.ID.make("raccoon"),
          activation: "auto",
          package: Provider.aisdk("@ai-sdk/openai-compatible"),
          settings: { baseURL: snapshot.baseURL },
        },
        models: snapshot.models,
        sourceConnection: snapshot.connection,
      })
    })

    const refresh = () => loading.withPermit(load().pipe(Effect.andThen(ctx.provider.reload())))
    yield* bus.subscribe(Credential.Event.Switched).pipe(
      Stream.filter((event) => event.data.integrationID === Integration.ID.make("raccoon")),
      Stream.runForEach(refresh),
      Effect.forkScoped({ startImmediately: true }),
    )
    yield* refresh().pipe(Effect.forkScoped)

    yield* ctx.aisdk.hook(
      "sdk",
      Effect.fn(function* (event) {
        if (event.model.providerID !== Provider.ID.make("raccoon")) return
        if (event.package !== "@ai-sdk/openai-compatible") return
        const send = event.options.fetch as typeof fetch
        event.options.fetch = async (input: string | URL | Request, init?: RequestInit) => {
          const current = await Effect.runPromise(RaccoonConnection.resolvePlugin(ctx.integration))
          if (!current) throw new Error("Raccoon is not connected")
          return RaccoonGateway.send(current, input, init, send)
        }
      }),
    )
  }),
})
// raccoon_change end
