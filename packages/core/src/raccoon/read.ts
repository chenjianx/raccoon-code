// raccoon_change start - keep directory file inlining outside the upstream read tool
import path from "path"
import { Effect } from "effect"
import { ReadToolFileSystem } from "../tool/read-filesystem.js"
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
    read: ReadToolFileSystem.Interface["read"]
    authorize: (path: string) => Effect.Effect<void, E, R>
    sample: (path: string) => Effect.Effect<Uint8Array | undefined, E, R>
    directory: AbsolutePath
    location: AbsolutePath
    page: ReadToolFileSystem.ListPage
  }) {
    const loaded = yield* Effect.forEach(
      input.page.entries.filter((entry) => entry.type === "file"),
      Effect.fnUntraced(function* (entry) {
        const child = AbsolutePath.make(path.join(input.directory, entry.path))
        yield* input.authorize(child)
        const sample = yield* input.sample(child)
        if (!sample || binary(child, sample)) return
        const resource = path.relative(input.location, child).replaceAll("\\", "/")
        const content = yield* input
          .read(child, resource, { offset: 1, limit: ReadToolFileSystem.MAX_READ_LINES })
          .pipe(Effect.catch(() => Effect.succeed(undefined)))
        if (!content || content.type === "list-page" || (content.type === "file" && content.encoding !== "utf8")) return
        const text = content.content.replace(/\n$/, "")
        return {
          path: child,
          content: `<file_content path="${resource}">\n${text}${content.type === "text-page" && content.truncated ? "\n\n(File truncated)" : ""}\n</file_content>`,
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
