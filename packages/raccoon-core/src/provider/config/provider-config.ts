import * as fs from "node:fs/promises"
import * as nodePath from "node:path"
import { applyEdits, modify, parse as parseJsonc, type ParseError } from "jsonc-parser/lib/esm/main.js"
import type { AgentInfo, ConfigEntry, FormFields, OpenCodeClient } from "@opencode/client/promise"
import type {
  ChatMode,
  ExtensionToWebview,
  RaccoonCommand,
  RaccoonAgentScope,
  RaccoonModel,
  RaccoonPermissionConfig,
  RaccoonProviderAuthMethod,
  RaccoonPluginLanguage,
  RaccoonPluginLanguageMode,
  RaccoonSlashCommand,
  RaccoonState,
  WebviewToExtension,
} from "@opencode-ai/raccoon-webview"
import { uiSlashCommands } from "./commands.js"
import { mapProviderModels, mapProviders, recountProviders } from "../message/mapping.js"
import { ModelStateStore, type ModelSelection, modelKey, modeModelSelections } from "../session/model-state.js"
import { ActionTokenStore } from "../session/action-tokens.js"
import { collectRules } from "./rules-config.js"
import { collectCommands } from "./commands-config.js"
import type { KeyValueStore, RaccoonWebviewSource, WebviewTransport } from "../platform.js"
import { GLOBAL_CONFIG_FILES, PROJECT_CONFIG_FILES, globalConfigDir, pickConfigFile } from "./config-paths.js"

type ProviderConfigDeps = {
  client: () => Promise<OpenCodeClient>
  directory: () => string
  getState: () => RaccoonState
  setState: (state: RaccoonState) => void
  post: () => void
  refresh: () => Promise<void>
  withLoading: (run: () => Promise<void>) => Promise<void>
  storage?: KeyValueStore
  webviewHost: WebviewTransport
  openExternal: (url: string) => Promise<void>
  promptInput: (options: { title: string; prompt?: string }) => Promise<string | undefined>
  pluginLanguage: () => RaccoonPluginLanguage
}

type OpencodeAgentConfig = NonNullable<Extract<ConfigEntry, { type: "document" }>["info"]["agents"]>[string]

export class RaccoonProviderConfig {
  private disabledModels = new Set<string>()
  private selectedModel?: ModelSelection
  private modeModels: Partial<Record<ChatMode, ModelSelection>> = {}
  private providerAuthMethods: Record<string, RaccoonProviderAuthMethod[]> = {}
  private pluginLanguageMode: RaccoonPluginLanguageMode
  private readonly raccoonLoginTokens = new ActionTokenStore()
  private raccoonLoginAbort?: AbortController
  private readonly providerConnectTokens = new ActionTokenStore()
  private readonly providerConnectAbort = new Map<string, AbortController>()
  private readonly modelState: ModelStateStore

  constructor(private readonly deps: ProviderConfigDeps) {
    this.disabledModels = new Set(deps.storage?.get<string[]>("raccoon.disabledModels", []) ?? [])
    this.selectedModel = deps.getState().selectedModel
    this.modeModels = modeModelSelections(deps.storage?.get("raccoon.modeModels"))
    this.pluginLanguageMode = normalizePluginLanguageMode(deps.storage?.get<string>("raccoon.pluginLanguage"))
    this.modelState = new ModelStateStore(() => this.deps.directory())
  }

  initialState() {
    return {
      selectedModel: this.selectedModel,
      defaultModel: this.selectedModel,
      modeModels: this.modeModels,
      pluginLanguageMode: this.pluginLanguageMode,
      pluginLanguage: this.resolvePluginLanguage(),
    }
  }

  modeModel(mode: ChatMode) {
    return this.modeModels[mode]
  }

  // The persisted default model, resolved against the enabled model list. Unlike
  // `selectModel`, this ignores both the per-mode override and the live `state.selectedModel`
  // (which tracks the active mode in chat) so it stays stable when the user switches modes.
  resolveDefaultModel(models: RaccoonModel[], defaults: Record<string, string>) {
    const enabledModels = models.filter((model) => model.enabled && model.connected)
    const selectedModel = this.selectedModel
    if (selectedModel && enabledModels.some((model) => modelKey(model) === modelKey(selectedModel))) {
      return selectedModel
    }
    // No model has been explicitly configured (no persisted `selectedModel`). When Raccoon is
    // logged in its models are connected, so prefer Raccoon here — its server default, else any
    // Raccoon model. This keeps the default on Raccoon after a silent token refresh / webview
    // reload (which never fires `raccoonLoginFinished`), matching the login behavior. An explicit
    // non-Raccoon choice is preserved by the `selectedModel` branch above.
    const raccoonModels = enabledModels.filter((model) => model.providerID === "raccoon")
    const firstRaccoon = raccoonModels[0]
    if (firstRaccoon) {
      const raccoonDefault = raccoonModels.find((model) => defaults["raccoon"] === model.modelID) ?? firstRaccoon
      return { providerID: raccoonDefault.providerID, modelID: raccoonDefault.modelID }
    }
    const defaultModel = enabledModels.find((model) => defaults[model.providerID] === model.modelID)
    if (defaultModel) return { providerID: defaultModel.providerID, modelID: defaultModel.modelID }
    const firstModel = enabledModels[0]
    if (!firstModel) return undefined
    return { providerID: firstModel.providerID, modelID: firstModel.modelID }
  }

