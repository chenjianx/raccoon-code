// raccoon_change start - brand only built-in V2 prompts for Raccoon hosts
export * as RaccoonPrompt from "./prompt.js"

import { define } from "@opencode/plugin/effect/plugin"
import type { SessionHooks } from "@opencode/plugin/effect/session"
import { Effect } from "effect"

const builtIn = /^(You are an AI agent running in OpenCode,|You are OpenCode,|You are opencode,)/
const documentation =
  "\n\n# Raccoon documentation\nWhen the user asks about Raccoon features or configuration, consult https://xiaohuanxiong.com/code with WebFetch when available before answering."

export function brand(text: string, app: string) {
  if (app !== "raccoon") return text
  const end = text.indexOf("\n")
  const first = end < 0 ? text : text.slice(0, end)
  if (!builtIn.test(first)) return text
  return first.replace(/\b(?:OpenCode|opencode)\b/, "Raccoon") + (end < 0 ? "" : text.slice(end))
}

export const Plugin = define({
  id: "raccoon.prompt.brand",
  effect: Effect.fn("RaccoonPrompt.Plugin")(function* (ctx) {
    if (ctx.app.name !== "raccoon") return
    const hook = (event: SessionHooks["context"]) =>
      Effect.gen(function* () {
        if ((yield* ctx.agent.get({ agentID: event.agent })).data.system) return
        const system = event.system[0]
        if (!system) return
        const text = brand(system.text, ctx.app.name)
        if (text !== system.text) event.system[0] = { ...system, text: text + documentation }
      }).pipe(Effect.catch(() => Effect.void))
    yield* ctx.session.hook("context", hook)
    yield* ctx.session.hook("compaction", hook)
    yield* ctx.session.hook("generate", hook)
  }),
})
// raccoon_change end
