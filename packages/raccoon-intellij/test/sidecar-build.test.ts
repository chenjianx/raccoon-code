import { expect, test } from "bun:test"
import { copyFile, mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const intellijDir = path.dirname(import.meta.dir)

test.each([false, true])("bundled sidecar initializes under Node (production: %s)", async (production) => {
  const build = Bun.spawnSync(["node", "esbuild.sidecar.mjs", ...(production ? ["--production"] : [])], {
    cwd: intellijDir,
  })
  expect(build.exitCode).toBe(0)

  const directory = await mkdtemp(path.join(os.tmpdir(), "raccoon-sidecar-test-"))
  try {
    await Promise.all(["sidecar.cjs", "tree-sitter.wasm"].map((file) =>
      copyFile(path.join(intellijDir, "src/main/resources/sidecar", file), path.join(directory, file)),
    ))
    // Run the extracted artifact with the same Node flags as the IDE host. Source-level Bun
    // tests do not catch ESM dependencies broken by the CommonJS bundle conversion.
    const result = Bun.spawnSync(["node", "--liftoff-only", path.join(directory, "sidecar.cjs")], {
      cwd: directory,
      stdin: Buffer.from(""),
      timeout: 10_000,
    })
    expect(result.stderr.toString()).toBe("")
    expect(result.exitCode).toBe(0)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 30_000)
