import { describe, expect, test } from "bun:test"
import type { SessionInfo, SessionMessageInfo } from "@opencode/client/promise"
import { contextInspectorSnapshot } from "./context-inspector"

const session = {
  id: "session-1",
  title: "Inspector",
  cost: 1.25,
  time: { created: 1, updated: 10 },
  revert: { messageID: "user-3" },
} as SessionInfo

const messages = [
  { id: "user-1", type: "user", time: { created: 2 }, text: "12345678" },
  { id: "assistant-1", type: "assistant", time: { created: 3 }, model: { providerID: "old", id: "old" }, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, content: [] },
  { id: "user-2", type: "user", time: { created: 4 }, text: "1234" },
  { id: "system-2", type: "system", time: { created: 4.5 }, text: " latest system " },
  {
    id: "assistant-2", type: "assistant", time: { created: 5 }, model: { providerID: "provider", id: "model" },
    tokens: { input: 20, output: 2, reasoning: 1, cache: { read: 3, write: 4 } },
    content: [
      { type: "text", text: "12345678" },
      { type: "tool", id: "tool-1", name: "read", state: { status: "completed", input: { path: "x" }, content: [{ type: "text", text: "12345678" }] }, time: { created: 5 } },
    ],
  },
  { id: "user-3", type: "user", time: { created: 6 }, text: "reverted" },
] as SessionMessageInfo[]

describe("contextInspectorSnapshot", () => {
  test("builds the desktop-compatible projected context view", () => {
    const snapshot = contextInspectorSnapshot(session, messages, true)

    expect(snapshot.session).toEqual({ id: "session-1", title: "Inspector", createdAt: 1, updatedAt: 10, cost: 1.25 })
    expect(snapshot.model).toEqual({ providerID: "provider", modelID: "model" })
    expect(snapshot.systemPrompt).toBe("latest system")
    expect(snapshot.usage?.input).toBe(20)
    expect(snapshot.breakdown).toEqual([
      { key: "system", tokens: 4, percent: 20 },
      { key: "user", tokens: 3, percent: 15 },
      { key: "assistant", tokens: 2, percent: 10 },
      { key: "tool", tokens: 5, percent: 25 },
      { key: "other", tokens: 6, percent: 30 },
    ])
    expect(snapshot.messages).toHaveLength(6)
    expect(JSON.parse(snapshot.messages[0].raw)).toEqual(messages[0])
    expect(snapshot.truncated).toBeTrue()
  })

  test("returns no breakdown without assistant input usage", () => {
    const snapshot = contextInspectorSnapshot(session, messages.slice(0, 2), false)

    expect(snapshot.model).toBeUndefined()
    expect(snapshot.breakdown).toEqual([])
    expect(snapshot.truncated).toBeFalse()
  })
})
