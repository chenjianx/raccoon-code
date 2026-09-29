import { expect, test } from "bun:test"
import type { IntegrationInfo } from "@opencode/client"
import { loginChoices } from "../../src/commands/handlers/auth/login"

const integration = (id: string, name: string, metadata?: IntegrationInfo["metadata"]): IntegrationInfo => ({
  id,
  name,
  methods: [{ type: "key" }],
  connections: [],
  metadata,
})

test("Raccoon login is the recommended first choice in the Raccoon CLI", () => {
  const previous = process.env.RACCOON_CLI
  process.env.RACCOON_CLI = "1"
  try {
    expect(
      loginChoices([
        integration("openai", "OpenAI"),
        integration("mcp_example", "Example MCP", { source: "mcp" }),
        integration("raccoon", "Raccoon"),
      ]),
    ).toEqual([
      { value: "raccoon", label: "Raccoon", category: "Popular", connected: false, hint: "recommended" },
      { value: "mcp_example", label: "Example MCP", category: "MCP", connected: false },
      { value: "openai", label: "OpenAI", category: "Popular", connected: false },
    ])
  } finally {
    if (previous === undefined) delete process.env.RACCOON_CLI
    else process.env.RACCOON_CLI = previous
  }
})
