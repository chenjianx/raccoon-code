// @ts-expect-error Bun exposes this module to tests; the Sidecar compiler intentionally loads Node-only types.
import { expect, test } from "bun:test"
import { sendFunctionAction } from "./function-actions.js"

const context = {
  filePath: "src/Foo.java",
  selectedText: "void run() {}",
  startLine: 2,
  endLine: 2,
  diagnostics: [],
}

test("restores an existing session before sending the first function action", async () => {
  const events: string[] = []
  await sendFunctionAction(
    {
      getState: () => ({ activeSessionID: undefined }),
      refresh: async () => { events.push("refresh") },
      sendCapturedEditorContext: async () => { events.push("send") },
      appendCapturedEditorContext: async () => { events.push("append") },
    },
    { post: (_source, message) => { events.push(message.type) } },
    "EXPLAIN",
    context,
  )

  expect(events).toEqual(["showChat", "refresh", "send"])
})

test("returns from history to chat without refreshing an active session", async () => {
  const events: string[] = []
  await sendFunctionAction(
    {
      getState: () => ({ activeSessionID: "session-1" }),
      refresh: async () => { events.push("refresh") },
      sendCapturedEditorContext: async () => { events.push("send") },
      appendCapturedEditorContext: async () => { events.push("append") },
    },
    { post: (_source, message) => { events.push(message.type) } },
    "FIX",
    context,
  )

  expect(events).toEqual(["showChat", "send"])
})

test("adds a selection to the chat input without sending it", async () => {
  const events: string[] = []
  await sendFunctionAction(
    {
      getState: () => ({ activeSessionID: "session-1" }),
      refresh: async () => { events.push("refresh") },
      sendCapturedEditorContext: async () => { events.push("send") },
      appendCapturedEditorContext: async () => { events.push("append") },
    },
    { post: (_source, message) => { events.push(message.type) } },
    "ADD_TO_CONTEXT",
    context,
  )

  expect(events).toEqual(["showChat", "append"])
})