  selectModel(models: RaccoonModel[], defaults: Record<string, string>, mode = this.deps.getState().mode) {
    const enabledModels = models.filter((model) => model.enabled && model.connected)
    const modeModel = this.modeModels[mode]
    if (modeModel && enabledModels.some((model) => modelKey(model) === modelKey(modeModel))) {
      return modeModel
    }
    return this.resolveDefaultModel(models, defaults)
  }

  async loadModels(client?: OpenCodeClient) {
    const active = client ?? (await this.deps.client())
    const saved = await this.modelState.load(active, { selected: this.selectedModel, model: this.modeModels })
    this.selectedModel = saved.selected
    this.modeModels = saved.model
    const [
      providerResponse,
      modelResponse,
      defaultResponse,
      integrationResponse,
      commandResponse,
      agentResponse,
      configEntries,
    ] = await Promise.all([
      active.provider.list({ location: { directory: this.deps.directory() } }),
      active.model.list({ location: { directory: this.deps.directory() } }),
      active.model.default({ location: { directory: this.deps.directory() } }),
      active.integration.list({ location: { directory: this.deps.directory() } }),
      active.command.list({ location: { directory: this.deps.directory() } }),
      active.agent.list({ location: { directory: this.deps.directory() } }),
      active.config.get({ location: { directory: this.deps.directory() } }),
    ])
    // 暂时隐藏「免费模型」：opencode provider 提供的免费模型不再进入模型列表，
    // 因此对话/设置的模型选择器和默认模型解析都不会再出现它们。恢复时删除此过滤即可。
    const visibleProviders = providerResponse.data.filter((provider) => provider.id !== "opencode")
    this.providerAuthMethods = Object.fromEntries(visibleProviders.map((provider) => {
      const integration = integrationResponse.data.find((entry) => entry.id === (provider.integrationID ?? provider.id))
      return [provider.id, integration?.methods.flatMap((method): RaccoonProviderAuthMethod[] => {
        if (method.type === "oauth") return [{ type: "oauth", label: method.label, prompts: authPrompts(method.form) }]
        if (method.type === "key") return [{ type: "api", label: method.label ?? "API key", prompts: authPrompts(method.form) }]
        return []
      }) ?? []]
    }))
    const models = mapProviderModels(modelResponse.data, visibleProviders, integrationResponse.data, this.disabledModels)
    const providers = mapProviders(visibleProviders, integrationResponse.data, models)
    const globalRoot = configEntries.find((entry) => entry.type === "directory")?.path
    const documents = configEntries.filter((entry) => entry.type === "document")
    const global = documents.filter((entry) => entry.path && globalRoot && nodePath.dirname(entry.path) === globalRoot)
    const globalProviders = new Map(global.flatMap((entry) => Object.entries(entry.info.providers ?? {})))
    const customProviders = [...globalProviders].flatMap(([providerID, value]) => {
      const provider = visibleProviders.find((entry) => entry.id === providerID)
      if (!provider || !value.models || !Object.keys(value.models).length) return []
      return [{
        providerID,
        name: value.name ?? provider.name,
        package: customProviderPackage(value.package),
        baseURL: typeof value.settings?.baseURL === "string" ? value.settings.baseURL : "",
        headers: value.headers,
        models: Object.entries(value.models).map(([id, model]) => ({
          id, name: model.name ?? id, supportsImage: model.capabilities?.input.includes("image") ?? false,
        })),
      }]
    })
    const commands = commandResponse.data.map(
      (command): RaccoonCommand => ({
        name: command.name,
        description: command.description,
        source: "command",
        hints: [],
      }),
    )
    const projectAgentNames = await collectProjectAgentNames(this.deps.directory())
    const globalAgents = Object.assign({}, ...global.map((entry) => entry.info.agents ?? {}))
    const agentOverrides = collectAgentOverrides(globalAgents, ...documents.map((entry) => entry.info.agents))
    const agentScopes = collectAgentScopes(globalAgents, projectAgentNames)
    const [projectRules, userRules, projectCommands, userCommands] = await Promise.all([
      collectRules(active, this.deps.directory(), "project").catch(() => []),
      collectRules(active, this.deps.directory(), "user").catch(() => []),
      collectCommands(active, this.deps.directory(), "project").catch(() => []),
      collectCommands(active, this.deps.directory(), "user").catch(() => []),
    ])
    const raccoonLoggedIn = integrationResponse.data.some((entry) => entry.id === "raccoon" && entry.connections.some((connection) => connection.type === "credential" && connection.method === "oauth"))
    const defaults = defaultResponse.data ? { [defaultResponse.data.providerID]: defaultResponse.data.modelID } : {}
    this.deps.setState({
      ...this.deps.getState(),
      models,
      raccoonLoggedIn,
      defaults,
      agents: visibleAgents(agentResponse.data, agentOverrides, agentScopes),
      rules: [...projectRules, ...userRules],
      commandConfigs: [...projectCommands, ...userCommands],
      providers,
      commands,
      slashCommands: [
        ...uiSlashCommands(),
        ...commands.map(
          (command): RaccoonSlashCommand => ({
            name: command.name,
            description: command.description,
            source: command.source ?? "command",
            mode: "prompt",
          }),
        ),
      ],
      providerAuthMethods: this.providerAuthMethods,
      customProviders,
      selectedModel: this.selectModel(models, defaults),
      defaultModel: this.resolveDefaultModel(models, defaults),
      modeModels: this.modeModels,
      pluginLanguageMode: this.pluginLanguageMode,
      pluginLanguage: this.resolvePluginLanguage(),
    })
  }

