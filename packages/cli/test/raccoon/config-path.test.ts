// raccoon_change start - verify Raccoon config targets and legacy fallback
import { expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { resolveConfigPath } from "../../src/commands/handlers/mcp/add"

test("Raccoon config writes prefer existing Raccoon files and otherwise create raccoon.json", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "raccoon-config-"))
  try {
    expect(await resolveConfigPath(directory, "raccoon")).toBe(path.join(directory, "raccoon.json"))
    await writeFile(path.join(directory, "opencode.json"), "{}")
    expect(await resolveConfigPath(directory, "raccoon")).toBe(path.join(directory, "opencode.json"))
    await mkdir(path.join(directory, ".raccoon"))
    await writeFile(path.join(directory, ".raccoon", "raccoon.json"), "{}")
    expect(await resolveConfigPath(directory, "raccoon")).toBe(path.join(directory, "opencode.json"))
    await writeFile(path.join(directory, "raccoon.jsonc"), "{}")
    expect(await resolveConfigPath(directory, "raccoon")).toBe(path.join(directory, "raccoon.jsonc"))
    expect(await resolveConfigPath(directory, "opencode")).toBe(path.join(directory, "opencode.json"))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
// raccoon_change end
