import { describe, expect, test } from "bun:test"
import type { ExtensionToWebview, RaccoonState } from "@opencode-ai/raccoon-webview"
import { RaccoonEventHandler } from "./event-handler"

function createHandler(trackedSubAgentSessionID = "child") {
  const messages: ExtensionToWebview[] = []
  const deltas: string[] = []
  const refreshed: string[] = []
  const states: RaccoonState[] = []
  let state = { activeSessionID: "root", loading: false, busy: false } as RaccoonState
  const handler = new RaccoonEventHandler({
    directory: () => "/workspace",
    getState: () => state,
    setState: (next: RaccoonState) => { state = next; states.push(next) },
    post: () => {},
    removeSession: () => {},
    scheduleSessionRefresh: () => {},
    scheduleEventRefresh: () => refreshed.push("root"),
    scheduleSubAgentRefresh: (sessionID: string) => refreshed.push(sessionID),
    isTrackedSubAgent: (sessionID: string) => sessionID === trackedSubAgentSessionID,
    completeTrackedSubAgent: () => {},
    postMessage: (message: ExtensionToWebview) => messages.push(message),
    postSubAgentEvent: (_sessionID: string, message: ExtensionToWebview) => messages.push(message),
    pushPartDelta: (_sessionID: string, _messageID: string, _partID: string, _field: string, delta: string) => deltas.push(delta),
    pushSubAgentPartDelta: (_sessionID: string, _messageID: string, _partID: string, _field: string, delta: string) => deltas.push(delta),
    flushStreams: () => {},
    clearPromptRefresh: () => {},
    recoverPendingQuestions: async () => {},
    refreshMcpInstalled: () => {},
    onReauthRequired: () => {},
  })
  return { handler, messages, deltas, refreshed, states }
}

describe("RaccoonEventHandler v2 events", () => {
  test("ignores session events outside the active session tree or workspace", () => {
    const { handler, messages, deltas, states } = createHandler("child-a")
    handler.handleGlobal({ type: "session.status", location: { directory: "/elsewhere" }, data: { sessionID: "root", status: { type: "running" } } } as never)
    handler.handleGlobal({ type: "session.status", location: { directory: "/workspace" }, data: { sessionID: "child-b", status: { type: "running" } } } as never)
    handler.handleGlobal({ type: "session.text.delta", location: { directory: "/workspace" }, data: { sessionID: "child-b", assistantMessageID: "msg", ordinal: 0, delta: "ignored" } } as never)
    expect(messages).toEqual([])
    expect(deltas).toEqual([])
    expect(states).toEqual([])
  })

  test("routes tracked subagent status and deltas", () => {
    const { handler, messages, deltas } = createHandler("child-a")
    handler.handleGlobal({ type: "session.status", location: { directory: "/workspace" }, data: { sessionID: "child-a", status: { type: "running" } } } as never)
    handler.handleGlobal({ type: "session.text.delta", location: { directory: "/workspace" }, data: { sessionID: "child-a", assistantMessageID: "msg", ordinal: 0, delta: "hello" } } as never)
    expect(messages).toContainEqual({ type: "subAgentBusyChanged", sessionID: "child-a", busy: true })
    expect(deltas).toEqual(["hello"])
  })

  test("forwards permission requests from child sessions", () => {
    const { handler, messages } = createHandler()
    handler.handleGlobal({
      type: "permission.asked",
      location: { directory: "/workspace" },
      data: { id: "perm-child", sessionID: "child", action: "external_directory", resources: ["/tmp/*"], metadata: {}, save: ["/tmp/*"] },
    } as never)
    expect(messages).toContainEqual({
      type: "permissionRequest",
      permission: { id: "perm-child", sessionID: "child", permission: "external_directory", patterns: ["/tmp/*"], metadata: {}, always: ["/tmp/*"], tool: undefined },
    })
    expect(messages).toContainEqual({ type: "subAgentBusyChanged", sessionID: "child", busy: true })
  })

  test("clears active busy state after execution failure", () => {
    const { handler, states } = createHandler()
    handler.handleGlobal({ type: "session.execution.started", data: { sessionID: "root" } } as never)
    handler.handleGlobal({ type: "session.execution.failed", data: { sessionID: "root", error: { message: "something went wrong" } } } as never)
    expect(states.at(-1)).toMatchObject({ loading: false, busy: false })
  })

  test("clears tracked subagent busy state after execution failure", () => {
    const { handler, messages } = createHandler()
    handler.handleGlobal({ type: "session.execution.failed", data: { sessionID: "child", error: { message: "child failed" } } } as never)
    expect(messages).toContainEqual({ type: "subAgentBusyChanged", sessionID: "child", busy: false })
  })
})