  async setModelEnabled(model: { providerID: string; modelID: string }, enabled: boolean) {
    const key = modelKey(model)
    if (enabled) {
      this.disabledModels.delete(key)
    } else {
      this.disabledModels.add(key)
    }
    await this.deps.storage?.update("raccoon.disabledModels", [...this.disabledModels])
    const models = this.deps.getState().models.map((item) => (modelKey(item) === key ? { ...item, enabled } : item))
    this.deps.setState({
      ...this.deps.getState(),
      models,
      providers: recountProviders(this.deps.getState().providers, models),
      selectedModel: this.selectModel(models, {}, this.deps.getState().mode),
      modeModels: this.modeModels,
      pluginLanguageMode: this.pluginLanguageMode,
      pluginLanguage: this.resolvePluginLanguage(),
    })
    this.deps.post()
  }

  async setProviderEnabled(providerID: string, enabled: boolean) {
    this.deps
      .getState()
      .models.filter((item) => item.providerID === providerID)
      .forEach((model) => {
        const key = modelKey(model)
        if (enabled) {
          this.disabledModels.delete(key)
          return
        }
        this.disabledModels.add(key)
      })
    await this.deps.storage?.update("raccoon.disabledModels", [...this.disabledModels])
    const models = this.deps
      .getState()
      .models.map((model) => (model.providerID === providerID ? { ...model, enabled } : model))
    this.deps.setState({
      ...this.deps.getState(),
      models,
      providers: recountProviders(this.deps.getState().providers, models),
      selectedModel: this.selectModel(models, {}, this.deps.getState().mode),
      pluginLanguageMode: this.pluginLanguageMode,
      pluginLanguage: this.resolvePluginLanguage(),
    })
    this.deps.post()
  }

  async configureProvider(providerID: string, apiKey: string) {
    const client = await this.deps.client()
    if (apiKey.trim()) {
      const location = { directory: this.deps.directory() }
      const provider = await client.provider.get({ providerID, location })
      await client.integration.connect.key({ integrationID: provider.data.integrationID ?? providerID, key: apiKey.trim(), location })
    }
    await setProviderPolicy(await this.globalConfigFile(), providerID, "allow")
    await client.location.reload()
    await this.deps.refresh()
  }

  async configureAgent(message: Extract<WebviewToExtension, { type: "configureAgent" }>) {
    const targetName = requireAgentName(message.agent.name ?? message.original?.name ?? "")
    await this.writeAgentConfig(message.scope, targetName, agentConfigValue(message.agent))
    if (message.original && (message.original.name !== targetName || message.original.scope !== message.scope)) {
      await this.writeAgentConfig(message.original.scope, requireAgentName(message.original.name), undefined)
    }
    await this.reloadInstanceConfig()
    await this.deps.refresh()
    return { name: targetName, scope: message.scope }
  }

  async deleteAgent(name: string, scope: RaccoonAgentScope) {
    const agent = requireAgentName(name)
    const deleted = await this.writeAgentConfig(scope, agent, undefined)
    if (!deleted && scope === "project") await this.writeAgentConfig("user", agent, undefined)
    await this.reloadInstanceConfig()
    await this.deps.refresh()
  }

  // opencode resolves config/agents once per instance and caches the result;
  // it only re-reads from disk when the instance is disposed. Writing the
  // config file is therefore not enough for `app.agents()`/`config.get` to
  // reflect the change, so dispose the instance (teardown runs after the HTTP
  // response) to flush those caches before refreshing the webview state.
  private async reloadInstanceConfig() {
    try {
      const client = await this.deps.client()
      await client.location.reload()
    } catch {
      // Best-effort: the config file is already written; a stale view will
      // recover on the next full reload.
    }
  }

  private async writeAgentConfig(scope: RaccoonAgentScope, name: string, value: OpencodeAgentConfig | undefined) {
    if (scope === "user") {
      return await this.writeUserAgentConfig(name, value)
    }
    // Project scope: `client.config.update` persists to `<dir>/config.json`,
    // which opencode never loads as project config (it only reads
    // `opencode.json`/`opencode.jsonc`). Write directly to the loaded file so
    // the change actually takes effect.
    const file = await pickConfigFile(this.deps.directory(), PROJECT_CONFIG_FILES)
    const wrote = await writeAgentToFile(file, name, value)
    const deletedMarkdown =
      value === undefined ? await deleteProjectAgentMarkdownFiles(this.deps.directory(), name) : false
    return wrote || deletedMarkdown
  }

  private async writeUserAgentConfig(name: string, value: OpencodeAgentConfig | undefined) {
    const client = await this.deps.client()
    const configDir = await globalConfigDir(client, this.deps.directory())
    if (!configDir) return
    const file = await pickConfigFile(configDir, GLOBAL_CONFIG_FILES)
    const wrote = await writeAgentToFile(file, name, value)
    const deletedMarkdown = value === undefined ? await deleteAgentMarkdownFiles(configDir, name) : false
    return wrote || deletedMarkdown
  }

