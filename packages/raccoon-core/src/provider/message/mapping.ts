import type { IntegrationInfo, ModelInfo, ProviderInfo, SessionInfo, SessionMessageInfo } from "@opencode/client/promise"
import type {
  RaccoonMessage,
  RaccoonMessagePart,
  RaccoonModel,
  RaccoonProviderInfo,
  RaccoonSession,
  RaccoonSubSession,
} from "@opencode-ai/raccoon-webview"
import { AUTOCOMPLETE_MODELS } from "../../services/autocomplete/models.js"
import { modelKey } from "../session/model-state.js"

const autocompleteModelIDs = new Set(AUTOCOMPLETE_MODELS.map((model) => model.id))

export function messageText(parts: RaccoonMessagePart[]) {
  return parts
    .filter((part) => part.type === "text" && !part.synthetic)
    .map((part) => part.text ?? "")
    .filter(Boolean)
    .join("\n\n")
}

export function responseText(parts: RaccoonMessagePart[]) {
  return parts
    .filter((part) => part.type === "text" && !part.synthetic)
    .map((part) => part.text ?? "")
    .join("\n")
    .trim()
}

export function sortMessages(messages: RaccoonMessage[]) {
  return [...messages].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
}

export function sortSessions(sessions: RaccoonSession[]) {
  return [...sessions].sort((a, b) => b.updatedAt - a.updatedAt || b.id.localeCompare(a.id))
}

export function sortParts(parts: RaccoonMessagePart[]) {
  return [...parts].sort((a, b) => a.id.localeCompare(b.id))
}

export function mapSession(session: SessionInfo): RaccoonSession {
  return {
    id: session.id,
    title: session.title ?? "Untitled",
    parentID: session.parentID,
    agent: session.agent,
    updatedAt: session.time.updated,
    revert: session.revert,
  }
}

export function mapMessage(message: SessionMessageInfo): RaccoonMessage[] {
  const base = { id: message.id, createdAt: message.time.created }
  if (message.type === "user") {
    const parts: RaccoonMessagePart[] = [
      { id: `${message.id}:text`, type: "text", text: message.text },
      ...(message.files ?? []).map((file, index) => ({
        id: `${message.id}:file:${index}`,
        type: "file" as const,
        mime: file.mime,
        filename: file.name,
        url: file.source.type === "uri" ? file.source.uri : `data:${file.mime};base64,${file.data}`,
      })),
    ]
    return [{ ...base, role: "user", parts, text: message.text }]
  }
  if (message.type === "assistant") {
    const parts: RaccoonMessagePart[] = message.content.map((item, index) => {
      if (item.type === "text" || item.type === "reasoning") {
        return { id: `${message.id}:${index}`, type: item.type, text: item.text }
      }
      const input = item.state.status === "streaming" ? {} : item.state.input
      const content = "content" in item.state ? item.state.content : undefined
      return {
        id: item.id,
        type: "tool",
        tool: item.name,
        status: item.state.status,
        title: "metadata" in item.state && typeof item.state.metadata?.title === "string" ? item.state.metadata.title : undefined,
        input,
        output: content?.filter((value) => value.type === "text").map((value) => value.text).join("\n"),
        error: item.state.status === "error" ? item.state.error.message : undefined,
        metadata: "metadata" in item.state ? item.state.metadata : undefined,
      }
    })
    return [{ ...base, role: "assistant", parts, text: messageText(parts), tokens: message.tokens, cost: message.cost }]
  }
  if (message.type === "system" || message.type === "synthetic") {
    return [{ ...base, role: "system", parts: [{ id: `${message.id}:text`, type: "text", text: message.text }], text: message.text }]
  }
  return []
}

// Derive a compact progress view of a subagent (task) child session from its raw
// messages, so the webview can render its tool activity, count, and duration without
// holding the full child-session message tree. Mirrors the TUI Task component logic.
export function mapSubSession(
  sessionID: string,
  messages: SessionMessageInfo[],
  status: string,
): RaccoonSubSession {
  const sorted = [...messages].sort(
    (a, b) => a.time.created - b.time.created || a.id.localeCompare(b.id),
  )
  const tools: RaccoonSubSession["tools"] = []
  for (const message of sorted) {
    if (message.type !== "assistant") continue
    for (const part of message.content) {
      if (part.type !== "tool") continue
      const sessionID = "metadata" in part.state && typeof part.state.metadata?.sessionId === "string" ? part.state.metadata.sessionId : undefined
      tools.push({
        id: part.id,
        tool: part.name,
        sessionID: part.name === "task" ? sessionID : undefined,
        status: part.state.status,
        title: "metadata" in part.state && typeof part.state.metadata?.title === "string" ? part.state.metadata.title : undefined,
      })
    }
  }
  const startedAt = sorted.find((message) => message.type === "user")?.time.created
  const completedAt = [...sorted]
    .reverse()
    .map((message) => (message.type === "assistant" ? message.time.completed : undefined))
    .find((value): value is number => typeof value === "number")
  return {
    sessionID,
    status,
    tools,
    toolcalls: tools.length,
    startedAt,
    completedAt,
  }
}

function providerConnected(provider: ProviderInfo, integrations: IntegrationInfo[]) {
  if (provider.activation === "disabled") return false
  if (!provider.integrationID) return true
  return integrations.some((item) => item.id === provider.integrationID && item.connections.some((connection) => !connection.status))
}

export function mapProviderModels(models: ModelInfo[], providers: ProviderInfo[], integrations: IntegrationInfo[], disabledModels: Set<string>): RaccoonModel[] {
  const byID = new Map(providers.map((provider) => [provider.id, provider]))
  return models
    .filter((model) => !autocompleteModelIDs.has(model.modelID) && byID.has(model.providerID))
    .map((model) => ({
      providerID: model.providerID,
      providerName: byID.get(model.providerID)!.name,
      modelID: model.modelID,
      modelName: model.name.replace("(latest)", "").trim(),
      connected: providerConnected(byID.get(model.providerID)!, integrations),
      enabled: model.enabled && !disabledModels.has(modelKey({ providerID: model.providerID, modelID: model.modelID })),
      contextLimit: model.limit?.context && model.limit.context > 0 ? model.limit.context : undefined,
      variants: model.variants.map((variant) => variant.id),
    }))
    .sort((a, b) => a.modelName.localeCompare(b.modelName))
}

export function mapProviders(providers: ProviderInfo[], integrations: IntegrationInfo[], models: RaccoonModel[]): RaccoonProviderInfo[] {
  return providers
    .map((provider) => {
      const items = models.filter((model) => model.providerID === provider.id)
      return {
        id: provider.id,
        name: provider.name,
        connected: providerConnected(provider, integrations),
        modelCount: items.length,
        enabledModelCount: items.filter((model) => model.enabled).length,
      }
    })
    .sort((a, b) => Number(b.connected) - Number(a.connected) || a.name.localeCompare(b.name))
}

export function recountProviders(providers: RaccoonProviderInfo[], models: RaccoonModel[]) {
  return providers.map((provider) => ({
    ...provider,
    modelCount: models.filter((model) => model.providerID === provider.id).length,
    enabledModelCount: models.filter((model) => model.providerID === provider.id && model.enabled).length,
  }))
}
