// @ts-expect-error Bun exposes this module to tests; the Sidecar compiler intentionally loads Node-only types.
import { afterEach, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SidecarPlatform } from "./platform.js"

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function platform(directory: string) {
  return new SidecarPlatform({
    directory,
    locale: "en",
    autocompleteEnabled: false,
    autocompleteModel: "",
    storageDir: directory,
    log: () => {},
    onAutocompleteSettingsChange: () => {},
    requestTerminalContext: async () => ({ name: "Local", output: "hello from terminal\n" }),
  })
}

test("@terminal includes captured IDE terminal output", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raccoon-mentions-"))
  directories.push(directory)
  expect(await (await platform(directory)).editor.terminalContext()).toContain("hello from terminal")
})

test("@git-changes includes untracked worktree content", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raccoon-mentions-"))
  directories.push(directory)
  execFileSync("git", ["init", "-q", directory])
  await writeFile(join(directory, "new.txt"), "from IntelliJ\n")
  const result = await (await platform(directory)).editor.gitChangesContext(directory)
  expect(result).toContain("new.txt")
  expect(result).toContain("+from IntelliJ")
})