  async connectProvider(message: Extract<WebviewToExtension, { type: "connectProvider" }>) {
    const token = this.providerConnectTokens.issue(message.providerID)
    this.providerConnectAbort.get(message.providerID)?.abort()
    const abort = new AbortController()
    this.providerConnectAbort.set(message.providerID, abort)
    const cancelled = () => !this.providerConnectTokens.isCurrent(message.providerID, token)
    try {
      const client = await this.deps.client()
      if (cancelled()) return
      const location = { directory: this.deps.directory() }
      const provider = await client.provider.get({ providerID: message.providerID, location })
      const integration = await client.integration.get({ integrationID: provider.data.integrationID ?? message.providerID, location })
      const authMethods = integration.data.methods.filter((method) => method.type === "oauth" || method.type === "key")
      const methodIndex = message.methodIndex ?? 0
      const method = authMethods[methodIndex]
      if (!method) throw new Error("Provider auth method not found")
      if (method.type === "oauth") {
        const authorization = await client.integration.oauth.connect({
          integrationID: integration.data.id, methodID: method.id, location,
          ...(message.inputs ? { answer: message.inputs } : {}),
        }, { signal: abort.signal })
        if (cancelled()) return
        if (authorization.data.url) await this.deps.openExternal(authorization.data.url)
        if (authorization.data.mode === "code") {
          const code = await this.deps.promptInput({
            title: `${method.label} authorization code`,
            prompt: authorization.data.instructions,
          })
          if (cancelled()) return
          if (!code) throw new Error("Provider login cancelled")
          await client.integration.oauth.complete({
            integrationID: integration.data.id, attemptID: authorization.data.attemptID, location, code,
          }, { signal: abort.signal })
        } else {
          await waitForOAuth(client, integration.data.id, authorization.data.attemptID, location, abort.signal)
        }
        if (cancelled()) return
      }
      if (method.type === "key" && message.apiKey?.trim()) {
        await client.integration.connect.key({
          integrationID: integration.data.id, location, key: message.apiKey.trim(),
          ...(message.inputs ? { answer: message.inputs } : {}),
        }, { signal: abort.signal })
        if (cancelled()) return
      }
      await setProviderPolicy(await this.globalConfigFile(), message.providerID, "allow")
      await client.location.reload()
      if (cancelled()) return
      await this.deps.refresh()
      if (cancelled()) return
      this.deps.webviewHost.post("settings", {
        type: "providerConnectFinished",
        providerID: message.providerID,
      } satisfies ExtensionToWebview)
    } catch (error) {
      if (cancelled()) return
      this.deps.webviewHost.post("settings", {
        type: "providerConnectFinished",
        providerID: message.providerID,
        error: error instanceof Error ? error.message : String(error),
      } satisfies ExtensionToWebview)
    } finally {
      if (this.providerConnectAbort.get(message.providerID) === abort) this.providerConnectAbort.delete(message.providerID)
    }
  }

  cancelProviderConnect(providerID?: string) {
    const providerIDs = providerID ? [providerID] : this.providerConnectTokens.keys()
    providerIDs.forEach((id) => this.providerConnectTokens.cancel(id))
    providerIDs.forEach((id) => this.providerConnectAbort.get(id)?.abort())
    this.deps.setState({ ...this.deps.getState(), loading: false, busy: false })
    this.deps.post()
    providerIDs.forEach((id) => {
      this.deps.webviewHost.post("settings", {
        type: "providerConnectFinished",
        providerID: id,
      } satisfies ExtensionToWebview)
    })
  }

  // Drop stored credentials and deny the provider so environment credentials
  // do not leave it visible after disconnecting.
  async disconnectProvider(providerID: string) {
    try {
      const client = await this.deps.client()
      const location = { directory: this.deps.directory() }
      const provider = await client.provider.get({ providerID, location })
      const integration = await client.integration.get({ integrationID: provider.data.integrationID ?? providerID, location })
      await Promise.all(integration.data.connections.filter((entry) => entry.type === "credential").map((entry) => client.credential.remove({ credentialID: entry.id })))
      await setProviderPolicy(await this.globalConfigFile(), providerID, "deny")
      await client.location.reload()
      await this.deps.refresh()
      this.deps.webviewHost.post("settings", {
        type: "providerConnectFinished",
        providerID,
      } satisfies ExtensionToWebview)
    } catch (error) {
      this.deps.webviewHost.post("settings", {
        type: "providerConnectFinished",
        providerID,
        error: error instanceof Error ? error.message : String(error),
      } satisfies ExtensionToWebview)
    }
  }

