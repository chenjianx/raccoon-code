import { EventEmitter } from "node:events"
import * as fs from "node:fs/promises"
import { readFileSync } from "node:fs"
import * as path from "node:path"
import {
  formatTerminalOutput,
  getAutocompleteModel,
  gitChangesContext,
  type Disposable,
  type DocumentRangeRef,
  type EditorContext,
  type Emitter,
  type FileSearchResult,
  type HostPlatform,
  type KeyValueStore,
} from "@opencode-ai/raccoon-core"

// HostPlatform for the IntelliJ sidecar. Editor/file-search surfaces that require the live
// IDE are stubbed for the chat MVP; file links are routed to the Kotlin host.
export class SidecarPlatform implements HostPlatform {
  readonly env: HostPlatform["env"]
  readonly workspace: HostPlatform["workspace"]
  readonly settings: HostPlatform["settings"]
  readonly storage: KeyValueStore
  readonly fs: HostPlatform["fs"]
  readonly ui: HostPlatform["ui"]
  readonly editor: HostPlatform["editor"]

  private autocompleteEnabled: boolean
  private autocompleteModel: string
  private readonly autocompleteEmitter = new EventEmitter()
  private readonly autocompleteModelEmitter = new EventEmitter()

  constructor(opts: {
    directory: string
    locale: string
    autocompleteEnabled: boolean
    autocompleteModel: string
    storageDir: string
    log: (message: string) => void
    onAutocompleteSettingsChange: (settings: { enabled: boolean; model: string }) => void
    requestTerminalContext?: () => Promise<{ name: string; output: string } | undefined>
    openFile?: (filePath: string, directory: string, line?: number, column?: number) => void
  }) {
    this.autocompleteEnabled = opts.autocompleteEnabled
    this.autocompleteModel = getAutocompleteModel(opts.autocompleteModel).id
    const storageFile = path.join(opts.storageDir, "raccoon-state.json")

    this.env = { locale: () => opts.locale }
    this.workspace = { directory: () => opts.directory }
    this.settings = {
      getAutocompleteEnabled: () => this.autocompleteEnabled,
      setAutocompleteEnabled: async (enabled: boolean) => {
        if (enabled === this.autocompleteEnabled) return
        this.autocompleteEnabled = enabled
        this.autocompleteEmitter.emit("change", enabled)
        opts.onAutocompleteSettingsChange({ enabled, model: this.autocompleteModel })
      },
      onAutocompleteEnabledChange: (listener) => {
        this.autocompleteEmitter.on("change", listener)
        return { dispose: () => this.autocompleteEmitter.off("change", listener) }
      },
      getAutocompleteModel: () => this.autocompleteModel,
      setAutocompleteModel: async (model: string) => {
        const normalized = getAutocompleteModel(model).id
        if (normalized === this.autocompleteModel) return
        this.autocompleteModel = normalized
        this.autocompleteModelEmitter.emit("change", normalized)
        opts.onAutocompleteSettingsChange({ enabled: this.autocompleteEnabled, model: normalized })
      },
      onAutocompleteModelChange: (listener) => {
        this.autocompleteModelEmitter.on("change", listener)
        return { dispose: () => this.autocompleteModelEmitter.off("change", listener) }
      },
    }
    this.storage = new FileKeyValueStore(storageFile, opts.log)
    this.fs = {
      writeTempFile: async (relativeParts: string[], data: Uint8Array) => {
        const target = path.join(opts.storageDir, "tmp", ...relativeParts)
        await fs.mkdir(path.dirname(target), { recursive: true })
        await fs.writeFile(target, data)
        return target
      },
    }
    this.ui = {
      // Other host-driven UI flows remain best-effort no-ops in the chat MVP.
      revealChat: async () => {},
      openFile: (filePath, directory, line, column) => opts.openFile?.(filePath, directory, line, column),
      openPath: async () => {},
      openExternal: async (url: string) => opts.log(`openExternal (unhandled in MVP): ${url}`),
      promptInput: async () => undefined,
      saveFile: async () => false,
      showInfo: (message: string) => opts.log(message),
      log: opts.log,
    }
    this.editor = {
      getActiveContext: (): EditorContext | undefined => undefined,
      getRangeContext: async (_ref: DocumentRangeRef): Promise<EditorContext | undefined> => undefined,
      searchFiles: async (): Promise<FileSearchResult> => ({ workspaceDir: opts.directory, items: [] }),
      terminalContext: async () => {
        const captured = await opts.requestTerminalContext?.()
        if (!captured) return "No active terminal is available."
        return formatTerminalOutput(captured.name, captured.output, "")
      },
      gitChangesContext,
    }
  }

  createEmitter<T>(): Emitter<T> {
    const emitter = new EventEmitter()
    return {
      event: (listener: (value: T) => void): Disposable => {
        emitter.on("fire", listener)
        return { dispose: () => emitter.off("fire", listener) }
      },
      fire: (value: T) => emitter.emit("fire", value),
      dispose: () => emitter.removeAllListeners(),
    }
  }
}

// KeyValueStore backed by a JSON file, mirroring vscode.Memento semantics closely enough
// for the orchestrator's persisted state (selected model, language mode, etc.).
class FileKeyValueStore implements KeyValueStore {
  private cache: Record<string, unknown>

  constructor(
    private readonly file: string,
    private readonly log: (message: string) => void,
  ) {
    this.cache = readJsonSync(file)
  }

  get<T>(key: string): T | undefined
  get<T>(key: string, defaultValue: T): T
  get<T>(key: string, defaultValue?: T): T | undefined {
    const value = this.cache[key]
    return (value === undefined ? defaultValue : value) as T | undefined
  }

  async update(key: string, value: unknown): Promise<void> {
    if (value === undefined) delete this.cache[key]
    else this.cache[key] = value
    try {
      await fs.mkdir(path.dirname(this.file), { recursive: true })
      await fs.writeFile(this.file, JSON.stringify(this.cache, null, 2))
    } catch (error) {
      this.log(`failed to persist state: ${String(error)}`)
    }
  }
}

function readJsonSync(file: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>
  } catch {
    return {}
  }
}
