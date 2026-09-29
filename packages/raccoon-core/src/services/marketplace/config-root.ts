import type { OpenCodeClient } from "@opencode/client/promise"
import { homedir } from "node:os"
import { join } from "node:path"

export async function globalConfigRoot(client: OpenCodeClient, directory: string) {
  const entries = await client.config.get({ location: { directory } })
  const root = entries.find((entry) => entry.type === "directory")
  if (root) return root.path
  return process.env.OPENCODE_CONFIG_DIR
    ?? join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), process.env.RACCOON_CLI === "1" ? "raccoon" : "opencode")
}