  async loginRaccoon(message: Extract<WebviewToExtension, { type: "loginRaccoon" }>, source: RaccoonWebviewSource) {
    this.raccoonLoginAbort?.abort()
    const abort = new AbortController()
    this.raccoonLoginAbort = abort
    const token = this.raccoonLoginTokens.issue()
    await this.deps
      .withLoading(async () => {
        const client = await this.deps.client()
        const location = { directory: this.deps.directory() }
        const integration = await client.integration.get({ integrationID: "raccoon", location })
        if (!integration.data.methods.some((method) => method.type === "oauth" && method.id === message.method))
          throw new Error("Raccoon login is not available. Check that the Raccoon auth plugin is loaded.")
        if (!this.raccoonLoginTokens.isCurrent(undefined, token)) return

        const authorization = await client.integration.oauth.connect({
          integrationID: "raccoon",
          methodID: message.method,
          location,
          answer: message.method === "phone"
            ? { nationCode: message.nationCode, phone: message.phone, password: message.password, ...(message.serverUrl ? { serverUrl: message.serverUrl } : {}) }
            : message.serverUrl ? { serverUrl: message.serverUrl } : {},
        }, { signal: abort.signal })
        if (!this.raccoonLoginTokens.isCurrent(undefined, token)) return
        if (authorization.data.mode === "code") {
          if (authorization.data.url) await this.deps.openExternal(authorization.data.url)
          const code = await this.deps.promptInput({
            title: "Raccoon authorization code",
            prompt: authorization.data.instructions,
          })
          if (!this.raccoonLoginTokens.isCurrent(undefined, token)) return
          if (!code) throw new Error("Raccoon login cancelled")
          await client.integration.oauth.complete({
            integrationID: "raccoon", attemptID: authorization.data.attemptID, location, code,
          }, { signal: abort.signal })
        } else {
          if (authorization.data.url) await this.deps.openExternal(authorization.data.url)
          await waitForOAuth(client, "raccoon", authorization.data.attemptID, location, abort.signal)
        }
        if (!this.raccoonLoginTokens.isCurrent(undefined, token)) return
        await client.location.reload()
        await this.deps.refresh()
        if (!this.raccoonLoginTokens.isCurrent(undefined, token)) return
        this.deps.webviewHost.post(source, { type: "raccoonLoginFinished" } satisfies ExtensionToWebview)
      })
      .catch((error) => {
        if (!this.raccoonLoginTokens.isCurrent(undefined, token)) return
        this.deps.webviewHost.post(source, {
          type: "raccoonLoginFinished",
          error: error instanceof Error ? error.message : String(error),
        } satisfies ExtensionToWebview)
        throw error
      })
      .finally(() => {
        if (this.raccoonLoginAbort === abort) this.raccoonLoginAbort = undefined
      })
  }

  cancelRaccoonLogin() {
    this.raccoonLoginTokens.cancel()
    this.raccoonLoginAbort?.abort()
    this.raccoonLoginAbort = undefined
    this.deps.setState({ ...this.deps.getState(), loading: false, busy: false })
    this.deps.post()
    this.deps.webviewHost.postRaccoonLoginFinished()
  }

  async logoutRaccoon() {
    const client = await this.deps.client()
    const integration = await client.integration.get({ integrationID: "raccoon", location: { directory: this.deps.directory() } })
    await Promise.all(integration.data.connections.filter((entry) => entry.type === "credential").map((entry) => client.credential.remove({ credentialID: entry.id })))
    await client.location.reload()
  }

  private async globalConfigFile() {
    const client = await this.deps.client()
    const configDir = await globalConfigDir(client, this.deps.directory())
    if (!configDir) throw new Error("Unable to resolve the global opencode config directory")
    return pickConfigFile(configDir, GLOBAL_CONFIG_FILES)
  }

