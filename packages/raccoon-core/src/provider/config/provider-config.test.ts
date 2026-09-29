import { beforeAll, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { RaccoonModel } from "@opencode-ai/raccoon-webview"
import type { RaccoonProviderConfig as RaccoonProviderConfigType } from "./provider-config"

let RaccoonProviderConfig: typeof RaccoonProviderConfigType

beforeAll(async () => {
  RaccoonProviderConfig = (await import("./provider-config")).RaccoonProviderConfig
})

function model(providerID: string, modelID: string, enabled = true): RaccoonModel {
  return {
    providerID,
    providerName: providerID,
    modelID,
    modelName: modelID,
    enabled,
    connected: true,
  }
}

function v2Client(configDir: string, onReload: () => void = () => {}) {
  return {
    config: { get: async () => [{ type: "directory", path: configDir }] },
    location: { reload: async () => onReload() },
  } as never
}

describe("RaccoonProviderConfig", () => {
  test("connects Raccoon through the v2 browser OAuth method", async () => {
    let connectInput: unknown
    let statusInput: unknown
    let refreshed = false
    const posted: unknown[] = []
    const client = {
      integration: {
        get: async () => ({ location: { directory: "/workspace" }, data: {
          id: "raccoon", name: "Raccoon", connections: [], methods: [{ id: "browser", type: "oauth", label: "Browser sign-in" }],
        } }),
        oauth: {
          connect: async (input: unknown) => {
            connectInput = input
            return { location: { directory: "/workspace" }, data: {
              attemptID: "attempt-1", url: "https://xiaohuanxiong.com", mode: "auto", instructions: "", time: { created: 1, expires: 2 },
            } }
          },
          status: async (input: unknown) => {
            statusInput = input
            return { location: { directory: "/workspace" }, data: { status: "complete", time: { created: 1, expires: 2 } } }
          },
        },
      },
      location: { reload: async () => {} },
    }
    const config = new RaccoonProviderConfig({
      client: async () => client as never,
      directory: () => "/workspace",
      getState: () => ({}) as never,
      setState: () => {},
      post: () => {},
      refresh: async () => {
        refreshed = true
      },
      withLoading: async (run) => await run(),
      openExternal: async () => {},
      webviewHost: {
        post: (_source: unknown, message: unknown) => posted.push(message),
      } as never,
    })

    await config.loginRaccoon(
      { type: "loginRaccoon", method: "browser", serverUrl: "https://xiaohuanxiong.com/" },
      "chat",
    )

    expect(connectInput).toEqual({
      integrationID: "raccoon", methodID: "browser", location: { directory: "/workspace" },
      answer: { serverUrl: "https://xiaohuanxiong.com/" },
    })
    expect(statusInput).toEqual({ integrationID: "raccoon", attemptID: "attempt-1", location: { directory: "/workspace" } })
    expect(refreshed).toBe(true)
    expect(posted).toEqual([{ type: "raccoonLoginFinished" }])
  })

  test("passes phone credentials only to the v2 phone method", async () => {
    let input: unknown
    const client = {
      integration: {
        get: async () => ({ data: { id: "raccoon", name: "Raccoon", connections: [], methods: [{ id: "phone", type: "oauth", label: "Phone" }] } }),
        oauth: {
          connect: async (value: unknown) => {
            input = value
            return { data: { attemptID: "phone-1", url: "", mode: "auto", instructions: "", time: { created: 1, expires: 2 } } }
          },
          status: async () => ({ data: { status: "complete", time: { created: 1, expires: 2 } } }),
        },
      },
      location: { reload: async () => {} },
    }
    const config = new RaccoonProviderConfig({
      client: async () => client as never,
      directory: () => "/workspace",
      getState: () => ({}) as never,
      setState: () => {}, post: () => {}, refresh: async () => {},
      withLoading: async (run) => await run(), openExternal: async () => { throw new Error("Phone login should not open a URL") },
      webviewHost: { post: () => {} } as never,
    })
    await config.loginRaccoon({ type: "loginRaccoon", method: "phone", nationCode: "852", phone: "61234567", password: "secret" }, "chat")
    expect(input).toEqual({
      integrationID: "raccoon", methodID: "phone", location: { directory: "/workspace" },
      answer: { nationCode: "852", phone: "61234567", password: "secret" },
    })
  })

  test("aborts the active v2 Raccoon authorization request when login is cancelled", async () => {
    let signal: AbortSignal | undefined
    let started = () => {}
    const waiting = new Promise<void>((resolve) => {
      started = resolve
    })
    const client = {
      integration: {
        get: async () => ({ location: { directory: "/workspace" }, data: {
          id: "raccoon", name: "Raccoon", connections: [], methods: [{ id: "browser", type: "oauth", label: "Browser sign-in" }],
        } }),
        oauth: {
          connect: async (_input: unknown, options: { signal?: AbortSignal }) => {
            signal = options.signal
            started()
            return await new Promise((_, reject) => {
              options.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")))
            })
          },
        },
      },
    }
    const config = new RaccoonProviderConfig({
      client: async () => client as never,
      directory: () => "/workspace",
      getState: () => ({}) as never,
      setState: () => {},
      post: () => {},
      refresh: async () => {},
      withLoading: async (run) => await run(),
      openExternal: async () => {},
      webviewHost: {
        post: () => {},
        postRaccoonLoginFinished: () => {},
      } as never,
    })

    const login = config.loginRaccoon(
      { type: "loginRaccoon", method: "browser", serverUrl: "https://xiaohuanxiong.com" },
      "chat",
    )
    await waiting
    config.cancelRaccoonLogin()
    await Promise.race([
      login,
      new Promise((_, reject) => setTimeout(() => reject(new Error("Login request did not abort")), 100)),
    ])

    expect(signal?.aborted).toBe(true)
  })

  test("connects and disconnects a standard provider through v2 integrations and native policy", async () => {
    const dir = await mkdtemp(join(tmpdir(), "raccoon-provider-"))
    const globalDir = await mkdtemp(join(tmpdir(), "raccoon-global-"))
    const keyInputs: unknown[] = []
    const removed: string[] = []
    const posted: unknown[] = []
    let reloads = 0
    try {
      await writeFile(join(globalDir, "raccoon.jsonc"), JSON.stringify({ disabled_providers: ["openai"] }))
      const client = {
        config: { get: async () => [{ type: "directory", path: globalDir }] },
        provider: { get: async () => ({ data: { id: "openai", integrationID: "openai-auth" } }) },
        integration: {
          get: async () => ({ data: {
            id: "openai-auth", methods: [{ type: "key", label: "API key" }],
            connections: [{ type: "credential", id: "cred-1", label: "key", method: "key" }],
          } }),
          connect: { key: async (input: unknown) => { keyInputs.push(input) } },
        },
        credential: { remove: async ({ credentialID }: { credentialID: string }) => { removed.push(credentialID) } },
        location: { reload: async () => { reloads++ } },
      }
      const config = new RaccoonProviderConfig({
        client: async () => client as never, directory: () => dir,
        getState: () => ({}) as never, setState: () => {}, post: () => {},
        refresh: async () => {}, withLoading: async (run) => await run(), openExternal: async () => {},
        webviewHost: { post: (_source: unknown, message: unknown) => posted.push(message) } as never,
      })
      await config.connectProvider({ type: "connectProvider", providerID: "openai", methodIndex: 0, apiKey: " secret " })
      expect(keyInputs).toEqual([{ integrationID: "openai-auth", location: { directory: dir }, key: "secret" }])
      expect(JSON.parse(await readFile(join(globalDir, "raccoon.jsonc"), "utf8")).experimental.policies).toEqual([
        { action: "provider.use", resource: "openai", effect: "allow" },
      ])
      await config.disconnectProvider("openai")
      expect(removed).toEqual(["cred-1"])
      expect(JSON.parse(await readFile(join(globalDir, "raccoon.jsonc"), "utf8")).experimental.policies).toEqual([
        { action: "provider.use", resource: "openai", effect: "deny" },
      ])
      expect(reloads).toBe(2)
      expect(posted).toEqual([
        { type: "providerConnectFinished", providerID: "openai" },
        { type: "providerConnectFinished", providerID: "openai" },
      ])
    } finally {
      await rm(dir, { recursive: true, force: true })
      await rm(globalDir, { recursive: true, force: true })
    }
  })

  test("stores an exact native custom provider and removes it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "raccoon-provider-"))
    const globalDir = await mkdtemp(join(tmpdir(), "raccoon-global-"))
    const keys: unknown[] = []
    const saved: string[] = []
    let reloads = 0
    try {
      const client = {
        config: { get: async () => [{ type: "directory", path: globalDir }] },
        integration: { connect: { key: async (input: unknown) => { keys.push(input) } } },
        location: { reload: async () => { reloads++ } },
      }
      const config = new RaccoonProviderConfig({
        client: async () => client as never, directory: () => dir,
        getState: () => ({}) as never, setState: () => {}, post: () => {},
        refresh: async () => {}, withLoading: async (run) => await run(),
        webviewHost: { postCustomProviderSaved: (id: string) => saved.push(id) } as never,
      })
      await config.configureCustomProvider({
        type: "configureCustomProvider", providerID: "custom", name: "Custom", baseURL: "https://example.test/v1",
        package: "@ai-sdk/openai-compatible", apiKey: "key", headers: { "X-Test": " value " },
        models: [{ id: "old", name: "Old" }, { id: "vision", name: "Vision", supportsImage: true }],
      })
      const first = JSON.parse(await readFile(join(globalDir, "raccoon.jsonc"), "utf8"))
      expect(first.providers.custom).toMatchObject({
        name: "Custom", package: "@ai-sdk/openai-compatible", settings: { baseURL: "https://example.test/v1" },
        headers: { "X-Test": "value" },
      })
      expect(first.providers.custom.models.vision.capabilities.input).toEqual(["text", "image"])
      expect(keys).toEqual([{ integrationID: "custom", key: "key", location: { directory: dir } }])
      await config.configureCustomProvider({
        type: "configureCustomProvider", providerID: "custom", name: "Custom", baseURL: "https://example.test/v1",
        package: "@ai-sdk/openai-compatible", apiKey: "", headers: {}, models: [{ id: "new", name: "New" }],
      })
      const second = JSON.parse(await readFile(join(globalDir, "raccoon.jsonc"), "utf8"))
      expect(Object.keys(second.providers.custom.models)).toEqual(["new"])
      await config.deleteCustomProvider("custom")
      const third = JSON.parse(await readFile(join(globalDir, "raccoon.jsonc"), "utf8"))
      expect(third.providers.custom).toBeUndefined()
      expect(third.experimental.policies).toEqual([{ action: "provider.use", resource: "custom", effect: "deny" }])
      expect(reloads).toBe(3)
      expect(saved).toEqual(["custom", "custom", "custom"])
    } finally {
      await rm(dir, { recursive: true, force: true })
      await rm(globalDir, { recursive: true, force: true })
    }
  })

  test("prefers the saved selected model before config defaults", () => {
    const config = new RaccoonProviderConfig({
      client: async () => {
        throw new Error("not used")
      },
      directory: () => "/workspace",
      getState: () =>
        ({
          selectedModel: { providerID: "openai", modelID: "gpt-5" },
          mode: "build",
        }) as never,
      setState: () => {},
      post: () => {},
      refresh: async () => {},
      withLoading: async (run) => await run(),
      webviewHost: {
        post: () => {},
        postState: () => {},
        postError: () => {},
        postRaccoonLoginFinished: () => {},
        postCustomProviderSaved: () => {},
      } as never,
    })

    expect(
      config.selectModel([model("openai", "gpt-5"), model("raccoon", "big-pickle")], { raccoon: "big-pickle" }),
    ).toEqual({ providerID: "openai", modelID: "gpt-5" })
  })

  test("falls back to config defaults when saved selected model is unavailable", () => {
    const config = new RaccoonProviderConfig({
      client: async () => {
        throw new Error("not used")
      },
      directory: () => "/workspace",
      getState: () =>
        ({
          selectedModel: { providerID: "openai", modelID: "missing" },
          mode: "build",
        }) as never,
      setState: () => {},
      post: () => {},
      refresh: async () => {},
      withLoading: async (run) => await run(),
      webviewHost: {
        post: () => {},
        postState: () => {},
        postError: () => {},
        postRaccoonLoginFinished: () => {},
        postCustomProviderSaved: () => {},
      } as never,
    })

    expect(
      config.selectModel([model("openai", "gpt-5"), model("raccoon", "big-pickle")], { raccoon: "big-pickle" }),
    ).toEqual({ providerID: "raccoon", modelID: "big-pickle" })
  })

  test("prefers raccoon when no model is configured (refresh/reload default)", () => {
    const config = new RaccoonProviderConfig({
      client: async () => {
        throw new Error("not used")
      },
      directory: () => "/workspace",
      getState: () => ({ mode: "build" }) as never,
      setState: () => {},
      post: () => {},
      refresh: async () => {},
      withLoading: async (run) => await run(),
      webviewHost: {
        post: () => {},
        postState: () => {},
        postError: () => {},
        postRaccoonLoginFinished: () => {},
        postCustomProviderSaved: () => {},
      } as never,
    })

    // openai is listed first and has a server default, but raccoon is logged in (connected),
    // so the unconfigured default must land on raccoon's server default.
    expect(
      config.resolveDefaultModel(
        [model("openai", "gpt-5"), model("raccoon", "raccoon-chat"), model("raccoon", "raccoon-pro-chat")],
        { openai: "gpt-5", raccoon: "raccoon-pro-chat" },
      ),
    ).toEqual({ providerID: "raccoon", modelID: "raccoon-pro-chat" })
  })

  test("uses first raccoon model when no raccoon server default is set", () => {
    const config = new RaccoonProviderConfig({
      client: async () => {
        throw new Error("not used")
      },
      directory: () => "/workspace",
      getState: () => ({ mode: "build" }) as never,
      setState: () => {},
      post: () => {},
      refresh: async () => {},
      withLoading: async (run) => await run(),
      webviewHost: {
        post: () => {},
        postState: () => {},
        postError: () => {},
        postRaccoonLoginFinished: () => {},
        postCustomProviderSaved: () => {},
      } as never,
    })

    expect(
      config.resolveDefaultModel([model("openai", "gpt-5"), model("raccoon", "raccoon-chat")], { openai: "gpt-5" }),
    ).toEqual({ providerID: "raccoon", modelID: "raccoon-chat" })
  })

  test("keeps a non-raccoon model the user explicitly selected across refresh", async () => {
    const config = new RaccoonProviderConfig({
      client: async () => {
        throw new Error("not used")
      },
      directory: () => "/workspace",
      getState: () => ({ mode: "build" }) as never,
      setState: () => {},
      post: () => {},
      refresh: async () => {},
      withLoading: async (run) => await run(),
      webviewHost: {
        post: () => {},
        postState: () => {},
        postError: () => {},
        postRaccoonLoginFinished: () => {},
        postCustomProviderSaved: () => {},
      } as never,
    })
    // Simulate a persisted explicit selection of a non-raccoon model.
    ;(config as unknown as { selectedModel?: { providerID: string; modelID: string } }).selectedModel = {
      providerID: "openai",
      modelID: "gpt-5",
    }

    expect(
      config.resolveDefaultModel([model("openai", "gpt-5"), model("raccoon", "raccoon-chat")], {
        raccoon: "raccoon-chat",
      }),
    ).toEqual({ providerID: "openai", modelID: "gpt-5" })
  })

  test("falls back to non-raccoon default when raccoon is not connected", () => {
    const config = new RaccoonProviderConfig({
      client: async () => {
        throw new Error("not used")
      },
      directory: () => "/workspace",
      getState: () => ({ mode: "build" }) as never,
      setState: () => {},
      post: () => {},
      refresh: async () => {},
      withLoading: async (run) => await run(),
      webviewHost: {
        post: () => {},
        postState: () => {},
        postError: () => {},
        postRaccoonLoginFinished: () => {},
        postCustomProviderSaved: () => {},
      } as never,
    })

    const raccoonDisconnected: RaccoonModel = { ...model("raccoon", "raccoon-chat"), connected: false }
    expect(config.resolveDefaultModel([model("openai", "gpt-5"), raccoonDisconnected], { openai: "gpt-5" })).toEqual({
      providerID: "openai",
      modelID: "gpt-5",
    })
  })

  test("keeps global-only agents scoped to user when merged config includes them", async () => {
    const dir = await mkdtemp(join(tmpdir(), "raccoon-agent-"))
    try {
      let state = { mode: "build" } as never
      const config = new RaccoonProviderConfig({
        client: async () => {
          throw new Error("not used")
        },
        directory: () => dir,
        getState: () => state,
        setState: (next) => {
          state = next as never
        },
        post: () => {},
        refresh: async () => {},
        withLoading: async (run) => await run(),
        webviewHost: {
          post: () => {},
          postState: () => {},
          postError: () => {},
          postRaccoonLoginFinished: () => {},
          postCustomProviderSaved: () => {},
        } as never,
        pluginLanguage: () => "en",
      })

      await config.loadModels({
        config: { get: async () => [
          { type: "document", path: join(dir, "raccoon.jsonc"), info: { agents: { "custom-agent-user": {
            mode: "subagent",
            permissions: [
              { action: "shell", resource: "git *", effect: "allow" },
              { action: "shell", resource: "rm *", effect: "deny" },
            ],
          } } } },
          { type: "directory", path: dir },
        ] },
        provider: { list: async () => ({ data: [{ id: "openai", integrationID: "openai-auth", name: "OpenAI", activation: "auto", package: "@ai-sdk/openai" }] }) },
        model: { list: async () => ({ data: [] }), default: async () => ({ data: null }) },
        integration: { list: async () => ({ data: [{ id: "openai-auth", name: "OpenAI Auth", connections: [], methods: [{
          id: "key", type: "key", label: "API key", form: [
            { type: "string", key: "account", title: "Account" },
            { type: "string", key: "secret", title: "Secret", hidden: true },
          ],
        }] }] }) },
        command: { list: async () => ({ data: [] }) },
        agent: {
          list: async () => ({
            data: [
              {
                id: "custom-agent-user", name: "custom-agent-user",
                description: "",
                mode: "subagent",
                hidden: false, permissions: [{ action: "shell", resource: "git *", effect: "allow" }], request: { headers: {}, body: {} },
              },
            ],
          }),
        },
      } as never)

      expect((state as { agents: Array<{ name: string; configScope?: string }> }).agents[0]).toMatchObject({
        name: "custom-agent-user",
        configScope: "user",
        permissionConfig: { bash: { "git *": "allow", "rm *": "deny" } },
        permission: [{ permission: "bash", pattern: "git *", action: "allow" }],
      })
      expect((state as { providerAuthMethods: Record<string, unknown> }).providerAuthMethods.openai).toEqual([{
        type: "api", label: "API key", prompts: [
          { type: "text", key: "account", message: "Account", placeholder: undefined },
          { type: "password", key: "secret", message: "Secret", placeholder: undefined },
        ],
      }])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("project-scope agent config defaults to raccoon.jsonc in an empty project", async () => {
    const dir = await mkdtemp(join(tmpdir(), "raccoon-agent-"))
    try {
      let reloaded = false
      let refreshed = false
      const client = v2Client(dir, () => { reloaded = true })
      const config = new RaccoonProviderConfig({
        client: async () => client as never,
        directory: () => dir,
        getState: () => ({}) as never,
        setState: () => {},
        post: () => {},
        refresh: async () => {
          refreshed = true
        },
        withLoading: async (run) => await run(),
        webviewHost: {
          post: () => {},
          postState: () => {},
          postError: () => {},
          postRaccoonLoginFinished: () => {},
          postCustomProviderSaved: () => {},
        } as never,
      })

      await config.configureAgent({
        type: "configureAgent",
        requestID: "create-project-reviewer",
        scope: "project",
        agent: { name: "reviewer", description: "review code", mode: "subagent" },
      })

      const written = JSON.parse(await readFile(join(dir, "raccoon.jsonc"), "utf8"))
      expect(written.agents?.reviewer).toMatchObject({ description: "review code", mode: "subagent" })
      // The change must flush the instance cache and refresh the webview state.
      expect(reloaded).toBe(true)
      expect(refreshed).toBe(true)
      // It must NOT write to the never-loaded project config.json.
      await expect(readFile(join(dir, "config.json"), "utf8")).rejects.toThrow()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("project-scope agent config merges into existing opencode.json and can delete", async () => {
    const dir = await mkdtemp(join(tmpdir(), "raccoon-agent-"))
    try {
      await writeFile(
        join(dir, "opencode.json"),
        JSON.stringify({ $schema: "x", model: "openai/gpt-5", agent: { keep: { mode: "primary" } } }),
      )
      const client = v2Client(dir)
      const config = new RaccoonProviderConfig({
        client: async () => client as never,
        directory: () => dir,
        getState: () => ({}) as never,
        setState: () => {},
        post: () => {},
        refresh: async () => {},
        withLoading: async (run) => await run(),
        webviewHost: {
          post: () => {},
          postState: () => {},
          postError: () => {},
          postRaccoonLoginFinished: () => {},
          postCustomProviderSaved: () => {},
        } as never,
      })

      await config.configureAgent({
        type: "configureAgent",
        requestID: "create-project-reviewer",
        scope: "project",
        agent: { name: "reviewer", mode: "subagent" },
      })

      let written = JSON.parse(await readFile(join(dir, "opencode.json"), "utf8"))
      // Existing top-level keys and sibling agents are preserved.
      expect(written.model).toBe("openai/gpt-5")
      expect(written.agent?.keep).toMatchObject({ mode: "primary" })
      expect(written.agents?.reviewer).toMatchObject({ mode: "subagent" })

      await config.deleteAgent("reviewer", "project")
      written = JSON.parse(await readFile(join(dir, "opencode.json"), "utf8"))
      expect(written.agents?.reviewer).toBeUndefined()
      expect(written.agent?.keep).toMatchObject({ mode: "primary" })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("user-scope delete removes the agent and invalidates the global cache", async () => {
    const dir = await mkdtemp(join(tmpdir(), "raccoon-agent-"))
    const globalDir = await mkdtemp(join(tmpdir(), "raccoon-global-"))
    try {
      // Existing user-scope agent on disk in the global config file.
      await writeFile(
        join(globalDir, "opencode.json"),
        JSON.stringify({ agent: { mine: { mode: "subagent", description: "x" }, other: { mode: "all" } } }),
      )
      let reloaded = false
      const client = v2Client(globalDir, () => { reloaded = true })
      const config = new RaccoonProviderConfig({
        client: async () => client as never,
        directory: () => dir,
        getState: () => ({}) as never,
        setState: () => {},
        post: () => {},
        refresh: async () => {},
        withLoading: async (run) => await run(),
        webviewHost: {
          post: () => {},
          postState: () => {},
          postError: () => {},
          postRaccoonLoginFinished: () => {},
          postCustomProviderSaved: () => {},
        } as never,
      })

      await config.deleteAgent("mine", "user")

      // The agent key is actually removed from the loaded global file...
      const written = JSON.parse(await readFile(join(globalDir, "opencode.json"), "utf8"))
      expect(written.agent?.mine).toBeUndefined()
      expect(written.agent?.other).toMatchObject({ mode: "all" })
      expect(reloaded).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
      await rm(globalDir, { recursive: true, force: true })
    }
  })

  test("user-scope delete removes agents from jsonc config", async () => {
    const dir = await mkdtemp(join(tmpdir(), "raccoon-agent-"))
    const globalDir = await mkdtemp(join(tmpdir(), "raccoon-global-"))
    try {
      await writeFile(
        join(globalDir, "opencode.jsonc"),
        '{\n  // user agents\n  "agent": {\n    "mine": { "mode": "subagent" },\n  },\n}\n',
      )
      const client = v2Client(globalDir)
      const config = new RaccoonProviderConfig({
        client: async () => client as never,
        directory: () => dir,
        getState: () => ({}) as never,
        setState: () => {},
        post: () => {},
        refresh: async () => {},
        withLoading: async (run) => await run(),
        webviewHost: {
          post: () => {},
          postState: () => {},
          postError: () => {},
          postRaccoonLoginFinished: () => {},
          postCustomProviderSaved: () => {},
        } as never,
      })

      await config.deleteAgent("mine", "user")

      expect(await readFile(join(globalDir, "opencode.jsonc"), "utf8")).not.toContain('"mine"')
    } finally {
      await rm(dir, { recursive: true, force: true })
      await rm(globalDir, { recursive: true, force: true })
    }
  })

  test("project-scope delete falls back to user config when project has no matching agent", async () => {
    const dir = await mkdtemp(join(tmpdir(), "raccoon-agent-"))
    const globalDir = await mkdtemp(join(tmpdir(), "raccoon-global-"))
    try {
      await writeFile(
        join(globalDir, "opencode.json"),
        JSON.stringify({ agent: { mine: { mode: "subagent" }, other: { mode: "all" } } }),
      )
      const client = v2Client(globalDir)
      const config = new RaccoonProviderConfig({
        client: async () => client as never,
        directory: () => dir,
        getState: () => ({}) as never,
        setState: () => {},
        post: () => {},
        refresh: async () => {},
        withLoading: async (run) => await run(),
        webviewHost: {
          post: () => {},
          postState: () => {},
          postError: () => {},
          postRaccoonLoginFinished: () => {},
          postCustomProviderSaved: () => {},
        } as never,
      })

      await config.deleteAgent("mine", "project")

      const written = JSON.parse(await readFile(join(globalDir, "opencode.json"), "utf8"))
      expect(written.agent?.mine).toBeUndefined()
      expect(written.agent?.other).toMatchObject({ mode: "all" })
      await expect(readFile(join(dir, "opencode.json"), "utf8")).rejects.toThrow()
    } finally {
      await rm(dir, { recursive: true, force: true })
      await rm(globalDir, { recursive: true, force: true })
    }
  })

  test("user-scope delete removes markdown agent files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "raccoon-agent-"))
    const globalDir = await mkdtemp(join(tmpdir(), "raccoon-global-"))
    try {
      await mkdir(join(globalDir, "agents"), { recursive: true })
      await writeFile(join(globalDir, "agents", "mine.md"), "---\nmode: subagent\n---\n\nhelp")
      let reloaded = false
      const client = v2Client(globalDir, () => { reloaded = true })
      const config = new RaccoonProviderConfig({
        client: async () => client as never,
        directory: () => dir,
        getState: () => ({}) as never,
        setState: () => {},
        post: () => {},
        refresh: async () => {},
        withLoading: async (run) => await run(),
        webviewHost: {
          post: () => {},
          postState: () => {},
          postError: () => {},
          postRaccoonLoginFinished: () => {},
          postCustomProviderSaved: () => {},
        } as never,
      })

      await config.deleteAgent("mine", "user")

      await expect(stat(join(globalDir, "agents", "mine.md"))).rejects.toThrow()
      expect(reloaded).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
      await rm(globalDir, { recursive: true, force: true })
    }
  })

  test("user-scope create writes the exact agent to the global config file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "raccoon-agent-"))
    const globalDir = await mkdtemp(join(tmpdir(), "raccoon-global-"))
    try {
      let reloaded = false
      const client = v2Client(globalDir, () => { reloaded = true })
      const config = new RaccoonProviderConfig({
        client: async () => client as never,
        directory: () => dir,
        getState: () => ({}) as never,
        setState: () => {},
        post: () => {},
        refresh: async () => {},
        withLoading: async (run) => await run(),
        webviewHost: {
          post: () => {},
          postState: () => {},
          postError: () => {},
          postRaccoonLoginFinished: () => {},
          postCustomProviderSaved: () => {},
        } as never,
      })

      await config.configureAgent({
        type: "configureAgent",
        requestID: "create-user-helper",
        scope: "user",
        agent: { name: "helper", mode: "subagent", description: "global helper" },
      })

      // Empty global dir → defaults to the raccoon-branded config file.
      const written = JSON.parse(await readFile(join(globalDir, "raccoon.jsonc"), "utf8"))
      expect(written.agents?.helper).toMatchObject({ mode: "subagent", description: "global helper" })
      expect(reloaded).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
      await rm(globalDir, { recursive: true, force: true })
    }
  })

  test("moving and renaming an agent from project to user removes the project source", async () => {
    const dir = await mkdtemp(join(tmpdir(), "raccoon-agent-"))
    const globalDir = await mkdtemp(join(tmpdir(), "raccoon-global-"))
    try {
      await writeFile(join(dir, "raccoon.json"), JSON.stringify({ agent: { reviewer: { mode: "subagent" } } }))
      const client = v2Client(globalDir)
      const config = new RaccoonProviderConfig({
        client: async () => client as never,
        directory: () => dir,
        getState: () => ({}) as never,
        setState: () => {},
        post: () => {},
        refresh: async () => {},
        withLoading: async (run) => await run(),
        webviewHost: { post: () => {} } as never,
      })

      await config.configureAgent({
        type: "configureAgent",
        requestID: "move-project-user",
        original: { name: "reviewer", scope: "project" },
        scope: "user",
        agent: { name: "global-reviewer", mode: "subagent", description: "moved" },
      })

      const project = JSON.parse(await readFile(join(dir, "raccoon.json"), "utf8"))
      const user = JSON.parse(await readFile(join(globalDir, "raccoon.jsonc"), "utf8"))
      expect(project.agent?.reviewer).toBeUndefined()
      expect(user.agents?.["global-reviewer"]).toMatchObject({ mode: "subagent", description: "moved" })
    } finally {
      await rm(dir, { recursive: true, force: true })
      await rm(globalDir, { recursive: true, force: true })
    }
  })

  test("moving an agent from user to project removes the user source", async () => {
    const dir = await mkdtemp(join(tmpdir(), "raccoon-agent-"))
    const globalDir = await mkdtemp(join(tmpdir(), "raccoon-global-"))
    try {
      await writeFile(join(globalDir, "raccoon.json"), JSON.stringify({ agent: { helper: { mode: "subagent" } } }))
      const client = v2Client(globalDir)
      const config = new RaccoonProviderConfig({
        client: async () => client as never,
        directory: () => dir,
        getState: () => ({}) as never,
        setState: () => {},
        post: () => {},
        refresh: async () => {},
        withLoading: async (run) => await run(),
        webviewHost: { post: () => {} } as never,
      })

      await config.configureAgent({
        type: "configureAgent",
        requestID: "move-user-project",
        original: { name: "helper", scope: "user" },
        scope: "project",
        agent: { name: "helper", mode: "all", description: "local" },
      })

      const project = JSON.parse(await readFile(join(dir, "raccoon.jsonc"), "utf8"))
      const user = JSON.parse(await readFile(join(globalDir, "raccoon.json"), "utf8"))
      expect(project.agents?.helper).toMatchObject({ mode: "all", description: "local" })
      expect(user.agent?.helper).toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
      await rm(globalDir, { recursive: true, force: true })
    }
  })
})
