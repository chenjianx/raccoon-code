import type { SessionInfo, SessionMessageInfo } from "@opencode/client/promise"
import type { RaccoonMessagePart } from "@opencode-ai/raccoon-webview"
import { mapMessage } from "./mapping.js"

function fencedCode(text: string) {
  return `~~~\n${text.trim()}\n~~~`
}

function markdownPart(part: RaccoonMessagePart): string[] {
  if (part.type === "text") return part.text?.trim() ? [part.text.trim()] : []
  if (part.type === "reasoning") {
    if (!part.text?.trim()) return []
    return [`> Thinking\n>\n${part.text.trim().split("\n").map((line) => `> ${line}`).join("\n")}`]
  }
  if (part.type === "tool") {
    const lines = [`#### Tool: ${part.tool ?? "unknown"}`, `- Status: ${part.status ?? "unknown"}`]
    if (part.title) lines.push(`- Title: ${part.title}`)
    if (part.input && Object.keys(part.input).length > 0) lines.push(`\n**Input**\n${fencedCode(JSON.stringify(part.input, null, 2))}`)
    if (part.output?.trim()) lines.push(`\n**Output**\n${fencedCode(part.output)}`)
    if (part.error?.trim()) lines.push(`\n**Error**\n${fencedCode(part.error)}`)
    return lines
  }
  if (part.type === "file") return [`- File: ${part.filename ?? part.path ?? part.url ?? "attachment"}`]
  return []
}

export function exportMarkdown(data: { info: SessionInfo; messages: SessionMessageInfo[] }) {
  const lines = [
    `# ${data.info.title ?? "Untitled"}`,
    "",
    `- Session ID: ${data.info.id}`,
    `- Agent: ${data.info.agent ?? "default"}`,
    `- Created: ${new Date(data.info.time.created).toLocaleString()}`,
    `- Updated: ${new Date(data.info.time.updated).toLocaleString()}`,
    `- Directory: ${data.info.location.directory}`,
    `- Project ID: ${data.info.projectID}`,
  ]

  for (const message of data.messages) {
    const mapped = mapMessage(message)[0]
    if (!mapped) continue
    lines.push("", `## ${mapped.role === "user" ? "User" : mapped.role === "assistant" ? "Assistant" : "System"}`)
    lines.push(`- ID: ${message.id}`, `- Created: ${new Date(message.time.created).toLocaleString()}`)
    if (message.type === "assistant") {
      lines.push(`- Agent: ${message.agent}`, `- Model: ${message.model.providerID}/${message.model.id}`)
    }
    const body = mapped.parts.flatMap(markdownPart)
    if (body.length > 0) lines.push("", ...body)
  }

  return `${lines.join("\n").trim()}\n`
}
