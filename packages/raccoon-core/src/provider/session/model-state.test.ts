import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import type { OpenCodeClient } from "@opencode/client/promise"
import { ModelStateStore } from "./model-state"

function clientFor(state: string) {
  return {
    path: {
      get: async () => ({ data: { state } }),
    },
  } as unknown as OpenCodeClient
}

describe("ModelStateStore", () => {
  test("uses Raccoon state when the host has no CLI brand and both branded files exist", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "raccoon-model-host-"))
    const saved = { selected: { providerID: "raccoon", modelID: "saved" }, model: {} }
    const other = { selected: { providerID: "openai", modelID: "other" }, model: {} }
    try {
      await Promise.all(["raccoon", "opencode"].map((brand) => mkdir(path.join(root, brand))))
      await writeFile(path.join(root, "raccoon/model.json"), JSON.stringify(saved))
      await writeFile(path.join(root, "opencode/model.json"), JSON.stringify(other))
      // Use the real default constructor in a separate host process, without changing test-runner env.
      const child = Bun.spawn([process.execPath, "-e", `
        import { ModelStateStore } from ${JSON.stringify(path.join(import.meta.dir, "model-state.ts"))}
        const store = new ModelStateStore(() => "/workspace")
        const client = {}
        console.log(JSON.stringify(await store.load(client, { model: {} })))
        await store.write(client, { selected: { providerID: "raccoon", modelID: "new" }, model: {} })
      `], { env: { ...process.env, XDG_STATE_HOME: root, RACCOON_CLI: "" }, stdout: "pipe", stderr: "pipe" })
      expect(await child.exited).toBe(0)
      expect(JSON.parse(await new Response(child.stdout).text())).toEqual(saved)
      expect(JSON.parse(await readFile(path.join(root, "raccoon/model.json"), "utf-8")).selected.modelID).toBe("new")
      expect(JSON.parse(await readFile(path.join(root, "opencode/model.json"), "utf-8"))).toEqual(other)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("persists selected and mode models together", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "raccoon-model-state-"))
    try {
      const store = new ModelStateStore(() => "/workspace", dir)
      const client = clientFor(dir)

      await store.write(client, {
        selected: { providerID: "openai", modelID: "gpt-5" },
        model: {
          build: { providerID: "anthropic", modelID: "claude-sonnet-4" },
          plan: { providerID: "raccoon", modelID: "big-pickle" },
          ask: { providerID: "openai", modelID: "gpt-4.1" },
        },
      })

      expect(await store.load(client, { model: {} })).toEqual({
        selected: { providerID: "openai", modelID: "gpt-5" },
        model: {
          build: { providerID: "anthropic", modelID: "claude-sonnet-4" },
          plan: { providerID: "raccoon", modelID: "big-pickle" },
          ask: { providerID: "openai", modelID: "gpt-4.1" },
        },
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("migrates model state from the other branded state directory", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "raccoon-model-migration-"))
    const current = path.join(root, "opencode")
    const legacy = path.join(root, "raccoon")
    const saved = {
      recent: [{ providerID: "openai", modelID: "gpt-5" }],
      favorite: [{ providerID: "anthropic", modelID: "claude-sonnet-4" }],
      selected: { providerID: "openai", modelID: "gpt-5" },
      model: { build: { providerID: "openai", modelID: "gpt-5" } },
    }
    try {
      await mkdir(legacy, { recursive: true })
      await writeFile(path.join(legacy, "model.json"), JSON.stringify(saved))
      const store = new ModelStateStore(() => "/workspace", current, legacy)

      expect(await store.load(clientFor(current), { model: {} })).toEqual({
        selected: saved.selected,
        model: saved.model,
      })
      expect(JSON.parse(await readFile(path.join(current, "model.json"), "utf-8"))).toEqual(saved)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
