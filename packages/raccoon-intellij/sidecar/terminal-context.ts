import type { HostToSidecar, SidecarToHost } from "./rpc.js"
import { randomUUID } from "node:crypto"

export class TerminalContextRequests {
  private readonly pending = new Map<string, { timer: ReturnType<typeof setTimeout>; resolve: (value: { name: string; output: string } | undefined) => void }>()

  constructor(private readonly send: (message: Extract<SidecarToHost, { type: "captureTerminal" }>) => void) {}

  capture(): Promise<{ name: string; output: string } | undefined> {
    return new Promise((resolve) => {
      const requestID = randomUUID()
      const timer = setTimeout(() => {
        this.pending.delete(requestID)
        resolve(undefined)
      }, 5000)
      this.pending.set(requestID, { timer, resolve })
      this.send({ type: "captureTerminal", requestID })
    })
  }

  receive(message: Extract<HostToSidecar, { type: "terminalContextResult" }>): void {
    const pending = this.pending.get(message.requestID)
    if (!pending) return
    clearTimeout(pending.timer)
    this.pending.delete(message.requestID)
    pending.resolve(message.name === undefined || message.output === undefined ? undefined : { name: message.name, output: message.output })
  }

  dispose(): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.resolve(undefined)
    }
    this.pending.clear()
  }
}
