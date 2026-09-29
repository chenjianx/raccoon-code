import type { SessionInfo, SessionMessageInfo } from "@opencode/client/promise"
import type { RaccoonContextBreakdownKey, RaccoonContextInspectorSnapshot } from "@opencode-ai/raccoon-webview"

const estimateTokens = (characters: number) => Math.ceil(characters / 4)

export function contextInspectorSnapshot(
  session: SessionInfo,
  messages: SessionMessageInfo[],
  truncated: boolean,
): RaccoonContextInspectorSnapshot {
  const sorted = [...messages].sort((a, b) => a.time.created - b.time.created || a.id.localeCompare(b.id))
  const visible = sorted.filter((message) => !session.revert?.messageID || message.id < session.revert.messageID)
  const systemPrompt = [...visible].reverse().find((message) => message.type === "system")?.text.trim()
  const assistant = [...visible]
    .reverse()
    .find((message) => message.type === "assistant" && message.tokens && tokenTotal(message.tokens) > 0)
  const input = assistant?.type === "assistant" ? assistant.tokens?.input ?? 0 : 0

  return {
    session: {
      id: session.id,
      title: session.title ?? "Untitled",
      createdAt: session.time.created,
      updatedAt: session.time.updated,
      cost: session.cost,
    },
    model: assistant?.type === "assistant"
      ? { providerID: assistant.model.providerID, modelID: assistant.model.id }
      : undefined,
    usage: assistant?.type === "assistant" ? assistant.tokens : undefined,
    breakdown: estimateBreakdown(visible, input, systemPrompt),
    systemPrompt,
    messages: sorted.map((message) => ({
      id: message.id,
      role: message.type,
      createdAt: message.time.created,
      raw: JSON.stringify(message, null, 2),
    })),
    truncated,
  }
}

function tokenTotal(tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }) {
  return tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
}

function estimateBreakdown(messages: SessionMessageInfo[], input: number, systemPrompt?: string) {
  if (!input) return []
  const characters = messages.reduce(
    (counts, message) => {
      if (message.type === "user") {
        return {
          ...counts,
          user: counts.user + message.text.length + (message.files ?? []).reduce((sum, file) => sum + Math.floor(file.data.length * 0.75), 0),
        }
      }
      if (message.type !== "assistant") return counts
      return message.content.reduce((sum, part) => {
        if (part.type === "text" || part.type === "reasoning")
          return { ...sum, assistant: sum.assistant + part.text.length }
        const state = part.state
        const input = state.status === "streaming" ? state.input.length : JSON.stringify(state.input).length
        const output = "content" in state
          ? state.content?.reduce((total, item) => total + (item.type === "text" ? item.text.length : 0), 0) ?? 0
          : 0
        return { ...sum, tool: sum.tool + input + output }
      }, counts)
    },
    { system: systemPrompt?.length ?? 0, user: 0, assistant: 0, tool: 0 },
  )
  const estimated = {
    system: estimateTokens(characters.system),
    user: estimateTokens(characters.user),
    assistant: estimateTokens(characters.assistant),
    tool: estimateTokens(characters.tool),
  }
  const total = estimated.system + estimated.user + estimated.assistant + estimated.tool
  if (total <= input) return buildBreakdown({ ...estimated, other: input - total }, input)

  const scale = input / total
  const scaled = {
    system: Math.floor(estimated.system * scale),
    user: Math.floor(estimated.user * scale),
    assistant: Math.floor(estimated.assistant * scale),
    tool: Math.floor(estimated.tool * scale),
  }
  return buildBreakdown(
    { ...scaled, other: input - scaled.system - scaled.user - scaled.assistant - scaled.tool },
    input,
  )
}

function buildBreakdown(
  tokens: Record<RaccoonContextBreakdownKey, number>,
  input: number,
): RaccoonContextInspectorSnapshot["breakdown"] {
  return (["system", "user", "assistant", "tool", "other"] as const)
    .map((key) => ({ key, tokens: tokens[key] }))
    .filter((segment) => segment.tokens > 0)
    .map((segment) => ({ ...segment, percent: Math.round((segment.tokens / input) * 1000) / 10 }))
}
