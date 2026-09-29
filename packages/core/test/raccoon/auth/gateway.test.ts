// raccoon_change start - verify gateway request and stream compatibility
import { describe, expect, test } from "bun:test"
import { RaccoonGateway } from "../../../src/raccoon/auth/gateway.js"

describe("Raccoon gateway", () => {
  test("rewrites chat requests and keeps personal accounts unscoped", async () => {
    const request = RaccoonGateway.rewrite("https://raccoon.example", undefined, "https://other.example/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: "raccoon-chat", max_tokens: 120, messages: [{ role: "user", content: [{ text: "hello" }] }] }),
    })
    expect(request.url).toBe("https://raccoon.example/api/plugin/llm/v2/chat-completions")
    expect(JSON.parse(String(request.init.body))).toMatchObject({ max_new_tokens: 120, messages: [{ content: "hello" }] })
    expect(JSON.parse(String(request.init.body)).model).toBeUndefined()
  })

  test("normalizes a wrapped SSE chunk and heartbeat", async () => {
    const response = RaccoonGateway.normalize(
      new Response('data: {"is_heartbeat":true}\n\ndata: {"data":{"choices":[{"delta":"hi","finish_reason":""}]}}\n\n', {
        headers: { "content-type": "text/event-stream" },
      }),
    )
    const body = await response.text()
    expect(body).not.toContain("is_heartbeat")
    expect(body).toContain('"content":"hi"')
    expect(body).toContain('"finish_reason":null')
  })

  test("preserves malformed chunks while surfacing engine errors", async () => {
    const response = RaccoonGateway.normalize(
      new Response('data: not-json\n\ndata: {"status":{"code":9,"message":"engine unavailable"},"choices":null}\n\n', {
        headers: { "content-type": "text/event-stream" },
      }),
    )
    const body = await response.text()
    expect(body).toContain("data: not-json")
    expect(body).toContain('"message":"engine unavailable"')
  })

  test("sends the current token and organization code to the gateway", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        return Response.json({
          path: new URL(request.url).pathname,
          authorization: request.headers.get("authorization"),
          orgCode: request.headers.get("x-org-code"),
        })
      },
    })
    try {
      const response = await RaccoonGateway.send(
        { baseURL: `http://localhost:${server.port}`, access: "fresh-token", orgCode: "team" },
        "https://unused.example/v1/completions",
        { method: "POST", body: JSON.stringify({ model: "custom" }) },
      )
      expect(await response.json()).toEqual({
        path: "/api/plugin/org/llm/v2/completions",
        authorization: "Bearer fresh-token",
        orgCode: "team",
      })
    } finally {
      server.stop()
    }
  })
})
// raccoon_change end
