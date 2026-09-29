import path from "path"
import fs from "fs/promises"
import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Config } from "@opencode/core/config"
import { Bus } from "@opencode/core/bus"
import { Credential } from "@opencode/core/credential"
import { Location } from "@opencode/core/location"
import { AbsolutePath } from "@opencode/core/schema"
import { WellKnown } from "@opencode/core/wellknown"
import { Watcher } from "@opencode/core/filesystem/watcher"
import { Global } from "@opencode/util/global"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { emptyCredentialNode, emptyWellknownNode } from "../fixture/config-nodes"
import { location } from "../fixture/location"
import { withTempDir } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.empty)

it.live("discovers Raccoon config files and project directories", () =>
  withTempDir((tmp) =>
    Effect.gen(function* () {
      const global = path.join(tmp.path, "global")
      const project = path.join(tmp.path, "project")
      const directory = path.join(project, "src")
      yield* Effect.promise(async () => {
        await fs.mkdir(directory, { recursive: true })
        await fs.mkdir(path.join(project, ".raccoon"), { recursive: true })
        await Promise.all([
          fs.writeFile(path.join(project, "raccoon.json"), JSON.stringify({ $schema: "raccoon-file" })),
          fs.writeFile(path.join(project, ".raccoon", "config.json"), JSON.stringify({ $schema: "raccoon-dir" })),
        ])
      })
      const located = Layer.succeed(
        Location.Service,
        Location.Service.of(
          location({ directory: AbsolutePath.make(directory) }, { projectDirectory: AbsolutePath.make(project) }),
        ),
      )
      const layer = AppNodeBuilder.build(LayerNode.group([Config.node, Bus.node]), [
        Location.node.replace(located),
        Global.node.replace(Global.layerWith({ config: global, home: path.join(global, "home") })),
        Credential.node.replace(emptyCredentialNode),
        WellKnown.node.replace(emptyWellknownNode),
        Watcher.node.replace(Watcher.testLayer),
      ])
      const entries = yield* Effect.gen(function* () {
        const config = yield* Config.Service
        return yield* config.entries()
      }).pipe(Effect.provide(layer))
      expect(entries.filter((entry) => entry.type === "document").map((entry) => entry.info.$schema)).toEqual([
        "raccoon-file",
        "raccoon-dir",
      ])
      expect(entries.filter((entry) => entry.type === "directory").map((entry) => entry.path)).toContain(
        AbsolutePath.make(path.join(project, ".raccoon")),
      )
    }),
  ),
)
