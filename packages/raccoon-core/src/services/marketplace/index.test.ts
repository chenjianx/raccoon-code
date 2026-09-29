import { expect, test } from "bun:test"
import { MarketplaceService } from "./index.js"

test("MCP status uses the v2 location-scoped server list", async () => {
  const directory = "/workspace/project"
  const client = {
    mcp: {
      list: async (input: unknown) => {
        expect(input).toEqual({ location: { directory } })
        return { location: { directory }, data: [
          { name: "ready", status: { status: "connected" } },
          { name: "starting", status: { status: "pending" } },
          { name: "broken", status: { status: "failed", error: "unavailable" } },
        ] }
      },
    },
  } as never
  expect(await new MarketplaceService().status(client, directory)).toEqual({
    ready: { status: "connected" },
    broken: { status: "failed", error: "unavailable" },
  })
})
