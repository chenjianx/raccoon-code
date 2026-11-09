import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

async function modelsAfterLogin(input: { saved?: boolean; login?: boolean; fail?: boolean; serverDefault?: string; empty?: boolean }) {
  const root = await mkdtemp(join(tmpdir(), "raccoon-login-models-"))
  try {
    const child = Bun.spawn([process.execPath, "-e", `
      import { mkdir, readFile, writeFile } from "node:fs/promises"
      import { join } from "node:path"
      import { OpenCode } from "@opencode/client/promise"
      import { RaccoonProviderConfig } from ${JSON.stringify(join(import.meta.dir, "provider-config.ts"))}

      const input = JSON.parse(process.env.MODEL_SCENARIO)
      const root = process.env.XDG_STATE_HOME
      const stored = new Map(input.saved ? [["raccoon.disabledModels", ["raccoon/raccoon-chat", "raccoon/raccoon-pro-chat"]]] : [])
      if (input.saved) {
        await mkdir(join(root, "raccoon"))
        await writeFile(join(root, "raccoon/model.json"), JSON.stringify({
          selected: { providerID: "openai", modelID: "gpt-5" },
          model: { build: { providerID: "raccoon", modelID: "aaa-other" } },
        }))
      }
      let state = { mode: "build", loading: false, models: [], providers: [], agents: [], sessions: [], messages: [] }
      let authenticated = !input.login
      const posted = []
      const client = OpenCode.make({
        baseUrl: "http://localhost:3000",
        fetch: async (requestInput, init) => {
          const request = new Request(requestInput, init)
          const path = new URL(request.url).pathname
          const integration = {
            id: "raccoon", name: "Raccoon", methods: [{ id: "browser", type: "oauth", label: "Browser" }],
            connections: authenticated ? [{ type: "credential", id: "credential-1", label: "Raccoon", method: "oauth" }] : [],
          }
          if (path === "/api/integration") return Response.json({ data: [integration] })
          if (path === "/api/integration/raccoon") return Response.json({ data: integration })
          if (path === "/api/integration/raccoon/connect/oauth") {
            if (input.fail) return Response.json({ _tag: "UnauthorizedError", message: "Login failed" }, { status: 401 })
            return Response.json({ data: {
              attemptID: "login-1", mode: "auto", url: "", instructions: "", time: { created: 1, expires: 2 },
            } })
          }
          if (path === "/api/integration/raccoon/connect/oauth/login-1") {
            authenticated = true
            return Response.json({ data: { status: "complete", time: { created: 1, expires: 2 } } })
          }
          if (path === "/api/location/reload") return new Response(null, { status: 204 })
          if (path === "/api/provider") return Response.json({ data: [
            { id: "raccoon", name: "Raccoon", integrationID: "raccoon", activation: "auto" },
            { id: "openai", name: "OpenAI", activation: "auto" },
          ] })
          if (path === "/api/model") return Response.json({ data: [
            ["raccoon", "aaa-other"],
            ...(!input.empty ? [["raccoon", "raccoon-chat"], ["raccoon", "raccoon-pro-chat"]] : []),
            ["raccoon", "raccoon-pro-completion"], ["raccoon", "raccoon-disabled"],
            ["openai", "gpt-5"], ["openai", "raccoon-impostor"],
          ].map(([providerID, id]) => ({ providerID, id, modelID: id, name: id, enabled: id !== "raccoon-disabled", variants: [] })) })
          if (path === "/api/model/default") return Response.json({ data: { providerID: "raccoon", id: input.serverDefault ?? "aaa-other" } })
          if (path === "/api/config") return Response.json([{ type: "directory", path: root }])
          if (path === "/api/command" || path === "/api/agent") return Response.json({ data: [] })
          if (path === "/api/instruction") return Response.json({ data: [] })
          throw new Error("Unexpected request: " + path)
        },
      })
      const deps = {
        client: async () => client, directory: () => root, getState: () => state, setState: (next) => { state = next },
        post: () => {}, refresh: async () => config.loadModels(), withLoading: async (run) => run(),
        storage: { get: (key, fallback) => stored.get(key) ?? fallback, update: async (key, value) => { stored.set(key, value) } },
        webviewHost: { post: (_source, message) => { posted.push(message) } },
        openExternal: async () => {}, promptInput: async () => undefined, pluginLanguage: () => "en",
      }
      const config = new RaccoonProviderConfig(deps)
      await config.loadModels()
      if (input.login) await config.loginRaccoon({ type: "loginRaccoon", method: "browser" }, "settings").catch(() => {})
      const selected = state.selectedModel
      const defaultModel = state.defaultModel
      const enabled = state.models.filter((model) => model.enabled).map((model) => model.providerID + "/" + model.modelID)
      const providers = state.providers
      await config.loadModels()
      const reloaded = new RaccoonProviderConfig(deps)
      await reloaded.loadModels()
      console.log(JSON.stringify({ selected, defaultModel, enabled, providers, posted,
        reloaded: { selected: state.selectedModel, defaultModel: state.defaultModel, enabled: state.models.filter((model) => model.enabled).map((model) => model.providerID + "/" + model.modelID) },
        persisted: await readFile(join(root, "raccoon/model.json"), "utf8").then(JSON.parse).catch(() => undefined),
      }))
    `], { env: { ...process.env, XDG_STATE_HOME: root, MODEL_SCENARIO: JSON.stringify(input) }, stdout: "pipe", stderr: "pipe" })
    const [stdout, stderr, exit] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ])
    expect(stderr).toBe("")
    expect(exit).toBe(0)
    return JSON.parse(stdout)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test.each([
  { login: false, saved: false },
  { login: true, saved: true },
])("prefers Raccoon Pro after authentication ($login, $saved)", async (input) => {
  const result = await modelsAfterLogin(input)
  expect(result.selected).toEqual({ providerID: "raccoon", modelID: "raccoon-pro-chat" })
  expect(result.defaultModel).toEqual({ providerID: "raccoon", modelID: "raccoon-pro-chat" })
  expect(result.enabled).toEqual(["raccoon/raccoon-chat", "raccoon/raccoon-pro-chat"])
  expect(result.providers.find((provider: { id: string }) => provider.id === "raccoon").enabledModelCount).toBe(2)
  expect(result.providers.find((provider: { id: string }) => provider.id === "openai").enabledModelCount).toBe(0)
  expect(result.reloaded).toEqual({ selected: result.selected, defaultModel: result.defaultModel, enabled: result.enabled })
  expect(result.persisted.selected).toEqual({ providerID: "raccoon", modelID: "raccoon-pro-chat" })
})

test("prefers Raccoon Pro over another Raccoon server default", async () => {
  const result = await modelsAfterLogin({ login: true, saved: true, serverDefault: "raccoon-chat" })
  expect(result.selected).toEqual({ providerID: "raccoon", modelID: "raccoon-pro-chat" })
  expect(result.defaultModel).toEqual({ providerID: "raccoon", modelID: "raccoon-pro-chat" })
})

test.each([{ login: false }, { login: true, fail: true }, { login: true, empty: true }])(
  "preserves preferences without a successful login and available Raccoon models ($login, $fail, $empty)",
  async (input) => {
    const result = await modelsAfterLogin({ ...input, saved: true })
    expect(result.defaultModel).toEqual({ providerID: "openai", modelID: "gpt-5" })
    expect(result.selected).toEqual(input.login && "fail" in input && input.fail
      ? { providerID: "openai", modelID: "gpt-5" }
      : { providerID: "raccoon", modelID: "aaa-other" })
    expect(result.enabled).toEqual(["raccoon/aaa-other", "openai/gpt-5", "openai/raccoon-impostor"])
  },
)
