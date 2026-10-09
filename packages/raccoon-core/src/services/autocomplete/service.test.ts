import { expect, test } from "bun:test"
import { OpenCode, type OpenCodeClient } from "@opencode/client/promise"
import { DEFAULT_AUTOCOMPLETE_MODEL } from "./models"
import { RaccoonAutocompleteService } from "./service"

const input = {
  completionId: "completion-1",
  filepath: "/workspace/example.ts",
  languageId: "typescript",
  pos: { line: 0, character: 14 },
  fileContents: "const answer = ",
  isUntitledFile: false,
}

test("completes through a connected host-neutral port", async () => {
  const client = {
    fim: {
      complete: async function* () {
        yield { type: "delta", text: "42" }
        yield { type: "done" }
      },
    },
  } as unknown as OpenCodeClient
  const service = new RaccoonAutocompleteService(
    {
      getConnectionState: () => "connected",
      getClientAsync: async () => client,
    },
    "/workspace",
    "raccoon-pro-completion",
  )

  expect((await service.complete(input, new AbortController().signal))?.completion).toBe("42")
})

test("does not create a client while disconnected", async () => {
  let calls = 0
  const service = new RaccoonAutocompleteService(
    {
      getConnectionState: () => "disconnected",
      getClientAsync: async () => {
        calls += 1
        throw new Error("must not connect")
      },
    },
    "/workspace",
    "raccoon-pro-completion",
  )

  expect(await service.complete(input, new AbortController().signal)).toBeUndefined()
  expect(calls).toBe(0)
})

test("returns no completion for an aborted request", async () => {
  const controller = new AbortController()
  let calls = 0
  const service = new RaccoonAutocompleteService(
    {
      getConnectionState: () => "connected",
      getClientAsync: async () => {
        calls += 1
        throw new Error("must not request after cancellation")
      },
    },
    "/workspace",
    "raccoon-pro-completion",
  )
  controller.abort()
  expect(await service.complete(input, controller.signal)).toBeUndefined()
  expect(calls).toBe(0)
})

test("normalizes an unknown model before the next FIM request", async () => {
  let requestedModel: string | undefined
  const client = {
    fim: {
      complete: async function* (request: { model: string }) {
        requestedModel = request.model
        yield { type: "done" }
      },
    },
  } as unknown as OpenCodeClient
  const service = new RaccoonAutocompleteService(
    {
      getConnectionState: () => "connected",
      getClientAsync: async () => client,
    },
    "/workspace",
    "raccoon-pro-completion",
  )

  service.setModel("unknown")
  await service.complete(input, new AbortController().signal)

  expect(requestedModel).toBe(DEFAULT_AUTOCOMPLETE_MODEL.id)
})

test("uses the selected model for identical input after a model change", async () => {
  const requestedModels: string[] = []
  const client = OpenCode.make({
    baseUrl: "http://localhost:3000",
    fetch: async (request, init) => {
      const payload = await new Request(request, init).json()
      requestedModels.push(payload.model)
      const text = payload.model === "raccoon-pro-completion" ? "42" : "43"
      return new Response(`data: ${JSON.stringify({ type: "delta", text })}\n\ndata: {"type":"done"}\n\n`, {
        headers: { "content-type": "text/event-stream" },
      })
    },
  })
  const service = new RaccoonAutocompleteService(
    { getConnectionState: () => "connected", getClientAsync: async () => client },
    "/workspace",
    "raccoon-pro-completion",
  )

  expect((await service.complete(input, new AbortController().signal))?.completion).toBe("42")
  service.setModel("raccoon-completion")
  expect((await service.complete(input, new AbortController().signal))?.completion).toBe("43")
  expect(requestedModels).toEqual(["raccoon-pro-completion", "raccoon-completion"])
})

test("notifies once and blocks requests after a 402 failure", async () => {
  let calls = 0
  const statuses: (number | null)[] = []
  const client = {
    fim: {
      complete: async function* () {
        calls += 1
        throw new Error("FIM request failed: 402 Payment Required")
      },
    },
  } as unknown as OpenCodeClient
  const service = new RaccoonAutocompleteService(
    {
      getConnectionState: () => "connected",
      getClientAsync: async () => client,
    },
    "/workspace",
    "raccoon-pro-completion",
    { onFatalError: (status) => statuses.push(status) },
  )

  expect(await service.complete(input, new AbortController().signal)).toBeUndefined()
  expect(await service.complete(input, new AbortController().signal)).toBeUndefined()
  expect(calls).toBe(1)
  expect(statuses).toEqual([402])
})

test("blocks native V2 authentication failures until recovery", async () => {
  let calls = 0
  const statuses: (number | null)[] = []
  const client = OpenCode.make({
    baseUrl: "http://localhost:3000",
    fetch: async () => {
      calls += 1
      return Response.json({ _tag: "UnauthorizedError", message: "Authentication required" }, { status: 401 })
    },
  })
  const service = new RaccoonAutocompleteService(
    { getConnectionState: () => "connected", getClientAsync: async () => client },
    "/workspace",
    "raccoon-pro-completion",
    { onFatalError: (status) => statuses.push(status) },
  )

  await service.complete(input, new AbortController().signal)
  await service.complete({ ...input, fileContents: "const next =  " }, new AbortController().signal)
  expect(calls).toBe(1)
  expect(statuses).toEqual([401])
  service.resetBackoff()
  await service.complete({ ...input, fileContents: "const retry = " }, new AbortController().signal)
  expect(calls).toBe(2)
  expect(statuses).toEqual([401, 401])
})

test("clears activity when a request fails", async () => {
  const activities: boolean[] = []
  const client = {
    fim: {
      complete: async function* () {
        throw new Error("FIM request failed: 500 Internal Server Error")
      },
    },
  } as unknown as OpenCodeClient
  const service = new RaccoonAutocompleteService(
    {
      getConnectionState: () => "connected",
      getClientAsync: async () => client,
    },
    "/workspace",
    "raccoon-pro-completion",
    { onActivity: (active) => activities.push(active) },
  )

  expect(await service.complete(input, new AbortController().signal)).toBeUndefined()
  expect(activities).toEqual([true, false])
})