  async configureCustomProvider(message: Extract<WebviewToExtension, { type: "configureCustomProvider" }>) {
    const providerID = message.providerID.trim()
    const name = message.name.trim()
    const baseURL = message.baseURL.trim()
    const headers = cleanHeaders(message.headers)
    const models = message.models
      .map((model) => ({ id: model.id.trim(), name: model.name.trim(), supportsImage: model.supportsImage ?? false }))
      .filter((model) => model.id && model.name)
    if (!providerID || !name || !baseURL || models.length === 0) throw new Error("Custom provider fields are required")
    if (!/^https?:\/\//.test(baseURL)) throw new Error("Custom provider base URL must start with http:// or https://")
    const client = await this.deps.client()
    const providerValue = {
      package: message.package,
      name,
      settings: { baseURL },
      ...(headers ? { headers } : {}),
      models: Object.fromEntries(
        models.map((model) => [
          model.id,
          {
            name: model.name,
            ...(model.supportsImage
              ? {
                  capabilities: {
                    tools: true,
                    input: ["text", "image"],
                    output: ["text"],
                  },
                }
              : {}),
          },
        ]),
      ),
    }
    const file = await this.globalConfigFile()
    await writeProviderToFile(file, providerID, providerValue)
    await setProviderPolicy(file, providerID, "allow")
    await client.location.reload()
    if (message.apiKey.trim()) {
      await client.integration.connect.key({
        integrationID: providerID, key: message.apiKey.trim(), location: { directory: this.deps.directory() },
      })
    }
    models.forEach((model) => this.disabledModels.delete(modelKey({ providerID, modelID: model.id })))
    await this.deps.storage?.update("raccoon.disabledModels", [...this.disabledModels])
    await this.deps.refresh()
    this.deps.webviewHost.postCustomProviderSaved(providerID)
  }

  async deleteCustomProvider(providerID: string) {
    const id = providerID.trim()
    if (!id) throw new Error("Custom provider ID is required")
    const client = await this.deps.client()
    const file = await this.globalConfigFile()
    await writeProviderToFile(file, id, undefined)
    await setProviderPolicy(file, id, "deny")
    await client.location.reload()
    this.disabledModels = new Set([...this.disabledModels].filter((key) => !key.startsWith(`${id}/`)))
    await this.deps.storage?.update("raccoon.disabledModels", [...this.disabledModels])
    await this.deps.refresh()
    this.deps.webviewHost.postCustomProviderSaved(id)
  }

  async setModeModel(mode: ChatMode, model?: ModelSelection) {
    if (model) {
      this.modeModels = { ...this.modeModels, [mode]: model }
    } else {
      const next = { ...this.modeModels }
      delete next[mode]
      this.modeModels = next
    }
    await this.modelState.write(await this.deps.client(), { selected: this.selectedModel, model: this.modeModels })
    await this.deps.storage?.update("raccoon.modeModels", undefined)
    this.deps.setState({
      ...this.deps.getState(),
      modeModels: this.modeModels,
      selectedModel: model && mode === this.deps.getState().mode ? model : this.deps.getState().selectedModel,
      pluginLanguageMode: this.pluginLanguageMode,
      pluginLanguage: this.resolvePluginLanguage(),
    })
    this.deps.post()
  }

  setMode(mode: ChatMode) {
    this.deps.setState({
      ...this.deps.getState(),
      mode,
      selectedModel: this.selectModel(this.deps.getState().models, this.deps.getState().defaults ?? {}, mode),
      pluginLanguageMode: this.pluginLanguageMode,
      pluginLanguage: this.resolvePluginLanguage(),
    })
    this.deps.post()
  }

  async setModel(model: ModelSelection | undefined) {
    this.selectedModel = model
    await this.modelState.write(await this.deps.client(), { selected: this.selectedModel, model: this.modeModels })
    this.deps.setState({
      ...this.deps.getState(),
      selectedModel: model,
      defaultModel: model,
      modeModels: this.modeModels,
      pluginLanguageMode: this.pluginLanguageMode,
      pluginLanguage: this.resolvePluginLanguage(),
    })
    this.deps.post()
  }

  async setPluginLanguage(language: RaccoonPluginLanguageMode) {
    this.pluginLanguageMode = language
    await this.deps.storage?.update("raccoon.pluginLanguage", language === "auto" ? undefined : language)
    this.deps.setState({
      ...this.deps.getState(),
      pluginLanguageMode: language,
      pluginLanguage: this.resolvePluginLanguage(),
    })
    this.deps.post()
  }

  private resolvePluginLanguage() {
    if (this.pluginLanguageMode === "auto") return this.deps.pluginLanguage()
    return this.pluginLanguageMode
  }
}

function normalizePluginLanguageMode(value: string | undefined): RaccoonPluginLanguageMode {
  if (value === "auto" || value === "en" || value === "zh-Hans" || value === "zh-Hant") return value
  return "auto"
}

function authPrompts(fields: FormFields | undefined): RaccoonProviderAuthMethod["prompts"] {
  return fields?.flatMap((field): NonNullable<RaccoonProviderAuthMethod["prompts"]>[number][] => {
    if (field.type !== "string") return []
    const when = field.when?.find((entry) => typeof entry.value === "string")
    const common = {
      key: field.key,
      message: field.title ?? field.key,
      ...(when && typeof when.value === "string" ? { when: { key: when.key, op: when.op, value: when.value } } : {}),
    }
    if (field.hidden || field.secret) return [{ type: "password", ...common, placeholder: field.placeholder }]
    if (field.options?.length) return [{ type: "select", ...common, options: field.options.map((option) => ({ label: option.label, value: option.value, hint: option.description })) }]
    return [{ type: "text", ...common, placeholder: field.placeholder }]
  })
}

async function waitForOAuth(client: OpenCodeClient, integrationID: string, attemptID: string, location: { directory: string }, signal: AbortSignal) {
  while (!signal.aborted) {
    const response = await client.integration.oauth.status({ integrationID, attemptID, location }, { signal })
    if (response.data.status === "complete") return
    if (response.data.status === "failed") throw new Error(response.data.message)
    if (response.data.status === "expired") throw new Error("Authorization expired")
    await new Promise<void>((resolve, reject) => {
      const done = () => { signal.removeEventListener("abort", cancelled); resolve() }
      const cancelled = () => { clearTimeout(timer); reject(signal.reason) }
      const timer = setTimeout(done, 500)
      signal.addEventListener("abort", cancelled, { once: true })
    })
  }
  throw signal.reason
}

function customProviderPackage(value: unknown): "@ai-sdk/openai" | "@ai-sdk/anthropic" | "@ai-sdk/openai-compatible" {
  if (value === "@ai-sdk/openai" || value === "@ai-sdk/anthropic" || value === "@ai-sdk/openai-compatible") return value
  return "@ai-sdk/openai-compatible" as const
}

function cleanHeaders(value: Record<string, unknown> | undefined) {
  const headers = Object.fromEntries(
    Object.entries(value ?? {})
      .map(([key, headerValue]) => [key.trim(), typeof headerValue === "string" ? headerValue.trim() : ""] as const)
      .filter(([key, headerValue]) => key && headerValue),
  )
  if (Object.keys(headers).length === 0) return undefined
  return headers
}

function collectAgentOverrides(
  ...sources: (Record<string, OpencodeAgentConfig | undefined> | undefined)[]
): Record<string, RaccoonPermissionConfig> {
  const overrides: Record<string, RaccoonPermissionConfig> = {}
  for (const source of sources) {
    if (!source) continue
    for (const [name, config] of Object.entries(source)) {
      if (config?.permissions) {
        const permissions: RaccoonPermissionConfig = {}
        for (const rule of config.permissions) {
          const action = permissionDisplayAction(rule.action)
          const previous = permissions[action]
          if (rule.resource === "*") {
            if (typeof previous !== "object") permissions[action] = rule.effect
            continue
          }
          permissions[action] = { ...(typeof previous === "object" ? previous : {}), [rule.resource]: rule.effect }
        }
        overrides[name] = permissions
      }
    }
  }
  return overrides
}

// Set, replace, or delete an agent in a JSON config file. Move legacy
// `agent[name]` entries into the native `agents[name]` shape on write.
// A parse error on existing content is surfaced instead of clobbering the file.
async function writeAgentToFile(file: string, name: string, value: OpencodeAgentConfig | undefined) {
  let raw: string | undefined
  try {
    raw = await fs.readFile(file, "utf8")
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err
  }
  if (value === undefined && !raw) return false
  const source = raw?.trim() ? raw : "{}"
  const config = parseConfig(source, file)
  const exists = Object.hasOwn(asRecord(config.agents) ?? {}, name) || Object.hasOwn(asRecord(config.agent) ?? {}, name)
  if (value === undefined && !exists) return false
  const paths = [
    ...(value === undefined ? [] : [["agents", name]]),
    ...(Object.hasOwn(asRecord(config.agent) ?? {}, name) ? [["agent", name]] : []),
    ...(value === undefined && Object.hasOwn(asRecord(config.agents) ?? {}, name) ? [["agents", name]] : []),
  ]
  const updated = paths.reduce((text, path) => applyEdits(text, modify(text, path, path[0] === "agents" ? value : undefined, {
    formattingOptions: { insertSpaces: true, tabSize: 2 },
  })), source)
  await fs.mkdir(nodePath.dirname(file), { recursive: true })
  await fs.writeFile(file, updated.endsWith("\n") ? updated : `${updated}\n`)
  return true
}

// Set, replace, or delete a provider in a JSON config file. Move legacy
// `provider[id]` entries into the native `providers[id]` shape on write.
// A parse error on existing content is surfaced instead of clobbering the file.
async function writeProviderToFile(file: string, id: string, value: unknown | undefined) {
  let raw: string | undefined
  try {
    raw = await fs.readFile(file, "utf8")
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err
  }
  if (value === undefined && !raw) return false
  const source = raw?.trim() ? raw : "{}"
  const config = parseConfig(source, file)
  const exists = Object.hasOwn(asRecord(config.providers) ?? {}, id) || Object.hasOwn(asRecord(config.provider) ?? {}, id)
  if (value === undefined && !exists) return false
  const paths = [
    ...(value === undefined ? [] : [["providers", id]]),
    ...(Object.hasOwn(asRecord(config.provider) ?? {}, id) ? [["provider", id]] : []),
    ...(value === undefined && Object.hasOwn(asRecord(config.providers) ?? {}, id) ? [["providers", id]] : []),
  ]
  const updated = paths.reduce((text, path) => applyEdits(text, modify(text, path, path[0] === "providers" ? value : undefined, {
    formattingOptions: { insertSpaces: true, tabSize: 2 },
  })), source)
  await fs.mkdir(nodePath.dirname(file), { recursive: true })
  await fs.writeFile(file, updated.endsWith("\n") ? updated : `${updated}\n`)
  return true
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

async function setProviderPolicy(file: string, id: string, effect: "allow" | "deny") {
  const raw = await fs.readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "{}"
    throw error
  })
  const source = raw.trim() ? raw : "{}"
  const config = parseConfig(source, file)
  const policies = asRecord(config.experimental)?.policies
  const current = Array.isArray(policies) ? policies.filter((rule) => {
    const entry = asRecord(rule)
    return entry?.action !== "provider.use" || entry.resource !== id
  }) : []
  const updated = applyEdits(source, modify(source, ["experimental", "policies"], [
    ...current,
    { action: "provider.use", resource: id, effect },
  ], { formattingOptions: { insertSpaces: true, tabSize: 2 } }))
  await fs.mkdir(nodePath.dirname(file), { recursive: true })
  await fs.writeFile(file, updated.endsWith("\n") ? updated : `${updated}\n`)
}

