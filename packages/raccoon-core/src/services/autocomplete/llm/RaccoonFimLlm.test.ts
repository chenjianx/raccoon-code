import { expect, test } from "bun:test"
import { OpenCode } from "@opencode/client/promise"
import { getAutocompleteModel } from "../models"
import { RaccoonFimLlm } from "./RaccoonFimLlm"

test("streams FIM through the V2 client with the selected model and abort signal", async () => {
  const requests: Request[] = []
  const controller = new AbortController()
  const client = OpenCode.make({
    baseUrl: "http://localhost:3000",
    fetch: async (input, init) => {
      requests.push(new Request(input, init))
      return new Response('data: {"type":"delta","text":"42"}\n\ndata: {"type":"done"}\n\n', {
        headers: { "content-type": "text/event-stream" },
      })
    },
  })
  const llm = new RaccoonFimLlm({
    getConnectionState: () => "connected",
    getClientAsync: async () => client,
  }, "/workspace", "raccoon-completion")
  const chunks: string[] = []
  for await (const chunk of llm.streamFim("const answer = ", "\n", "typescript", controller.signal)) chunks.push(chunk)

  expect(chunks).toEqual(["42"])
  expect(requests[0]?.url).toBe("http://localhost:3000/api/fim")
  expect(await requests[0]?.json()).toEqual({
    prefix: "const answer = ", suffix: "\n", model: "raccoon-completion", language: "typescript",
    maxTokens: 1024, temperature: getAutocompleteModel("raccoon-completion").temperature,
  })
  controller.abort()
  expect(requests[0]?.signal.aborted).toBe(true)
})
