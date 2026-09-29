// raccoon_change start - verify Raccoon gateway routing and credential metadata
import { describe, expect, test } from "bun:test"
import { RaccoonConnection } from "../../../src/raccoon/auth/connection.js"

describe("Raccoon connection", () => {
  test("routes personal and organization requests to their own gateways", () => {
    expect(RaccoonConnection.gatewayPath(undefined, "completions")).toBe("/api/plugin/llm/v2/completions")
    expect(RaccoonConnection.gatewayPath("team", "completions")).toBe("/api/plugin/org/llm/v2/completions")
    expect(RaccoonConnection.gatewayPath(undefined, "chat-completions")).toBe("/api/plugin/llm/v2/chat-completions")
    expect(RaccoonConnection.gatewayPath("team", "chat-completions")).toBe("/api/plugin/org/llm/v2/chat-completions")
  })

  test("keeps a personal account unscoped", () => {
    expect(RaccoonConnection.orgCode({ orgs: [{ id: "org-1", name: "Team" }], id: "user-1" })).toBeUndefined()
    expect(RaccoonConnection.orgCode({ orgs: [{ id: "org-1", code: "team", name: "Team" }] })).toBe("team")
  })

  test("accepts legacy enterprise URL metadata", () => {
    expect(RaccoonConnection.baseURLFromMetadata({ enterpriseUrl: "https://legacy.example/" })).toBe(
      "https://legacy.example",
    )
  })
})
// raccoon_change end