async function deleteAgentMarkdownFiles(dir: string, name: string) {
  const deleted = await Promise.all(
    ["agent", "agents"].map((folder) =>
      fs.unlink(nodePath.join(dir, folder, `${name}.md`)).then(
        () => true,
        (err) => {
          if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err
          return false
        },
      ),
    ),
  )
  return deleted.some(Boolean)
}

// Project agent markdown may live under either the raccoon or the legacy opencode
// config dir; delete from both so a removed agent leaves nothing behind.
async function deleteProjectAgentMarkdownFiles(directory: string, name: string) {
  const results = await Promise.all(
    [".raccoon", ".opencode"].map((dir) => deleteAgentMarkdownFiles(nodePath.join(directory, dir), name)),
  )
  return results.some(Boolean)
}

function parseConfig(raw: string, file: string) {
  const errors: ParseError[] = []
  const parsed = parseJsonc(raw, errors, { allowTrailingComma: true })
  if (errors.length > 0) {
    throw new Error(`Failed to parse config file ${file}`)
  }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>
  }
  return {}
}

async function collectProjectAgentNames(directory: string) {
  const names = new Set<string>()
  for (const dir of [directory, nodePath.join(directory, ".raccoon"), nodePath.join(directory, ".opencode")]) {
    const file = await pickConfigFile(dir, PROJECT_CONFIG_FILES)
    const config = await readConfigFile(file)
    for (const name of Object.keys(config.agent ?? {})) names.add(name)
    for (const name of Object.keys(config.agents ?? {})) names.add(name)
  }
  for (const dir of [".raccoon", ".opencode"]) {
    for (const name of await collectAgentMarkdownNames(nodePath.join(directory, dir))) names.add(name)
  }
  return names
}

