import { describe, expect, test } from "bun:test"
import type { ModelInfo, ProviderInfo, SessionInfo, SessionMessageInfo } from "@opencode/client/promise"
import { mapMessage, mapProviderModels, mapSession, mapSubSession } from "./mapping"

describe("mapProviderModels", () => {
  test("filters autocomplete-only raccoon models from selectable models", () => {
    const provider = { id: "raccoon", name: "Raccoon", activation: "auto", integrationID: "raccoon" } as ProviderInfo
    const models = [
      { providerID: "raccoon", modelID: "raccoon-pro-completion", name: "Raccoon Complete Pro" },
      { providerID: "raccoon", modelID: "raccoon-completion", name: "Raccoon Complete" },
      { providerID: "raccoon", modelID: "raccoon-chat", name: "Raccoon Chat", enabled: true, variants: [{ id: "low" }, { id: "high" }] },
    ] as ModelInfo[]

    const result = mapProviderModels(models, [provider], [{ id: "raccoon", connections: [{ type: "env", name: "RACCOON_TOKEN" }] } as never], new Set())
    expect(result.map((model) => model.modelID)).toEqual(["raccoon-chat"])
    expect(result[0]?.variants).toEqual(["low", "high"])
    expect(result[0]?.connected).toBe(true)
  })
})

describe("mapMessage", () => {
  test("maps v2 assistant content and tool result", () => {
    const mapped = mapMessage({
      id: "msg_1",
      type: "assistant",
      time: { created: 1000, completed: 2000 },
      content: [
        { type: "text", text: "hello" },
        { type: "tool", id: "tool_1", name: "read", time: { created: 1100 }, state: { status: "completed", input: { filePath: "a.ts" }, content: [{ type: "text", text: "file content" }], metadata: { title: "Read a.ts" } } },
      ],
      tokens: { input: 4, output: 2, reasoning: 0, cache: { read: 0, write: 0 } },
      cost: 0,
    } as SessionMessageInfo)[0]

    expect(mapped?.text).toBe("hello")
    expect(mapped?.parts[1]).toMatchObject({ tool: "read", title: "Read a.ts", output: "file content" })
  })
})

describe("mapSubSession", () => {
  const messages = [
    { id: "msg_1", type: "user", time: { created: 1000 }, text: "go" },
    {
      id: "msg_2", type: "assistant", time: { created: 1100, completed: 4200 },
      content: [
        { id: "prt_2", type: "tool", name: "grep", state: { status: "completed", input: {}, content: [{ type: "text", text: "found" }], metadata: { title: "search foo" } } },
        { id: "prt_3", type: "tool", name: "task", state: { status: "running", input: {}, metadata: { sessionId: "ses_grand" } } },
      ],
    },
  ] as SessionMessageInfo[]

  test("derives tools, count, and timing from child session messages", () => {
    const sub = mapSubSession("ses_child", messages, "running")
    expect(sub.sessionID).toBe("ses_child")
    expect(sub.status).toBe("running")
    expect(sub.toolcalls).toBe(2)
    expect(sub.tools.map((tool) => tool.tool)).toEqual(["grep", "task"])
    expect(sub.tools[0]?.title).toBe("search foo")
    expect(sub.tools[1]?.sessionID).toBe("ses_grand")
    expect(sub.startedAt).toBe(1000)
    expect(sub.completedAt).toBe(4200)
  })

  test("handles empty child session gracefully", () => {
    const sub = mapSubSession("ses_empty", [], "idle")
    expect(sub.toolcalls).toBe(0)
    expect(sub.tools).toEqual([])
  })
})

describe("mapSession", () => {
  test("preserves parentID for child sessions", () => {
    const mapped = mapSession({ id: "child", parentID: "root", title: "Child", agent: "build", time: { created: 1, updated: 2 } } as SessionInfo)
    expect(mapped.parentID).toBe("root")
  })
})
