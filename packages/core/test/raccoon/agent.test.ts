// raccoon_change start - verify Raccoon-only read-only Ask agent
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Agent } from "@opencode/core/agent"
import { AgentPlugin } from "@opencode/core/plugin/agent"
import { Permission } from "@opencode/core/permission"
import { Session } from "@opencode/core/session"
import type { PermissionEvaluation } from "@opencode/plugin/effect/permission"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Bus } from "@opencode/core/bus"
import { Location } from "@opencode/core/location"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { AbsolutePath } from "@opencode/core/schema"
import { location } from "../fixture/location"
import { testEffect } from "../lib/effect"
import { agentHost, host } from "../plugin/host"

const current = location({ directory: AbsolutePath.make("/project") })
const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Agent.node, Bus.node, Location.node, PluginHooks.node]), [
    Global.node.replace(Layer.succeed(Global.Service, Global.Service.of(Global.make({ data: "/data", config: "/config", tmp: "/tmp/opencode" })))),
    Location.node.replace(Layer.succeed(Location.Service, Location.Service.of(current))),
  ]) as unknown as Layer.Layer<unknown, never>,
)

describe("Raccoon ask agent", () => {
  it.effect("provides a primary read-only agent with safe shell inspection rules", () =>
    Effect.gen(function* () {
      const agents = yield* Agent.Service
      const hooks = yield* PluginHooks.Service
      yield* AgentPlugin.Plugin.effect(host({
        app: { name: "raccoon", version: "test", channel: "test" },
        agent: agentHost(agents),
        permission: { ...host().permission, hook: (name, callback) => hooks.register("permission", name, callback) },
      }))
      const ask = yield* agents.get(Agent.ID.make("ask"))
      expect(ask?.mode).toBe("primary")
      expect(ask?.system).toContain("read-only")
      expect(ask?.system).toContain("project-level instruction files")
      expect(Permission.evaluate("read", "src/app.ts", ask?.permissions ?? []).effect).toBe("allow")
      expect(Permission.evaluate("read", ".env", ask?.permissions ?? []).effect).toBe("ask")
      expect(Permission.evaluate("edit", "src/app.ts", ask?.permissions ?? []).effect).toBe("deny")
      expect(Permission.evaluate("shell", "git status", ask?.permissions ?? []).effect).toBe("allow")
      expect(Permission.evaluate("shell", "git reset --hard", ask?.permissions ?? []).effect).toBe("deny")
      expect(Permission.evaluate("shell", "echo hello > output.txt", ask?.permissions ?? []).effect).toBe("deny")
      expect(Permission.evaluate("external_directory", "/other/file", ask?.permissions ?? []).effect).toBe("ask")
      expect(Permission.evaluate("external_directory", "/config/settings.json", ask?.permissions ?? []).effect).toBe("allow")
      const evaluation: PermissionEvaluation = {
        sessionID: Session.ID.make("ses_ask"), agent: Agent.ID.make("ask"), action: "edit", resources: ["src/app.ts"], effect: "allow",
      }
      yield* hooks.trigger("permission", "evaluate", evaluation)
      expect(evaluation.effect).toBe("deny")
      const mutation: PermissionEvaluation = { ...evaluation, action: "shell", resources: ["git reset --hard"], effect: "allow" }
      yield* hooks.trigger("permission", "evaluate", mutation)
      expect(mutation.effect).toBe("deny")
      const inspection: PermissionEvaluation = { ...mutation, resources: ["git status"], effect: "allow" }
      yield* hooks.trigger("permission", "evaluate", inspection)
      expect(inspection.effect).toBe("allow")
      const gh: PermissionEvaluation = { ...mutation, resources: ["gh repo view"], effect: "allow" }
      yield* hooks.trigger("permission", "evaluate", gh)
      expect(gh.effect).toBe("ask")
    }),
  )
})
// raccoon_change end
