import { expect, test } from "bun:test"
import type { OpenCodeClient, OpenCodeEvent } from "@opencode/client/promise"
import type { ExtensionToWebview, RaccoonMessage, RaccoonState } from "@opencode-ai/raccoon-webview"
import { applyPartUpdates } from "../../../raccoon-webview/src/context/session-parts"
import { RaccoonProvider } from "./index"
import type { ConnectionPort, HostPlatform, WebviewTransport } from "./platform"

test.each([
  { type: "text", text: "Hello" },
  { type: "text", text: "" },
  { type: "reasoning", text: "Hello" },
  { type: "reasoning", text: "" },
] as const)("replaces streamed $type with the authoritative end value '$text'", async (fixture) => {
  const start = Promise.withResolvers<void>()
  const finished = Promise.withResolvers<void>()
  const messages: ExtensionToWebview[] = []
  let rendered: RaccoonMessage[] = []
  const client = {
    session: {
      get: async () => ({ id: "root", title: "root", agent: "build", time: { created: 1, updated: 1 } }),
      active: async () => ({ root: { type: "running" } }),
      form: { list: async () => [] },
    },
    message: { list: async () => ({ data: [{ id: "assistant", type: "assistant", agent: "build",
      model: { providerID: "raccoon", id: "raccoon-chat" }, time: { created: 1 }, content: [{ type: fixture.type, text: "" }],
    }], cursor: {} }) },
    permission: { request: { list: async () => ({ data: [] }) } },
    event: {
      subscribe: async function* ({ signal }: { signal: AbortSignal }) {
        const stopped = new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
        await start.promise
        yield { type: `session.${fixture.type}.delta`, data: { sessionID: "root", assistantMessageID: "assistant", ordinal: 0, delta: "Hello world" } } as OpenCodeEvent
        yield { type: `session.${fixture.type}.ended`, data: { sessionID: "root", assistantMessageID: "assistant", ordinal: 0, text: fixture.text } } as OpenCodeEvent
        finished.resolve()
        await stopped
      },
    },
  } as unknown as OpenCodeClient
  const platform = {
    env: { locale: () => "en" },
    workspace: { directory: () => "/workspace" },
    settings: {
      getAutocompleteEnabled: () => true,
      getAutocompleteModel: () => "raccoon-completion",
      onAutocompleteEnabledChange: () => ({ dispose() {} }),
      onAutocompleteModelChange: () => ({ dispose() {} }),
    },
    createEmitter: () => ({ fire() {}, dispose() {}, event: () => ({ dispose() {} }) }),
    ui: { log() {} },
  } as unknown as HostPlatform
  const provider = new RaccoonProvider({
    onStateChange: () => () => {}, getClientAsync: async () => client,
  } as ConnectionPort, platform, {
    onMessage() {},
    postState: (state: RaccoonState) => { rendered = state.messages },
    post: (_source: string, message: ExtensionToWebview) => {
      messages.push(message)
      if (message.type !== "partUpdated" && message.type !== "partsUpdated") return
      rendered = applyPartUpdates(rendered, message.type === "partUpdated" ? [message] : message.updates, "root")
    },
  } as unknown as WebviewTransport)
  try {
    await provider.selectSession("root")
    start.resolve()
    await finished.promise
    expect(provider.getState().messages[0]?.parts[0]?.text).toBe(fixture.text)
    expect(rendered[0]?.parts[0]?.text).toBe(fixture.text)
    expect(messages.filter((message) => message.type === "partUpdated").at(-1)).toMatchObject({
      part: { type: fixture.type, text: fixture.text },
    })
    expect(provider.getState().busy).toBe(true)
  } finally {
    provider.dispose()
  }
})
