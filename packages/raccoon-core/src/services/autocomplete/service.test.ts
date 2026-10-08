import { expect, test } from "bun:test"
import type { OpencodeClient } from "@opencode-ai/sdk/v2/client"
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
      complete: async () => ({
        stream: (async function* () {
          yield { type: "delta", text: "42" }
          yield { type: "done" }
        })(),
      }),
    },
  } as unknown as OpencodeClient
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
      complete: async (request: { fimRequest: { model: string } }) => {
        requestedModel = request.fimRequest.model
        return {
          stream: (async function* () {
            yield { type: "done" }
          })(),
        }
      },
    },
  } as unknown as OpencodeClient
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

test("notifies once and blocks requests after a 402 failure", async () => {
  let calls = 0
  const statuses: (number | null)[] = []
  const client = {
    fim: {
      complete: async () => {
        calls += 1
        throw new Error("FIM request failed: 402 Payment Required")
      },
    },
  } as unknown as OpencodeClient
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

test("clears activity when a request fails", async () => {
  const activities: boolean[] = []
  const client = {
    fim: {
      complete: async () => {
        throw new Error("FIM request failed: 500 Internal Server Error")
      },
    },
  } as unknown as OpencodeClient
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
