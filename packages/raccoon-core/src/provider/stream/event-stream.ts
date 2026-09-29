import type { OpenCodeClient, OpenCodeEvent } from "@opencode/client/promise"

export class RaccoonEventStream {
  private abort?: AbortController
  private directory?: string
  private reconnectTimer?: ReturnType<typeof setTimeout>

  constructor(
    private readonly client: () => Promise<OpenCodeClient>,
    private readonly onEvent: (event: OpenCodeEvent) => void,
    private readonly log: (message: string) => void,
    private readonly onReconnect?: () => void,
  ) {}

  async ensure(directory: string) {
    if (this.abort && this.directory === directory) return
    await this.stop()
    this.directory = directory
    this.abort = new AbortController()
    void this.consume(this.abort)
  }

  async stop() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = undefined
    this.abort?.abort()
    this.abort = undefined
    this.directory = undefined
  }

  dispose() {
    void this.stop()
  }

  private async consume(abort: AbortController) {
    try {
      for await (const event of (await this.client()).event.subscribe({ signal: abort.signal })) {
        this.onEvent(event)
      }
    } catch (error) {
      if (!abort.signal.aborted) this.log(`event stream stopped: ${String(error)}`)
    } finally {
      if (!abort.signal.aborted && this.abort === abort) this.scheduleReconnect()
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || !this.directory) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined
      const directory = this.directory
      if (!directory) return
      this.abort = undefined
      void this.ensure(directory)
        .then(() => this.onReconnect?.())
        .catch((error) => this.log(`event stream reconnect failed: ${error instanceof Error ? error.message : String(error)}`))
    }, 250)
  }
}
