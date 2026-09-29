// raccoon_change start - verify Raccoon profile conversion
import { describe, expect, test } from "bun:test"
import { RaccoonModels } from "../../../src/raccoon/auth/models.js"

describe("Raccoon models", () => {
  test("discovers organization profiles with the current access token", async () => {
    const requests: Array<{ path: string; auth: string | null; org: string | null }> = []
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const path = new URL(request.url).pathname
        requests.push({ path, auth: request.headers.get("authorization"), org: request.headers.get("x-org-code") })
        if (path.endsWith("/settings")) return Response.json({ data: { settings: { capabilities: ["chatv2"] } } })
        return Response.json({ data: { config: { models: [{ model: "team-chat", name: "Team Chat" }] } } })
      },
    })
    try {
      const models = await RaccoonModels.discover(`http://localhost:${server.port}`, "fresh-access", "team")
      expect(models.map((model) => String(model.id))).toEqual(["team-chat"])
      expect(requests.map((request) => request.path)).toEqual([
        "/api/plugin/setting/v1/settings",
        "/api/plugin/org/setting/v1/profiles",
      ])
      expect(requests[1]?.auth).toBe("Bearer fresh-access")
      expect(requests[1]?.org).toBe("team")
    } finally {
      server.stop()
    }
  })

  test("omits autocomplete profiles and keeps discovered limits", () => {
    const models = RaccoonModels.fromProfiles("https://raccoon.example", [
      { model: "fim", roles: ["autocomplete"] },
      { model: "chat", name: "Chat", capabilities: ["tool_use"], defaultCompletionOptions: { contextLength: 32_000 } },
    ])
    expect(models.map((model) => String(model.id))).toEqual(["chat"])
    expect(models[0]?.limit).toEqual({ context: 32_000, input: 27_904, output: 4096 })
    expect(models[0]?.capabilities.tools).toBe(true)
  })

  test("keeps tools enabled when a chat profile omits capability metadata", () => {
    const models = RaccoonModels.fromProfiles("https://raccoon.example", [{ model: "chat" }])
    expect(models[0]?.capabilities.tools).toBe(true)
  })
})
// raccoon_change end
