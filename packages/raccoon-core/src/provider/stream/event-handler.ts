import type { OpenCodeEvent } from "@opencode/client/promise"
import type { ExtensionToWebview, RaccoonState } from "@opencode-ai/raccoon-webview"

type EventHandlerDeps = {
  directory: () => string
  getState: () => RaccoonState
  setState: (state: RaccoonState) => void
  post: () => void
  removeSession: (sessionID: string) => void
  scheduleSessionRefresh: () => void
  scheduleEventRefresh: () => void
  scheduleSubAgentRefresh: (sessionID: string) => void
  isTrackedSubAgent: (sessionID: string) => boolean
  completeTrackedSubAgent: (sessionID: string) => void
  postSubAgentEvent: (sessionID: string, message: ExtensionToWebview) => void
  pushPartDelta: (sessionID: string, messageID: string, partID: string, field: string, delta: string) => void
  pushSubAgentPartDelta: (sessionID: string, messageID: string, partID: string, field: string, delta: string) => void
  flushStreams: () => void
  clearPromptRefresh: (sessionID: string) => void
  recoverPendingQuestions: (sessionID: string) => Promise<void>
  refreshMcpInstalled: () => void
  postMessage: (message: ExtensionToWebview) => void
  onReauthRequired: () => void
}

const RACCOON_REAUTH_REQUIRED = "RACCOON_REAUTH_REQUIRED"

export class RaccoonEventHandler {
  constructor(private readonly deps: EventHandlerDeps) {}

  handleGlobal(event: OpenCodeEvent) {
    if (event.type === "server.connected") return
    if (event.location?.directory && event.location.directory !== this.deps.directory()) return

    if (event.type === "session.created" || event.type === "session.renamed") {
      this.deps.scheduleSessionRefresh()
      return
    }
    if (event.type === "session.deleted") {
      this.deps.removeSession(event.data.sessionID)
      this.deps.scheduleSessionRefresh()
      this.deps.post()
      return
    }
    if (event.type === "mcp.status.changed" || event.type === "mcp.resources.changed") {
      this.deps.refreshMcpInstalled()
      return
    }
    if (event.type === "integration.updated" || event.type === "provider.updated" || event.type === "model.updated" || event.type === "credential.updated") {
      this.deps.scheduleEventRefresh()
      return
    }
    if (event.type === "form.created") {
      void this.deps.recoverPendingQuestions(event.data.form.sessionID)
      return
    }
    if (event.type === "form.replied" || event.type === "form.cancelled") {
      this.deps.postMessage({ type: "questionResolved", requestID: event.data.id })
      this.deps.scheduleEventRefresh()
      return
    }
    if (event.type === "permission.asked") {
      const permission = event.data
      this.deps.postMessage({
        type: "permissionRequest",
        permission: {
          id: permission.id,
          sessionID: permission.sessionID,
          permission: permission.action,
          patterns: permission.resources,
          metadata: permission.metadata ?? {},
          always: permission.save ?? [],
          tool: permission.source?.type === "tool"
            ? { messageID: permission.source.messageID, callID: permission.source.id }
            : undefined,
        },
      })
      this.setBusy(permission.sessionID, true)
      return
    }
    if (event.type === "permission.replied") {
      this.deps.postMessage({ type: "permissionResolved", requestID: event.data.requestID })
      this.deps.scheduleEventRefresh()
      return
    }

    if (!("data" in event) || !("sessionID" in event.data) || typeof event.data.sessionID !== "string") return
    const sessionID = event.data.sessionID
    const active = sessionID === this.deps.getState().activeSessionID
    if (!active && !this.deps.isTrackedSubAgent(sessionID)) return

    if (event.type === "session.text.delta" || event.type === "session.reasoning.delta") {
      const field = event.type === "session.text.delta" ? "text" : "reasoning"
      const partID = `${event.data.assistantMessageID}:${event.data.ordinal}`
      if (active) this.deps.pushPartDelta(sessionID, event.data.assistantMessageID, partID, field, event.data.delta)
      else this.deps.pushSubAgentPartDelta(sessionID, event.data.assistantMessageID, partID, field, event.data.delta)
      this.setBusy(sessionID, true)
      return
    }
    if (event.type === "session.execution.started") {
      this.setBusy(sessionID, true)
      this.deps.scheduleEventRefresh()
      return
    }
    if (
      event.type === "session.execution.succeeded" ||
      event.type === "session.execution.failed" ||
      event.type === "session.execution.interrupted"
    ) {
      if (event.type === "session.execution.failed" && event.data.error.message.includes(RACCOON_REAUTH_REQUIRED)) {
        this.deps.onReauthRequired()
      }
      this.deps.flushStreams()
      this.deps.clearPromptRefresh(sessionID)
      this.setBusy(sessionID, false)
      if (!active) this.deps.completeTrackedSubAgent(sessionID)
      this.deps.scheduleEventRefresh()
      return
    }
    if (event.type === "session.status") {
      const busy = event.data.status.type !== "idle"
      if (!busy) this.deps.clearPromptRefresh(sessionID)
      this.setBusy(sessionID, busy)
      if (!busy) this.deps.scheduleEventRefresh()
      return
    }
    if (active) this.deps.scheduleEventRefresh()
    else this.deps.scheduleSubAgentRefresh(sessionID)
  }

  private setBusy(sessionID: string, busy: boolean) {
    if (sessionID !== this.deps.getState().activeSessionID) {
      this.deps.postSubAgentEvent(sessionID, { type: "subAgentBusyChanged", sessionID, busy })
      if (!busy) this.deps.scheduleSubAgentRefresh(sessionID)
      return
    }
    this.deps.setState({ ...this.deps.getState(), loading: busy, busy })
    this.deps.post()
  }
}
