// raccoon_change start - verify bundled marketplace and knowledge skills
import { expect } from "bun:test"
import { Effect } from "effect"
import path from "path"
import { SkillPlugin } from "@opencode/core/plugin/skill"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { IntegrationConnection } from "@opencode/core/integration/connection"
import { Integration } from "@opencode/core/integration"
import { Credential } from "@opencode/core/credential"
import { Config } from "@opencode/core/config"
import { Skill } from "@opencode/core/skill"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "../plugin/fixture"
import { host } from "../plugin/host"

const it = testEffect(PluginTestLayer)

it.live("registers the Raccoon marketplace and knowledge skills", () =>
  Effect.gen(function* () {
    const skills = yield* Skill.Service
    const hooks = yield* PluginHooks.Service
    yield* SkillPlugin.Plugin.effect(
      host({
        app: { name: "raccoon", version: "test", channel: "test" },
        shell: { hook: (name, callback) => hooks.register("shell", name, callback) },
        skill: {
          list: () => Effect.die("unused skill.list"),
          transform: skills.transform,
          reload: skills.reload,
        },
      }),
    ).pipe(Effect.provide(Config.testLayer()))

    const marketplace = yield* skills.get(Skill.ID.make("raccoon-config"))
    const knowledge = yield* skills.get(Skill.ID.make("knowledge"))

    expect(marketplace).toBeDefined()
    expect(knowledge).toBeDefined()
    expect(marketplace?.content).toContain("MCP")
    expect(marketplace?.content).toContain('"servers": {')
    expect(marketplace?.content).not.toContain('"enabled": true')
    expect(marketplace?.content).toContain("RACCOON_CLI=1")
    expect(knowledge?.content).toContain("knowledge_mcp_client.py")
    expect(yield* Effect.promise(() => Bun.file(path.join(path.dirname(knowledge!.path), "scripts/knowledge_mcp_client.py")).exists())).toBe(true)
  }),
)

it.effect("does not register Raccoon skills in other hosts", () =>
  Effect.gen(function* () {
    const skills = yield* Skill.Service
    yield* SkillPlugin.Plugin.effect(host({
      skill: { list: () => Effect.die("unused skill.list"), transform: skills.transform, reload: skills.reload },
    })).pipe(Effect.provide(Config.testLayer()))
    expect(yield* skills.get(Skill.ID.make("raccoon-config"))).toBeUndefined()
    expect(yield* skills.get(Skill.ID.make("knowledge"))).toBeUndefined()
  }),
)

it.effect("resolves the active Raccoon credential before the knowledge client runs", () =>
  Effect.gen(function* () {
    const hooks = yield* PluginHooks.Service
    const skills = yield* Skill.Service
    const resolved: string[] = []
    const connection = IntegrationConnection.CredentialInfo.make({
      type: "credential", id: Credential.ID.create(), label: "Raccoon", method: "oauth",
    })
    yield* SkillPlugin.Plugin.effect(
      host({
        app: { name: "raccoon", version: "test", channel: "test" },
        skill: { list: () => Effect.die("unused skill.list"), transform: skills.transform, reload: skills.reload },
        shell: { hook: (name, callback) => hooks.register("shell", name, callback) },
        integration: {
          ...host().integration,
          connection: {
            ...host().integration.connection,
            active: () => Effect.succeed(connection),
            resolve: () => Effect.sync(() => {
              resolved.push("raccoon")
              return Credential.OAuth.make({ type: "oauth", methodID: Integration.MethodID.make("browser"), access: "secret", refresh: "secret", expires: Date.now() + 60_000 })
            }),
          },
        },
      }),
    ).pipe(Effect.provide(Config.testLayer()))
    const invocation = { command: "echo unrelated", cwd: "/", shell: "sh", timeout: 1000, env: {} }
    yield* hooks.trigger("shell", "create.before", invocation)
    expect(resolved).toEqual([])
    invocation.command = "python3 scripts/knowledge_mcp_client.py list"
    yield* hooks.trigger("shell", "create.before", invocation)
    expect(resolved).toEqual(["raccoon"])
    expect(invocation.env).toEqual({})
    const cli = { ...invocation, env: { RACCOON_CLI: "1" } as Record<string, string | undefined> }
    yield* hooks.trigger("shell", "create.before", cli)
    expect(cli.env.OPENCODE_DB).toBe("opencode-test.db")
  }),
)
// raccoon_change end
