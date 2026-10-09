import { expect, test } from "bun:test"
import { RaccoonProvider } from "./index"
import type { HostPlatform, WebviewTransport, ConnectionPort } from "./platform"
import type { RaccoonState, ExtensionToWebview, WebviewToExtension } from "@opencode-ai/raccoon-webview"

test("autocomplete models initialize, normalize, persist, and follow host changes", async () => {
  let model = "raccoon-completion"
  let listener: ((model: string) => void) | undefined
  const states: RaccoonState[] = []
  let receive: ((message: WebviewToExtension, source: "settings") => void) | undefined
  const saved = Promise.withResolvers<ExtensionToWebview>()
  const platform = {
    env: { locale: () => "en" },
    settings: {
      getAutocompleteEnabled: () => true,
      onAutocompleteEnabledChange: () => ({ dispose() {} }),
      getAutocompleteModel: () => model,
      setAutocompleteModel: async (value: string) => { model = value },
      onAutocompleteModelChange: (value: (model: string) => void) => {
        listener = value
        return { dispose() { listener = undefined } }
      },
    },
    createEmitter: () => ({ fire() {}, dispose() {}, event: () => ({ dispose() {} }) }),
    ui: {},
  } as unknown as HostPlatform
  const provider = new RaccoonProvider(
    { onStateChange: () => () => {} } as unknown as ConnectionPort,
    platform,
    {
      onMessage: (listener: typeof receive) => { receive = listener },
      postState: (state: RaccoonState) => states.push(state),
      post: (_source: string, message: ExtensionToWebview) => saved.resolve(message),
    } as unknown as WebviewTransport,
  )
  expect(provider.getState().autocompleteModel).toBe("raccoon-completion")
  receive?.({ type: "saveSettings", requestID: "model-save", settings: { autocompleteModel: "raccoon-pro-completion" } }, "settings")
  expect(await saved.promise).toEqual({ type: "settingsSaveResult", requestID: "model-save", success: true })
  expect(model).toBe("raccoon-pro-completion")
  expect(states.at(-1)?.autocompleteModels?.map((value) => value.id)).toEqual([
    "raccoon-pro-completion", "raccoon-completion",
  ])
  listener?.("raccoon-completion")
  expect(states.at(-1)?.autocompleteModel).toBe("raccoon-completion")
  await provider.setAutocompleteModel("unknown")
  expect(model).toBe("raccoon-pro-completion")
  expect(states.at(-1)?.autocompleteModel).toBe(model)
  provider.dispose()
  expect(listener).toBeUndefined()
})
