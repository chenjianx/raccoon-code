import { expect, test } from "bun:test"
import { Effect } from "effect"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"
import { makeGatewayRequest, readUpstream } from "../src/handlers/raccoon-fim"

test("sends organization FIM requests to the authenticated completion gateway", async () => {
  const request = makeGatewayRequest(
    { baseURL: "https://raccoon.example", access: "access-token", orgCode: "team" },
    { prefix: "before", suffix: "after", model: "custom-completion", language: "typescript", maxTokens: 4096 },
    new AbortController().signal,
  )

  expect(request.url).toBe("https://raccoon.example/api/plugin/org/llm/v2/completions")
  expect(request.headers.get("authorization")).toBe("Bearer access-token")
  expect(request.headers.get("x-org-code")).toBe("team")
  expect(await request.json()).toEqual({
    model: "custom-completion",
    input: { language_id: "typescript", prefix: "before", suffix: "after" },
    n: 1,
    stream: true,
    stop: "<EOT>",
    temperature: 0.01,
    max_new_tokens: 1024,
  })
})

test("omits built-in model IDs on the personal completion gateway", async () => {
  const request = makeGatewayRequest(
    { baseURL: "https://raccoon.example", access: "access-token" },
    { prefix: "before", model: "raccoon-pro-completion" },
    new AbortController().signal,
  )
  expect(request.url).toBe("https://raccoon.example/api/plugin/llm/v2/completions")
  expect(request.headers.get("x-org-code")).toBeNull()
  expect(await request.json()).toEqual({
    input: { language_id: "unknown", prefix: "before", suffix: "" },
    n: 1,
    stream: true,
    stop: "<EOT>",
    temperature: 0.01,
    max_new_tokens: 1024,
  })
})

test("streams fragmented completion frames and preserves the final delta", async () => {
  const chunks = [
    'data: {"choices":[{"delta":"hel',
    'lo"}]}\r\n\r\ndata: {"data":{"is_heartbeat":true}}\r\n\r\n',
    'data: {"choices":[{"delta":"!","finish_reason":"stop"}]}\r\n\r\n',
  ]
  const response = new Response(
    new ReadableStream({
      start(controller) {
        chunks.forEach((chunk) => controller.enqueue(new TextEncoder().encode(chunk)))
        controller.close()
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  )

  expect(await Array.fromAsync(readUpstream(response))).toEqual([
    { type: "delta", text: "hello" },
    { type: "delta", text: "!" },
    { type: "done" },
  ])
})

test("ends when the final frame has text even if upstream leaves the stream open", async () => {
  const response = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":"last","finish_reason":"stop"}]}\n\n'))
    },
  }))

  expect(await Array.fromAsync(readUpstream(response))).toEqual([{ type: "delta", text: "last" }, { type: "done" }])
})

test("surfaces upstream status errors instead of ending successfully", async () => {
  const response = new Response('data: {"data":{"status":{"code":401,"message":"expired"}}}\n\n', {
    headers: { "content-type": "text/event-stream" },
  })

  expect(await Array.fromAsync(readUpstream(response))).toEqual([{ type: "error", message: "expired" }])
})

test("preserves upstream HTTP status for completion backoff", async () => {
  expect(await Array.fromAsync(readUpstream(new Response(null, { status: 429 })))).toEqual([
    { type: "error", message: "upstream: 429" },
  ])
})

it.live("rejects malformed FIM requests at the HTTP boundary", () =>
  Effect.gen(function* () {
    const handler = yield* ServerFetch.make({
      database: { path: ":memory:" },
      config: { directory: process.cwd() },
      fs: { filewatcher: false },
      models: { fetch: false },
    })
    const response = yield* Effect.promise(() =>
      handler(
        new Request("http://opencode.local/api/fim", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ prefix: 123 }),
        }),
      ),
    )
    expect(response.status).toBe(400)
  }),
)
