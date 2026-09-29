// raccoon_change start - register bundled Raccoon skills with the V2 skill registry
export * as RaccoonSkill from "./skill.js"

import { mkdir } from "node:fs/promises"
import path from "node:path"
import { Effect } from "effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Global } from "@opencode/util/global"
import { ConfigMarkdown } from "../config/markdown.js"
import { AbsolutePath } from "../schema.js"
import { Skill } from "../skill.js"
import { RaccoonConnection } from "./auth/connection.js"
import marketplaceContent from "../plugin/skill/raccoon-config.md" with { type: "text" }
import knowledgeContent from "./knowledge-skill/SKILL.md" with { type: "text" }
import apiReference from "./knowledge-skill/references/api.md" with { type: "text" }
import knowledgeClient from "./knowledge-skill/scripts/knowledge_mcp_client.py" with { type: "text" }

export const marketplace = Skill.Info.make({
  id: Skill.ID.make("raccoon-config"),
  name: Skill.Name.make("Raccoon Config"),
  description:
    "Use when the user wants to install an MCP server or skill by name from the Raccoon marketplace.",
  path: AbsolutePath.make("/builtin/raccoon-config.md"),
  content: marketplaceContent,
})

export const knowledge = Effect.fn("RaccoonSkill.knowledge")(function* () {
  const root = path.join(
    process.env.OPENCODE_TEST_HOME ? path.join(process.env.OPENCODE_TEST_HOME, ".cache", "raccoon") : Global.Path.cache,
    "builtin-skills",
    "knowledge",
  )
  yield* Effect.promise(async () => {
    await Promise.all([
      mkdir(path.join(root, "references"), { recursive: true }),
      mkdir(path.join(root, "scripts"), { recursive: true }),
    ])
    await Promise.all([
      Bun.write(path.join(root, "SKILL.md"), knowledgeContent),
      Bun.write(path.join(root, "references", "api.md"), apiReference),
      Bun.write(path.join(root, "scripts", "knowledge_mcp_client.py"), knowledgeClient),
    ])
  })
  return Skill.Info.make({
    id: Skill.ID.make("knowledge"),
    name: Skill.Name.make("Knowledge"),
    description:
      "Load this skill when the user asks to search or answer questions from Raccoon cloud knowledge bases.",
    path: AbsolutePath.make(path.join(root, "SKILL.md")),
    content: ConfigMarkdown.parse(knowledgeContent).content,
  })
})

// Refresh through the host before the standalone client reads its current access token.
export const refreshKnowledge = Effect.fn("RaccoonSkill.refreshKnowledge")(function* (ctx: Context) {
  if (ctx.app.name !== "raccoon") return
  yield* ctx.shell.hook("create.before", (event) => {
    if (!event.command.includes("knowledge_mcp_client.py")) return Effect.void
    // The CLI selects a channel database; pass only its filename to this one script.
    if (event.env.RACCOON_CLI === "1" && !event.env.OPENCODE_DB)
      event.env.OPENCODE_DB =
        ["latest", "dev", "beta", "next", "prod"].includes(ctx.app.channel) ||
        ["1", "true"].includes(event.env.OPENCODE_DISABLE_CHANNEL_DB ?? "")
          ? "opencode.db"
          : `opencode-${ctx.app.channel.replace(/[^a-zA-Z0-9._-]/g, "-")}.db`
    return RaccoonConnection.resolvePlugin(ctx.integration).pipe(
      Effect.tapError((cause) => Effect.logWarning("failed to refresh Raccoon knowledge credential", { cause })),
      Effect.catch(() => Effect.void),
      Effect.asVoid,
    )
  })
})
// raccoon_change end
