import { expect, test } from "bun:test"
import { RaccoonProvider } from "./index.js"

test("a captured function action sends the exact editor snapshot and reveals chat", async () => {
  const calls: string[] = []
  const provider = Object.create(RaccoonProvider.prototype) as RaccoonProvider & Record<string, unknown>
  provider.platform = { ui: { revealChat: async () => { calls.push("reveal") } } }
  provider.state = {
    activeSessionID: "session-1",
    mode: "build",
    selectedModel: { providerID: "provider", modelID: "model" },
    pluginLanguage: "en",
  }
  provider.sessions = {
    sendMessage: async (_sessionID: string, prompt: string) => { calls.push(prompt) },
  }

  await provider.sendCapturedEditorContext("EXPLAIN", {
    filePath: "src/Foo.java",
    selectedText: "void run() {}",
    startLine: 4,
    endLine: 4,
    diagnostics: [],
  })

  expect(calls[0]).toBe("reveal")
  expect(calls[1]).toContain("void run() {}")
  expect(calls[1]).toContain("src/Foo.java")
})

test("a captured add-to-context action appends the exact snapshot without sending", async () => {
  const calls: string[] = []
  const provider = Object.create(RaccoonProvider.prototype) as RaccoonProvider & Record<string, unknown>
  provider.platform = { ui: { revealChat: async () => { calls.push("reveal") } } }
  provider.state = { pluginLanguage: "en" }
  provider.webviewHost = {
    post: (_source: string, message: { type: string; text: string; replace: boolean }) => {
      calls.push(`${message.type}:${message.replace}:${message.text}`)
    },
  }

  await provider.appendCapturedEditorContext({
    filePath: "src/Foo.java",
    selectedText: "void run() {}",
    startLine: 4,
    endLine: 4,
    diagnostics: [],
  })

  expect(calls[0]).toBe("reveal")
  expect(calls[1]).toContain("appendPrompt:false:")
  expect(calls[1]).toContain("void run() {}")
  expect(calls[1]).toContain("src/Foo.java")
})