async function readConfigFile(file: string) {
  try {
    return parseConfig(await fs.readFile(file, "utf8"), file) as { agent?: Record<string, unknown>; agents?: Record<string, unknown> }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {}
    throw err
  }
}

async function collectAgentMarkdownNames(dir: string) {
  const names = await Promise.all(
    ["agent", "agents"].map((folder) =>
      fs.readdir(nodePath.join(dir, folder), { withFileTypes: true }).then(
        (entries) =>
          entries
            .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
            .map((entry) => entry.name.slice(0, -3)),
        (err) => {
          if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err
          return []
        },
      ),
    ),
  )
  return names.flat()
}

function collectAgentScopes(
  global: Record<string, OpencodeAgentConfig | undefined> | undefined,
  project: Set<string>,
): Record<string, RaccoonAgentScope> {
  const scopes: Record<string, RaccoonAgentScope> = {}
  for (const name of Object.keys(global ?? {})) scopes[name] = "user"
  // Project entries win: that is the closest override and where edits land.
  for (const name of project) scopes[name] = "project"
  return scopes
}

function visibleAgents(
  agents: AgentInfo[],
  overrides: Record<string, RaccoonPermissionConfig> = {},
  scopes: Record<string, RaccoonAgentScope> = {},
) {
  return agents.map((agent) => ({
    name: agent.name,
    description: agent.description,
    mode: agent.mode,
    native: !scopes[agent.name],
    hidden: agent.hidden,
    temperature: typeof agent.request.body.temperature === "number" ? agent.request.body.temperature : undefined,
    topP: typeof agent.request.body.top_p === "number" ? agent.request.body.top_p : undefined,
    variant: agent.model?.variant,
    steps: agent.steps,
    color: agent.color,
    permission: agent.permissions.map((rule) => ({ permission: permissionDisplayAction(rule.action), pattern: rule.resource, action: rule.effect })),
    permissionConfig: overrides[agent.name],
    configScope: scopes[agent.name],
    model: agent.model ? { providerID: agent.model.providerID, modelID: agent.model.id } : undefined,
    prompt: agent.system,
    options: agent.request.body,
  }))
}

export type RaccoonAgentConfigUpdate = {
  name?: string
  description?: string
  mode?: "subagent" | "primary" | "all"
  model?: ModelSelection
  temperature?: number
  topP?: number
  variant?: string
  steps?: number
  prompt?: string
  permission?: RaccoonPermissionConfig
  hidden?: boolean
  disable?: boolean
}

function requireAgentName(value: string) {
  const name = value.trim()
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(name))
    throw new Error("Agent name must use letters, numbers, dashes, or underscores")
  return name
}

function agentConfigValue(agent: RaccoonAgentConfigUpdate): OpencodeAgentConfig {
  const body = {
    ...(agent.temperature !== undefined ? { temperature: agent.temperature } : {}),
    ...(agent.topP !== undefined ? { top_p: agent.topP } : {}),
  }
  const permissions = Object.entries(agent.permission ?? {}).flatMap(([action, entry]) =>
    typeof entry === "string"
      ? [{ action: permissionAction(action), resource: "*", effect: entry }]
      : Object.entries(entry).map(([resource, effect]) => ({ action: permissionAction(action), resource, effect })),
  )
  return {
    ...(agent.model ? { model: { providerID: agent.model.providerID, model: agent.model.modelID, ...(agent.variant ? { variant: agent.variant.trim() } : {}) } } : {}),
    ...(agent.description !== undefined ? { description: agent.description.trim() } : {}),
    ...(agent.mode ? { mode: agent.mode } : {}),
    ...(Object.keys(body).length ? { request: { body } } : {}),
    ...(agent.steps !== undefined ? { steps: agent.steps } : {}),
    ...(agent.prompt !== undefined ? { system: agent.prompt } : {}),
    ...(permissions.length ? { permissions } : {}),
    ...(agent.hidden !== undefined ? { hidden: agent.hidden } : {}),
    ...(agent.disable !== undefined ? { disabled: agent.disable } : {}),
  }
}

function permissionAction(action: string) {
  if (action === "write" || action === "patch") return "edit"
  if (action === "task") return "subagent"
  if (action === "bash") return "shell"
  return action
}

function permissionDisplayAction(action: string) {
  if (action === "shell") return "bash"
  if (action === "subagent") return "task"
  return action
}
