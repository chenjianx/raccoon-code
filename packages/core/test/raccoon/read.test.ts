import { expect } from "bun:test"
import path from "path"
import { RaccoonRead } from "@opencode/core/raccoon/read"
import { Environment } from "@opencode/core/environment/index"
import { AbsolutePath } from "@opencode/core/schema"
import { ReadToolFileSystem } from "@opencode/core/tool/read-filesystem"
import { ReadTool } from "@opencode/core/tool/plugin/read"
import { CrossSpawnSpawner } from "@opencode/util/cross-spawn-spawner"
import { LayerNodePlatform } from "@opencode/util/effect/app-node-platform"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Effect, FileSystem, Schema } from "effect"
import { ChildProcessSpawner } from "effect/unstable/process"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([CrossSpawnSpawner.node, LayerNodePlatform.filesystem])))

it.effect("preserves the opt-in directory expansion input", () =>
  Effect.sync(() => {
    expect(Schema.decodeUnknownSync(ReadTool.Input)({ path: "src", includeDirectoryFiles: true })).toEqual({
      path: "src",
      includeDirectoryFiles: true,
    })
  }),
)

it.effect("appends selected file content to the directory listing only when supplied", () =>
  Effect.sync(() => {
    const page = new ReadToolFileSystem.ListPage({
      type: "list-page",
      entries: [],
      truncated: false,
    })
    expect(
      ReadTool.toModelContent("src", undefined, page, [{ content: '<file_content path="a.ts">\na\n</file_content>' }]),
    ).toBe(
      'Read directory src, 0 entries\n\n<system-reminder>\n<file_content path="a.ts">\na\n</file_content>\n</system-reminder>',
    )
    expect(ReadTool.toModelContent("src", undefined, page)).toBe("Read directory src, 0 entries")
  }),
)

it.live("inlines only text files from the selected directory page", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const directory = yield* fs.makeTempDirectoryScoped()
    yield* fs.makeDirectory(path.join(directory, "nested"))
    yield* fs.writeFileString(path.join(directory, "first.ts"), "const answer = 42\n")
    yield* fs.writeFileString(path.join(directory, "second.ts"), "second")
    yield* fs.writeFile(path.join(directory, "archive.zip"), new Uint8Array([80, 75, 3, 4]))
    const files = Environment.makeFiles(Environment.makeLocalDriver(spawner))
    const reader = (file: AbsolutePath, resource: string, page?: ReadToolFileSystem.PageInput) =>
      ReadToolFileSystem.read(files, file, resource, page)
    const page = yield* ReadToolFileSystem.read(files, AbsolutePath.make(directory), directory)
    if (page.type !== "list-page") throw new Error("Expected directory page")

    const loaded = yield* RaccoonRead.inlineDirectory({
      read: reader,
      authorize: () => Effect.void,
      sample: (file) => files.read(file, { offset: 0, length: 4096 }).pipe(Effect.map((value) => value.bytes)),
      directory: AbsolutePath.make(directory),
      location: AbsolutePath.make(directory),
      page,
    })

    expect(loaded).toEqual([
      {
        path: AbsolutePath.make(path.join(directory, "first.ts")),
        content: '<file_content path="first.ts">\nconst answer = 42\n</file_content>',
      },
      {
        path: AbsolutePath.make(path.join(directory, "second.ts")),
        content: '<file_content path="second.ts">\nsecond\n</file_content>',
      },
    ])
  }),
)

it.live("marks inlined content when the file page is truncated", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const directory = yield* fs.makeTempDirectoryScoped()
    yield* fs.writeFileString(path.join(directory, "long.txt"), Array.from({ length: 2001 }, () => "line").join("\n"))
    const files = Environment.makeFiles(Environment.makeLocalDriver(spawner))
    const page = yield* ReadToolFileSystem.read(files, AbsolutePath.make(directory), directory)
    if (page.type !== "list-page") throw new Error("Expected directory page")

    const loaded = yield* RaccoonRead.inlineDirectory({
      read: (file, resource, input) => ReadToolFileSystem.read(files, file, resource, input),
      authorize: () => Effect.void,
      sample: (file) => files.read(file, { offset: 0, length: 4096 }).pipe(Effect.map((value) => value.bytes)),
      directory: AbsolutePath.make(directory),
      location: AbsolutePath.make(directory),
      page,
    })

    expect(loaded).toHaveLength(1)
    expect(loaded[0]?.content.endsWith("line\n\n(File truncated)\n</file_content>")).toBeTrue()
  }),
)
