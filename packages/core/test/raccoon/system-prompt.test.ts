// raccoon_change start - verify native prompt branding only for the Raccoon host
import { expect, test } from "bun:test"
import { SystemPart } from "@opencode/ai"
import { Agent } from "@opencode/core/agent"
import { Model } from "@opencode/core/model"
import { Plugin } from "@opencode/core/plugin"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { PluginHost } from "@opencode/core/plugin/host"
import { OptimizePlugin } from "@opencode/core/plugin/optimize"
import { Provider } from "@opencode/core/provider"
import { RaccoonPrompt } from "@opencode/core/raccoon/prompt"
import { Session } from "@opencode/core/session"
import { Effect } from "effect"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "../plugin/fixture"

const it = testEffect(PluginTestLayer)

test("brands only the built-in first line for Raccoon", () => {
  const prompt = "You are an AI agent running in OpenCode, a coding agent harness.\nKeep OpenCode references in user content."
  expect(RaccoonPrompt.brand(prompt, "raccoon")).toBe(
    "You are an AI agent running in Raccoon, a coding agent harness.\nKeep OpenCode references in user content.",
  )
  expect(RaccoonPrompt.brand("You are opencode, an interactive CLI tool.", "raccoon")).toBe(
    "You are Raccoon, an interactive CLI tool.",
  )
})

test("leaves other hosts and custom prompts unchanged", () => {
  const builtIn = "You are OpenCode, an agent."
  expect(RaccoonPrompt.brand(builtIn, "opencode")).toBe(builtIn)
  expect(RaccoonPrompt.brand("OpenCode appears in a custom user prompt.", "raccoon")).toBe(
    "OpenCode appears in a custom user prompt.",
  )
})

it.effect("brands the selected V2 model prompt after optimization", () =>
  Effect.gen(function* () {
    const agents = yield* Agent.Service
    const providers = yield* Provider.Service
    const hooks = yield* PluginHooks.Service
    const plugins = yield* Plugin.Service
    yield* agents.transform((editor) => editor.update(Agent.ID.make("build"), () => {}))
    yield* providers.transform((editor) => editor.models.update(Provider.ID.make("test"), Model.ID.make("gpt-5"), () => {}))
    const host = { ...(yield* PluginHost.make(plugins)), app: { name: "raccoon", version: "test", channel: "test" } }
    yield* OptimizePlugin.OpenAIPlugin.effect(host)
    yield* RaccoonPrompt.Plugin.effect(host)
    const event = {
      sessionID: Session.ID.make("ses_raccoon_prompt"),
      agent: Agent.ID.make("build"),
      model: Model.Ref.make({ providerID: Provider.ID.make("test"), id: Model.ID.make("gpt-5") }),
      system: [SystemPart.make("You are an AI agent running in OpenCode.")],
      messages: [], tools: {}, options: {},
    }
    yield* hooks.trigger("session", "context", event)
    expect(event.system[0]?.text).toStartWith("You are an AI agent running in Raccoon,")
    expect(event.system[0]?.text).toContain("https://xiaohuanxiong.com/code")
  }),
)
// raccoon_change end
