// @ts-expect-error Bun exposes this module to tests; the Sidecar compiler intentionally loads Node-only types.
import { expect, test } from "bun:test"
import { TerminalContextRequests } from "./terminal-context.js"
import type { SidecarToHost } from "./rpc.js"

test("routes the IDE terminal snapshot back to its request", async () => {
  const sent: SidecarToHost[] = []
  const requests = new TerminalContextRequests((message) => sent.push(message))
  const pending = requests.capture()
  const request = sent[0]
  expect(request?.type).toBe("captureTerminal")
  if (request?.type !== "captureTerminal") return
  requests.receive({ type: "terminalContextResult", requestID: request.requestID, name: "Local", output: "ready\n" })
  expect(await pending).toEqual({ name: "Local", output: "ready\n" })
  requests.dispose()
})

test("resolves pending captures when the sidecar shuts down", async () => {
  const requests = new TerminalContextRequests(() => {})
  const pending = requests.capture()
  requests.dispose()
  expect(await pending).toBeUndefined()
})
