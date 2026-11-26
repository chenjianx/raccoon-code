// raccoon_change start - keep directory file inlining outside the upstream read tool
import path from "path"
import { Effect } from "effect"
import { ReadToolFileSystem } from "../tool/read-filesystem.js"
import type { FileAccess } from "../file-access.js"
import type { Environment } from "../environment/index.js"
import { EnvironmentPath } from "../environment/path.js"
import { AbsolutePath } from "../schema.js"

const BINARY_EXTENSIONS = new Set([
  ".zip",
  ".tar",
  ".gz",
  ".exe",
  ".dll",
  ".so",
  ".class",
  ".jar",
  ".war",
  ".7z",
  ".bin",
  ".dat",
  ".obj",
  ".o",
  ".a",
  ".lib",
  ".wasm",
  ".pyc",
  ".pyo",
])

export namespace RaccoonRead {
  export const inlineDirectory = Effect.fn("RaccoonRead.inlineDirectory")(function* <E, R>(input: {
    target: FileAccess.Target
    workingDirectory: Environment.Place
    authorize: (path: string) => Effect.Effect<void, E, R>
    page: ReadToolFileSystem.DirectoryContent
  }) {
    const files = input.target.environment.files
    const rules = input.target.environment.path ?? path
    const sameEnvironment = input.target.environment.id === input.workingDirectory.environment.id
    const loaded = yield* Effect.forEach(
      input.page.entries.filter((entry) => !entry.endsWith(path.sep)),
      Effect.fnUntraced(function* (entry) {
        const child = AbsolutePath.make(rules.join(input.target.absolute, entry))
        // The listing marks directories but does not distinguish symlinks from regular files.
        const info = yield* files.stat(child).pipe(Effect.orElseSucceed(() => undefined))
        if (info?.type !== "file") return
        const qualified = sameEnvironment ? child : EnvironmentPath.format(input.target.environment.id, child)
        yield* input.authorize(qualified)
        const sample = yield* files
          .read(child, { offset: 0, length: 4096 })
          .pipe(Effect.orElseSucceed(() => undefined))
        if (!sample || binary(child, sample.bytes)) return
        const resource = sameEnvironment
          ? rules.relative(input.workingDirectory.absolute, child).replaceAll("\\", "/")
          : qualified
        const content = yield* ReadToolFileSystem.read(files, child, resource, {
          offset: 1,
          limit: ReadToolFileSystem.MAX_READ_LINES,
        }).pipe(Effect.orElseSucceed(() => undefined))
        if (content?.type !== "text") return
        const text = content.content.replace(/\n$/, "")
        return {
          path: qualified,
          content: `<file_content path="${resource}">\n${text}${content.next !== undefined ? "\n\n(File truncated)" : ""}\n</file_content>`,
        }
      }),
      { concurrency: 8 },
    )
    return loaded.filter((item): item is NonNullable<typeof item> => item !== undefined)
  })
}

function binary(filepath: string, bytes: Uint8Array) {
  if (BINARY_EXTENSIONS.has(path.extname(filepath).toLowerCase())) return true
  if (bytes.length === 0) return false
  const nonPrintable = bytes.filter((byte) => byte === 0 || byte < 9 || (byte > 13 && byte < 32)).length
  return bytes.includes(0) || nonPrintable / bytes.length > 0.3
}
// raccoon_change end
