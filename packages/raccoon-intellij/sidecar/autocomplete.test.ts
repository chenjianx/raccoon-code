// @ts-expect-error Bun exposes this module to tests; the Sidecar compiler intentionally loads Node-only types.
import { expect, test } from "bun:test"
import { RaccoonAutocompleteService, type AutocompleteInput, type AutocompleteOutcome, type ConnectionState } from "@opencode-ai/raccoon-core"
import type { OpencodeClient } from "@opencode-ai/sdk/v2/client"
import type { RaccoonState } from "@opencode-ai/raccoon-webview"
import { SidecarAutocomplete, type AutocompleteEngine } from "./autocomplete.js"
import { SidecarPlatform } from "./platform.js"
import { SidecarWebviewTransport } from "./transport.js"
import type { SidecarToHost } from "./rpc.js"
import { RaccoonProviderConfig } from "../../raccoon-core/src/provider/config/provider-config.js"

const input = (completionId: string): AutocompleteInput => ({
  completionId,
  filepath: "/workspace/example.ts",
  languageId: "typescript",
  pos: { line: 0, character: 14 },
  fileContents: "const answer = ",
  isUntitledFile: false,
})

const outcome = (completion: string, completionId: string): AutocompleteOutcome => ({
  completion,
  prefix: "const answer = ",
  suffix: "",
  modelName: "raccoon-pro-completion",
  cacheHit: false,
  time: 1,
  numLines: 1,
  completionId,
  filepath: "/workspace/example.ts",
})

class ControlledEngine implements AutocompleteEngine {
  readonly requests = new Map<
    string,
    { signal: AbortSignal; resolve: (value: AutocompleteOutcome | undefined) => void }
  >()
  readonly accepted: { completion: string; filepath: string }[] = []
  readonly models: string[] = []
  resets = 0

  complete(request: AutocompleteInput, signal: AbortSignal): Promise<AutocompleteOutcome | undefined> {
    return new Promise((resolve) => this.requests.set(request.completionId, { signal, resolve }))
  }

  accept(completion: string, filepath: string): void {
    this.accepted.push({ completion, filepath })
  }

  setModel(model: string): void {
    this.models.push(model)
  }

  resetBackoff(): void {
    this.resets += 1
  }
}

test("a newer request aborts the prior request and suppresses its stale result", async () => {
  const engine = new ControlledEngine()
  const sent: SidecarToHost[] = []
  const coordinator = new SidecarAutocomplete(engine, (message) => sent.push(message))

  coordinator.complete("one", input("completion-one"))
  const first = engine.requests.get("completion-one")!
  coordinator.complete("two", input("completion-two"))
  const second = engine.requests.get("completion-two")!

  expect(first.signal.aborted).toBe(true)
  first.resolve(outcome("first", "completion-one"))
  second.resolve(outcome("second", "completion-two"))
  await settle()

  expect(sent).toEqual([{ type: "autocompleteResult", requestID: "two", completion: "second" }])
})

test("cancel aborts only the matching active request and suppresses its result", async () => {
  const engine = new ControlledEngine()
  const sent: SidecarToHost[] = []
  const coordinator = new SidecarAutocomplete(engine, (message) => sent.push(message))

  coordinator.complete("one", input("completion-one"))
  const active = engine.requests.get("completion-one")!

  coordinator.cancel("two")
  expect(active.signal.aborted).toBe(false)
  coordinator.cancel("one")
  expect(active.signal.aborted).toBe(true)

  active.resolve(outcome("first", "completion-one"))
  await settle()
  expect(sent).toEqual([])
})

test("disabled requests return one empty result without calling the engine", () => {
  const engine = new ControlledEngine()
  const sent: SidecarToHost[] = []
  const coordinator = new SidecarAutocomplete(engine, (message) => sent.push(message))

  coordinator.setEnabled(false)
  coordinator.complete("one", input("completion-one"))

  expect(engine.requests.size).toBe(0)
  expect(sent).toEqual([{ type: "autocompleteResult", requestID: "one" }])
})

