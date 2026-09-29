import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { MarketplaceInstaller } from "./installer.js"

function client(config: string, reloads: { count: number }) {
  return {
    config: { get: async () => [{ type: "directory", path: config }] },
    location: { reload: async () => { reloads.count++ } },
  } as never
}

describe("MarketplaceInstaller v2 config", () => {
  test("writes a native MCP server in the server's global config root", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "raccoon-mcp-workspace-"))
    const config = await mkdtemp(join(tmpdir(), "raccoon-mcp-config-"))
    const reloads = { count: 0 }
    try {
      const result = await new MarketplaceInstaller().installManual(client(config, reloads), workspace, {
        id: "sample",
        scope: "user",
        config: { type: "remote", url: "https://example.test/mcp", enabled: false, timeout: 12000 },
      })
      expect(result).toEqual({ success: true, id: "sample", scope: "user" })
      const file = JSON.parse(await readFile(join(config, "raccoon.jsonc"), "utf8"))
      expect(file.mcp.servers.sample).toEqual({
        type: "remote", url: "https://example.test/mcp", disabled: true,
        timeout: { catalog: 12000, execution: 12000 },
      })
      expect(reloads.count).toBe(1)
    } finally {
      await rm(workspace, { recursive: true, force: true })
      await rm(config, { recursive: true, force: true })
    }
  })

  test("reads and removes a legacy MCP server without leaving a native shadow", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "raccoon-mcp-workspace-"))
    const config = await mkdtemp(join(tmpdir(), "raccoon-mcp-config-"))
    const reloads = { count: 0 }
    try {
      await writeFile(join(config, "raccoon.jsonc"), JSON.stringify({ mcp: {
        sample: { type: "local", command: ["npx", "sample"], enabled: false },
      } }))
      const installer = new MarketplaceInstaller()
      expect(await installer.listInstalled(client(config, reloads), workspace)).toEqual([{
        id: "sample", scope: "user", config: { type: "local", command: ["npx", "sample"], enabled: false },
      }])
      await installer.removeById(client(config, reloads), workspace, "sample", "user")
      expect(await installer.listInstalled(client(config, reloads), workspace)).toEqual([])
      expect(reloads.count).toBe(1)
    } finally {
      await rm(workspace, { recursive: true, force: true })
      await rm(config, { recursive: true, force: true })
    }
  })

  test("updating a legacy MCP server migrates it to the native config shape", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "raccoon-mcp-workspace-"))
    const config = await mkdtemp(join(tmpdir(), "raccoon-mcp-config-"))
    const reloads = { count: 0 }
    try {
      await writeFile(join(config, "raccoon.jsonc"), JSON.stringify({ mcp: {
        sample: { type: "local", command: ["npx", "old"] },
      } }))
      const installer = new MarketplaceInstaller()
      await installer.updateConfig(client(config, reloads), workspace, "sample", "user", {
        type: "local", command: ["npx", "new"], enabled: false,
      })
      const file = JSON.parse(await readFile(join(config, "raccoon.jsonc"), "utf8"))
      expect(file.mcp.sample).toBeUndefined()
      expect(file.mcp.servers.sample).toEqual({ type: "local", command: ["npx", "new"], disabled: true })
      expect(reloads.count).toBe(1)
    } finally {
      await rm(workspace, { recursive: true, force: true })
      await rm(config, { recursive: true, force: true })
    }
  })

  test("toggling a legacy MCP server migrates its enabled state", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "raccoon-mcp-workspace-"))
    const config = await mkdtemp(join(tmpdir(), "raccoon-mcp-config-"))
    const reloads = { count: 0 }
    try {
      await writeFile(join(config, "raccoon.jsonc"), JSON.stringify({ mcp: {
        sample: { type: "remote", url: "https://example.test/mcp", enabled: true },
      } }))
      await new MarketplaceInstaller().setEnabled(client(config, reloads), workspace, "sample", "user", false)
      const file = JSON.parse(await readFile(join(config, "raccoon.jsonc"), "utf8"))
      expect(file.mcp.sample).toBeUndefined()
      expect(file.mcp.servers.sample).toEqual({ type: "remote", url: "https://example.test/mcp", disabled: true })
      expect(reloads.count).toBe(1)
    } finally {
      await rm(workspace, { recursive: true, force: true })
      await rm(config, { recursive: true, force: true })
    }
  })
})
