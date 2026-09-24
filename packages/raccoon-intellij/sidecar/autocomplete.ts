import type { AutocompleteInput, AutocompleteOutcome, ConnectionPort, Disposable, HostPlatform } from "@opencode-ai/raccoon-core"
import type { SidecarToHost } from "./rpc.js"

export interface AutocompleteEngine {
  complete(input: AutocompleteInput, signal: AbortSignal): Promise<AutocompleteOutcome | undefined>
  accept(completion: string, filepath: string): void
  setModel(model: string): void
  resetBackoff(): void
}

export class SidecarAutocomplete {
  private active?: { requestID: string; controller: AbortController }
  private enabled = true
  private disposed = false
  private readonly listeners: Disposable[] = []

  constructor(
    private readonly engine: AutocompleteEngine,
    private readonly send: (message: SidecarToHost) => void,
    lifecycle?: { connection: Pick<ConnectionPort, "onStateChange">; settings: HostPlatform["settings"] },
  ) {
    if (!lifecycle) return
    this.setEnabled(lifecycle.settings.getAutocompleteEnabled())
    this.listeners.push(
      lifecycle.settings.onAutocompleteEnabledChange((enabled) => {
        this.resetBackoff()
        this.setEnabled(enabled)
      }),
      lifecycle.settings.onAutocompleteModelChange((model) => {
        this.resetBackoff()
        this.setModel(model)
      }),
      { dispose: lifecycle.connection.onStateChange((state) => {
        if (state === "connected") this.resetBackoff()
      }) },
    )
  }

  complete(requestID: string, input: AutocompleteInput): void {
    if (this.disposed) return
    if (!this.enabled) {
      this.send({ type: "autocompleteResult", requestID })
      return
    }

    this.active?.controller.abort()
    const controller = new AbortController()
    this.active = { requestID, controller }
    void this.run(requestID, input, controller)
  }

  cancel(requestID: string): void {
    if (this.active?.requestID !== requestID) return
    this.active.controller.abort()
    this.active = undefined
  }

  accept(completion: string, filepath: string): void {
    this.engine.accept(completion, filepath)
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    if (enabled) return
    this.active?.controller.abort()
    this.active = undefined
  }

  setModel(model: string): void {
    this.engine.setModel(model)
  }

  resetBackoff(): void {
    this.engine.resetBackoff()
  }

  dispose(): void {
    this.disposed = true
    this.listeners.forEach((listener) => listener.dispose())
    this.active?.controller.abort()
    this.active = undefined
  }

  private async run(requestID: string, input: AutocompleteInput, controller: AbortController) {
    try {
      const outcome = await this.engine.complete(input, controller.signal)
      if (controller.signal.aborted) return
      if (this.active?.requestID !== requestID || this.active.controller !== controller) return
      this.send({
        type: "autocompleteResult",
        requestID,
        ...(outcome?.completion ? { completion: outcome.completion } : {}),
      })
    } finally {
      if (this.active?.requestID === requestID && this.active.controller === controller) this.active = undefined
    }
  }
}