test("disabling aborts the active request and suppresses its result", async () => {
  const engine = new ControlledEngine()
  const sent: SidecarToHost[] = []
  const coordinator = new SidecarAutocomplete(engine, (message) => sent.push(message))

  coordinator.complete("one", input("completion-one"))
  const active = engine.requests.get("completion-one")!
  coordinator.setEnabled(false)

  expect(active.signal.aborted).toBe(true)
  active.resolve(outcome("first", "completion-one"))
  await settle()
  expect(sent).toEqual([])
})

test("dispose aborts the active request and suppresses its result", async () => {
  const engine = new ControlledEngine()
  const sent: SidecarToHost[] = []
  const coordinator = new SidecarAutocomplete(engine, (message) => sent.push(message))

  coordinator.complete("one", input("completion-one"))
  const active = engine.requests.get("completion-one")!
  coordinator.dispose()

  expect(active.signal.aborted).toBe(true)
  active.resolve(outcome("first", "completion-one"))
  await settle()
  expect(sent).toEqual([])
})

test("forwards accepted completions, model changes, and backoff resets", () => {
  const engine = new ControlledEngine()
  const coordinator = new SidecarAutocomplete(engine, () => {})

  coordinator.accept("42", "/workspace/example.ts")
  coordinator.setModel("raccoon-completion")
  coordinator.resetBackoff()

  expect(engine.accepted).toEqual([{ completion: "42", filepath: "/workspace/example.ts" }])
  expect(engine.models).toEqual(["raccoon-completion"])
  expect(engine.resets).toBe(1)
})

test("platform normalizes and reports autocomplete setting changes for persistence", async () => {
  const changes: { enabled: boolean; model: string }[] = []
  const enabledChanges: boolean[] = []
  const modelChanges: string[] = []
  const platform = new SidecarPlatform({
    directory: "/workspace",
    locale: "en",
    autocompleteEnabled: true,
    autocompleteModel: "raccoon-completion",
    storageDir: "/tmp/raccoon-intellij-autocomplete-test",
    log: () => {},
    onAutocompleteSettingsChange: (settings) => changes.push(settings),
  })
  platform.settings.onAutocompleteEnabledChange((enabled) => enabledChanges.push(enabled))
  platform.settings.onAutocompleteModelChange((model) => modelChanges.push(model))

  await platform.settings.setAutocompleteEnabled(false)
  await platform.settings.setAutocompleteModel("unknown")
  await platform.settings.setAutocompleteModel("unknown")

  expect(enabledChanges).toEqual([false])
  expect(modelChanges).toEqual(["raccoon-pro-completion"])
  expect(changes).toEqual([
    { enabled: false, model: "raccoon-completion" },
    { enabled: false, model: "raccoon-pro-completion" },
  ])
})

function settle() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

const authState = (raccoonLoggedIn: boolean): RaccoonState => ({
  sessions: [], messages: [], agents: [], models: [], providers: [], mode: "build", loading: false, raccoonLoggedIn,
})

