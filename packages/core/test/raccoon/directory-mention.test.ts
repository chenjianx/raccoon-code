// raccoon_change start - verify directory mentions use the permissioned ReadTool
import { expect } from "bun:test"
import { Agent } from "@opencode/core/agent"
import { Instance } from "@opencode/core/instance/service"
import { Permission } from "@opencode/core/permission"
import { Plugin } from "@opencode/core/plugin/service"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { Project } from "@opencode/core/project"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/schema/session"
import { SessionPrompt } from "@opencode/core/session/prompt"
import { SessionMessage } from "@opencode/core/session/message"
import { toLLMMessages } from "@opencode/core/session/runner/to-llm-message"
import { Tool } from "@opencode/core/tool"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { FSUtil } from "@opencode/util/fs-util"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { DateTime, Effect, Layer } from "effect"
import { Money } from "@opencode/schema/money"
import { Location } from "@opencode/schema/location"
import path from "path"
import { pathToFileURL } from "url"
import { testEffect } from "../lib/effect"

const it = testEffect(AppNodeBuilder.build(FSUtil.node))

it.effect("materializes a directory mention through ReadTool with file contents", () =>
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const directory = yield* fs.makeTempDirectoryScoped()
    yield* fs.writeFileString(path.join(directory, "child.ts"), "export const value = 42\n")
    const session = Session.Info.make({
      id: Session.ID.make("ses_directory_mention"),
      projectID: Project.ID.global,
      cost: Money.USD.zero,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
      location: Location.Ref.make({ directory: AbsolutePath.make(directory) }),
      permissions: [{ action: "read", resource: "*", effect: "allow" }],
    })
    const calls: Parameters<Tool.Snapshot["execute"]>[0][] = []
    const rules: Permission.Ruleset[] = []
    const selected = Agent.Info.default(Agent.ID.make("build"))
    const services = Layer.mergeAll(
      LayerNode.compile(PluginHooks.node),
      Layer.mock(Plugin.Service, { awaitActivation: Effect.void }),
      Layer.mock(Agent.Service, { select: () => Effect.succeed({ id: selected.id, info: selected }) }),
      Layer.mock(Tool.Service, {
        snapshot: (permissions) => {
          rules.push(permissions ?? [])
          return Effect.succeed({
            definitions: [],
            execute: (input) => {
              calls.push(input)
              return Effect.succeed({
                content: [
                  {
                    type: "text" as const,
                    text: '<file_content path="child.ts">\nexport const value = 42\n</file_content>',
                  },
                ],
              })
            },
          })
        },
      }),
    )
    const instances = Instance.Service.of({
      // This fixture supplies only the Location services used by SessionPrompt.
      provide: () => Effect.provide(services as Layer.Layer<Instance.Services>),
    })
    const messageID = SessionMessage.ID.create()
    const result = yield* SessionPrompt.prepare({
      session,
      messageID,
      input: {
        text: "Inspect @directory",
        files: [
          {
            uri: pathToFileURL(directory).href,
            mention: { start: 8, end: 18, text: "@directory" },
          },
        ],
      },
    }).pipe(Effect.provideService(Instance.Service, instances))

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      sessionID: session.id,
      agent: selected.id,
      messageID,
      call: { type: "tool-call", name: "read", input: { path: directory, includeDirectoryFiles: true } },
    })
    expect(rules[0]).toEqual(Permission.merge(selected.permissions, session.permissions ?? []))
    expect(result.payload.files?.[0]?.mime).toBe("application/x-directory")
    expect(Buffer.from(result.payload.files?.[0]?.data ?? "", "base64").toString("utf8")).toContain(
      "export const value = 42",
    )
    const messages = toLLMMessages(
      [
        SessionMessage.User.make({
          id: messageID,
          type: "user",
          text: result.payload.text,
          files: result.payload.files,
          time: { created: DateTime.makeUnsafe(0) },
        }),
      ],
      Model.Ref.make({ providerID: Provider.ID.make("test"), id: Model.ID.make("test") }),
    )
    expect(messages[0]?.content).toContainEqual(
      expect.objectContaining({
        type: "text",
        text: expect.stringContaining('<file_content path="child.ts">\nexport const value = 42'),
      }),
    )
  }),
)
// raccoon_change end
