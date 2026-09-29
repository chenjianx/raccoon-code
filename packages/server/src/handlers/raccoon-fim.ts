import { Integration } from "@opencode/core/integration"
import { RaccoonConnection } from "@opencode/core/raccoon/auth/connection"
import { Effect, Stream } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"

type FimChunk = { type: "delta"; text: string } | { type: "done" } | { type: "error"; message: string }

const STANDARD_MODELS = new Set([
  "raccoon-chat",
  "raccoon-completion",
  "raccoon-pro-chat",
  "raccoon-pro-completion",
])

export function makeGatewayRequest(
  connection: { baseURL: string; access: string; orgCode?: string },
  payload: { prefix: string; suffix?: string; model?: string; language?: string; maxTokens?: number; temperature?: number },
  signal: AbortSignal,
) {
  return new Request(`${connection.baseURL}${RaccoonConnection.gatewayPath(connection.orgCode, "completions")}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${connection.access}`,
      ...(connection.orgCode ? { "x-org-code": connection.orgCode } : {}),
    },
    body: JSON.stringify({
      model: payload.model && !STANDARD_MODELS.has(payload.model) ? payload.model : undefined,
      input: {
        language_id: payload.language ?? "unknown",
        prefix: payload.prefix,
        suffix: payload.suffix ?? "",
      },
      n: 1,
      stream: true,
      stop: "<EOT>",
      temperature: payload.temperature ?? 0.01,
      max_new_tokens: Math.min(payload.maxTokens ?? 1024, 1024),
    }),
    signal,
  })
}

export const RaccoonFimHandler = HttpApiBuilder.group(Api, "server.fim", (handlers) =>
  handlers.handle(
    "fim.complete",
    Effect.fn("server.fim.complete")(function* (ctx) {
      const integration = yield* Integration.Service
      const connection = yield* RaccoonConnection.resolve(integration).pipe(
        Effect.catch((error) => Effect.succeed({ error: error.message } as const)),
      )
      if (connection && "error" in connection)
        return Stream.make({ type: "error", message: connection.error } as const)
      if (!connection)
        return Stream.make({ type: "error", message: "raccoon provider not configured" } as const)

      const payload = ctx.payload
      return Stream.fromAsyncIterable(
        (async function* (): AsyncGenerator<FimChunk> {
          const controller = new AbortController()
          try {
            const response = await fetch(makeGatewayRequest(connection, payload, controller.signal))
            yield* readUpstream(response)
          } catch (error) {
            yield { type: "error", message: error instanceof Error ? error.message : String(error) }
          } finally {
            controller.abort()
          }
        })(),
        (error) => (error instanceof Error ? error.message : String(error)),
      ).pipe(Stream.catch((message) => Stream.make({ type: "error", message } as const)))
    }),
  ),
)

export async function* readUpstream(response: Response): AsyncGenerator<FimChunk> {
  if (!response.ok) {
    yield { type: "error", message: `upstream: ${response.status}` }
    return
  }
  if (!response.body) {
    yield { type: "done" }
    return
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  try {
    while (true) {
      const next = await reader.read()
      buffer += decoder.decode(next.value, { stream: !next.done })
      buffer = buffer.replaceAll("\r\n", "\n")
      if (next.done && buffer) buffer += "\n\n"

      let boundary = buffer.indexOf("\n\n")
      while (boundary >= 0) {
        const frame = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        for (const line of frame.split("\n")) {
          if (!line.startsWith("data:")) continue
          for (const chunk of parseUpstreamFrame(line.slice(5).trimStart())) {
            yield chunk
            if (chunk.type === "error" || chunk.type === "done") return
          }
        }
        boundary = buffer.indexOf("\n\n")
      }
      if (next.done) break
    }
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
  yield { type: "done" }
}

function parseUpstreamFrame(raw: string): FimChunk[] {
  if (raw === "[DONE]") return [{ type: "done" }]
  const parsed: unknown = (() => {
    try {
      return JSON.parse(raw)
    } catch {
      return undefined
    }
  })()
  if (!isRecord(parsed)) return []
  const payload = isRecord(parsed.data) ? parsed.data : parsed
  if (payload.is_heartbeat) return []
  if (isRecord(payload.status) && typeof payload.status.code === "number" && payload.status.code !== 0)
    return [{
      type: "error",
      message: typeof payload.status.message === "string" ? payload.status.message : `upstream status ${payload.status.code}`,
    }]
  const choice = Array.isArray(payload.choices) ? payload.choices[0] : undefined
  if (!isRecord(choice)) return []
  const delta = isRecord(choice.delta) ? choice.delta.content : choice.delta
  const text = typeof delta === "string" ? delta : typeof choice.text === "string" ? choice.text : undefined
  if (choice.finish_reason) return text ? [{ type: "delta", text }, { type: "done" }] : [{ type: "done" }]
  return text ? [{ type: "delta", text }] : []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