for (const recovery of ["enable", "model", "connection", "authentication", "login", "cancel", "failedLogin"] as const) {
  test(`fatal backoff handles ${recovery} through the production event path`, async () => {
    let calls = 0
    let authorizeStarted = () => {}
    const authorizationStarted = new Promise<void>((resolve) => { authorizeStarted = resolve })
    const client = {
      fim: {
        complete: async () => {
          calls += 1
          throw new Error("FIM request failed: 401 Unauthorized")
        },
      },
      provider: {
        auth: async () => ({ data: { raccoon: [{ type: "oauth", label: "Raccoon sign-in" }] } }),
        oauth: {
          authorize: async (_request: unknown, options: { signal: AbortSignal }) => {
            if (recovery === "cancel") {
              authorizeStarted()
              return new Promise((_, reject) => {
                options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")))
              })
            }
            return { data: { url: "https://example.test/login", method: "auto", instructions: "" } }
          },
          callback: async () => {
            if (recovery === "failedLogin") throw new Error("Invalid credentials")
          },
        },
      },
      instance: { dispose: async () => {} },
    } as unknown as OpencodeClient
    const listeners = new Set<(state: ConnectionState) => void>()
    const connection = {
      getConnectionState: (): ConnectionState => "connected",
      getClientAsync: async () => client,
      onStateChange: (listener: (state: ConnectionState) => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    }
    const platform = new SidecarPlatform({
      directory: "/workspace", locale: "en", autocompleteEnabled: true,
      autocompleteModel: "raccoon-pro-completion", storageDir: "/tmp/raccoon-intellij-autocomplete-test",
      log: () => {}, onAutocompleteSettingsChange: () => {},
    })
    const waiting = new Map<string, () => void>()
    const coordinator = new SidecarAutocomplete(
      new RaccoonAutocompleteService(connection, "/workspace", platform.settings.getAutocompleteModel()),
      (message) => {
        if (message.type === "autocompleteResult") waiting.get(message.requestID)?.()
      },
      { connection, settings: platform.settings },
    )
    const messages: SidecarToHost[] = []
    const transport = new SidecarWebviewTransport((message) => messages.push(message), () => coordinator.resetBackoff())
    const loggedIn = recovery === "login" || recovery === "cancel" || recovery === "failedLogin"
    transport.markReady("chat")
    transport.postState(authState(loggedIn))
    const request = (id: string) => new Promise<void>((resolve) => {
      waiting.set(id, resolve)
      coordinator.complete(id, { ...input(id), fileContents: `const ${id} = `, pos: { line: 0, character: id.length + 9 } })
    })

    await request("first")
    await request("blocked")
    expect(calls).toBe(1)
    await platform.settings.setAutocompleteEnabled(true)
    await platform.settings.setAutocompleteModel("raccoon-pro-completion")
    listeners.forEach((listener) => listener("connecting"))
    transport.postState(authState(loggedIn))
    await request("stillblocked")
    expect(calls).toBe(1)

    if (recovery === "enable") {
      await platform.settings.setAutocompleteEnabled(false)
      await platform.settings.setAutocompleteEnabled(true)
    }
    if (recovery === "model") await platform.settings.setAutocompleteModel("raccoon-completion")
    if (recovery === "connection") listeners.forEach((listener) => listener("connected"))
    if (recovery === "authentication") transport.postState(authState(true))
    if (loggedIn) {
      const config = new RaccoonProviderConfig({
        client: async () => client,
        directory: () => "/workspace",
        getState: () => authState(true),
        setState: () => {},
        post: () => transport.postState(authState(true)),
        refresh: async () => { transport.postState(authState(true)) },
        withLoading: async (run) => { await run() },
        webviewHost: transport,
        openExternal: async () => {},
        promptInput: async () => undefined,
        pluginLanguage: () => "en",
      })
      const login = config.loginRaccoon({ type: "loginRaccoon", method: "browser" }, "chat")
      if (recovery === "cancel") {
        await authorizationStarted
        config.cancelRaccoonLogin()
      }
      if (recovery === "failedLogin") await expect(login).rejects.toThrow("Invalid credentials")
      else await login
      expect(messages.filter((message) => message.type === "post" && message.message.type === "raccoonLoginFinished"))
        .toEqual([{
          type: "post", source: "chat",
          message: { type: "raccoonLoginFinished", ...(recovery === "failedLogin" ? { error: "Invalid credentials" } : {}) },
        }])
    }

    await request("recovered")
    expect(calls).toBe(recovery === "cancel" || recovery === "failedLogin" ? 1 : 2)
    coordinator.dispose()
    expect(listeners.size).toBe(0)
  })
}
