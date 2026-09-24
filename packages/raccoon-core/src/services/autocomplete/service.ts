import type { AutocompleteConnection } from "../../provider/platform.js"
import { CompletionProvider } from "./CompletionProvider.js"
import { ErrorBackoff } from "./ErrorBackoff.js"
import { RaccoonFimLlm } from "./llm/RaccoonFimLlm.js"
import { getAutocompleteModel } from "./models.js"
import {
  DEFAULT_AUTOCOMPLETE_OPTIONS,
  type AutocompleteInput,
  type AutocompleteOutcome,
} from "./util/types.js"

export type AutocompleteServiceHooks = {
  onActivity?: (active: boolean) => void
  onFatalError?: (status: number | null) => void
  log?: (message: string) => void
}

export class RaccoonAutocompleteService {
  private readonly completionProvider: CompletionProvider
  private readonly backoff = new ErrorBackoff()
  private model: string
  private fatalNotified = false

  constructor(
    private readonly connection: AutocompleteConnection,
    private readonly directory: string,
    model: string,
    private readonly hooks: AutocompleteServiceHooks = {},
  ) {
    this.model = getAutocompleteModel(model).id
    this.completionProvider = new CompletionProvider(
      () => this.buildLlm(),
      (error) => this.hooks.log?.(`[error] ${error instanceof Error ? error.message : String(error)}`),
      DEFAULT_AUTOCOMPLETE_OPTIONS,
      (message) => this.hooks.log?.(message),
    )
  }

  setModel(model: string): void {
    this.model = getAutocompleteModel(model).id
  }

  resetBackoff(): void {
    this.backoff.reset()
    this.fatalNotified = false
  }

  async complete(input: AutocompleteInput, signal: AbortSignal): Promise<AutocompleteOutcome | undefined> {
    if (signal.aborted) return undefined
    const connectionState = this.connection.getConnectionState()
    if (connectionState !== "connected") {
      this.hooks.log?.(`[skip] not connected (state=${connectionState})`)
      return undefined
    }
    if (this.backoff.blocked()) {
      this.hooks.log?.(`[skip] backoff blocked (fatalStatus=${this.backoff.getFatalStatus()})`)
      return undefined
    }

    this.hooks.onActivity?.(true)
    try {
      return await this.completionProvider.provideInlineCompletionItems(input, signal)
    } finally {
      this.hooks.onActivity?.(false)
    }
  }

  accept(completion: string, filepath: string): void {
    this.completionProvider.accept(completion, filepath)
  }

  private buildLlm(): RaccoonFimLlm {
    return new RaccoonFimLlm(this.connection, this.directory, this.model, {
      onSuccess: () => {
        this.backoff.success()
        this.fatalNotified = false
      },
      onFailure: (error) => {
        const kind = this.backoff.failure(error)
        this.hooks.log?.(`[fetch] failure (${kind})`)
        if (kind !== "fatal" || this.fatalNotified) return
        this.fatalNotified = true
        this.hooks.onFatalError?.(this.backoff.getFatalStatus())
      },
      log: (message) => this.hooks.log?.(message),
    })
  }
}
