import { expect, test } from "bun:test"
import { mkdtemp, mkdir, rm } from "node:fs/promises" // raccoon_change - set up Raccoon plugin fixture
import { tmpdir } from "node:os" // raccoon_change - set up Raccoon plugin fixture
import path from "node:path" // raccoon_change - set up Raccoon plugin fixture
import { localPluginDirectories, mergePluginTargets } from "../src/plugin/discovery" // raccoon_change - verify Raccoon plugin directories

test("deduplicates equivalent local plugin targets while retaining the final source", () => {
  const directory = "/project"
  const discovered = { entry: "/project/.opencode/plugins/example", install: true, optional: true }
  const server = { entry: "./.opencode/plugins/example", install: false, optional: true }

  expect(mergePluginTargets([discovered, server], directory)).toEqual([server])
})

test("preserves the first target position when a later source overrides it", () => {
  const first = { entry: "example", install: true, optional: true }
  const other = { entry: "other", install: true, optional: true }
  const configured = { entry: { package: "example", options: { enabled: true } }, install: true, optional: false }

  expect(mergePluginTargets([first, other, configured], "/project")).toEqual([configured, other])
})

// raccoon_change start - discover local plugins from Raccoon project directories
test("includes .raccoon plugins and preserves legacy .opencode plugins", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "raccoon-plugins-"))
  try {
    await mkdir(path.join(directory, ".git"))
    await mkdir(path.join(directory, ".raccoon"))
    expect(await localPluginDirectories(directory, path.join(directory, "global"))).toEqual([
      path.join(directory, "global", "plugins"),
      path.join(directory, ".opencode", "plugins"),
      path.join(directory, ".raccoon", "plugins"),
    ])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
// raccoon_change end
