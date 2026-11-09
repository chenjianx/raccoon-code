import { expect, test } from "bun:test"
import type { OpenCodeClient, OpenCodeEvent } from "@opencode/client/promise"
import type { ExtensionToWebview, RaccoonMessage, RaccoonState } from "@opencode-ai/raccoon-webview"
import { applyPartUpdates } from "../../../raccoon-webview/src/context/session-parts"
import { RaccoonProvider } from "./index"
import type { ConnectionPort, HostPlatform, WebviewTransport } from "./platform"

test.each([true, false])("keeps subagent navigation across empty snapshots (progress before snapshot: %s)", async (early) => {
  const start = Promise.withResolvers<void>()
  const finished = Promise.withResolvers<void>()
  const posts: ExtensionToWebview[] = []
  const listener: { handle?: Parameters<WebviewTransport["onMessage"]>[0] } = {}
  let completed = false
  const client = {
    session: {
      get: async () => ({ id: "root", title: "root", agent: "build", time: { created: 1, updated: 1 } }),
      active: async () => ({ root: { type: "running" }, child: { type: "running" }, grandchild: { type: "running" } }),
      form: { list: async () => [] },
    },
    message: { list: async ({ sessionID }: { sessionID: string }) => {
      if (early && sessionID === "root") {
        start.resolve()
        await finished.promise
      }
      if (sessionID === "grandchild") return { data: [{ id: "nested", type: "assistant", agent: "explore",
        model: { providerID: "raccoon", id: "raccoon-chat" }, time: { created: 1 }, content: [{ type: "text", text: "" }],
      }], cursor: {} }
      return { data: [{ id: "assistant", type: "assistant", agent: "build",
        model: { providerID: "raccoon", id: "raccoon-chat" }, time: { created: 1 },
        content: [{ id: "call", type: "tool", name: "subagent", time: { created: 1 }, state:
          completed ? { status: "completed", input: {}, content: [{ type: "text", text: "done" }], metadata: { sessionID: "child", status: "completed" } }
            : { status: "running", input: { agent: "explore", description: "Inspect" }, metadata: {} },
        }],
      }], cursor: {} }
    } },
    integration: { list: async () => ({ data: [] }) },
    provider: { list: async () => ({ data: [] }) },
    model: { list: async () => ({ data: [] }), default: async () => ({ data: undefined }) },
    command: { list: async () => ({ data: [] }) },
    agent: { list: async () => ({ data: [] }) },
    config: { get: async () => [] },
    permission: { request: { list: async () => ({ data: [] }) } },
    event: { subscribe: async function* ({ signal }: { signal: AbortSignal }) {
      const stopped = new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
      await start.promise
      yield { type: "session.tool.progress", data: { sessionID: "root", assistantMessageID: "assistant", id: "call", metadata: { sessionID: "child", status: "running" } } } as OpenCodeEvent
      yield { type: "session.tool.progress", data: { sessionID: "child", assistantMessageID: "assistant", id: "call", metadata: { sessionID: "grandchild", status: "running" } } } as OpenCodeEvent
      yield { type: "session.text.delta", data: { sessionID: "grandchild", assistantMessageID: "nested", ordinal: 0, delta: "working" } } as OpenCodeEvent
      finished.resolve()
      await stopped
    } },
  } as unknown as OpenCodeClient
  const platform = {
    env: { locale: () => "en" }, workspace: { directory: () => "/workspace" },
    settings: {
      getAutocompleteEnabled: () => true, getAutocompleteModel: () => "raccoon-completion",
      onAutocompleteEnabledChange: () => ({ dispose() {} }), onAutocompleteModelChange: () => ({ dispose() {} }),
    },
    createEmitter: () => ({ fire() {}, dispose() {}, event: () => ({ dispose() {} }) }),
    ui: { log() {} },
  } as unknown as HostPlatform
  const provider = new RaccoonProvider({ onStateChange: () => () => {}, getClientAsync: async () => client } as ConnectionPort, platform, {
    onMessage: (handle) => { listener.handle = handle }, postState() {},
    post: (_source, message) => posts.push(message),
  } as WebviewTransport)
  try {
    await provider.selectSession("root")
    start.resolve()
    await finished.promise
    await new Promise((resolve) => setTimeout(resolve, 180))
    expect(provider.getState().messages[0]?.parts[0]?.metadata?.sessionID).toBe("child")
    expect(provider.getState().subSessions?.child?.tools[0]?.sessionID).toBe("grandchild")

    listener.handle?.({ type: "openSubAgent", sessionID: "child" }, "chat")
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(posts.filter((post) => post.type === "showSubAgent").at(-1)).toMatchObject({
      view: { sessionID: "child", loading: false, messages: [{ parts: [{ metadata: { sessionID: "grandchild" } }] }] },
    })
    listener.handle?.({ type: "openSubAgent", sessionID: "grandchild" }, "chat")
    await new Promise((resolve) => setTimeout(resolve, 0))
    const grandchild = posts.reduce<RaccoonMessage[]>((messages, post) => {
      if (post.type === "showSubAgent" && post.view.sessionID === "grandchild") return post.view.messages
      if (post.type !== "partUpdated" && post.type !== "partsUpdated") return messages
      return applyPartUpdates(messages, post.type === "partUpdated" ? [post] : post.updates, "grandchild")
    }, [])
    expect(grandchild[0]?.text).toBe("working")
    await provider.selectSession("root")
    expect(provider.getState().messages[0]?.parts[0]?.metadata?.sessionID).toBe("child")

    completed = true
    await provider.selectSession("root")
    expect(provider.getState().messages[0]?.parts[0]).toMatchObject({ status: "completed", metadata: { sessionID: "child", status: "completed" } })
  } finally {
    provider.dispose()
  }
})

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
