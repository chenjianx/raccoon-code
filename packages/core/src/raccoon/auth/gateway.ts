// raccoon_change start - adapt OpenAI-compatible requests and SSE to the Raccoon gateway
import { RaccoonConnection } from "./connection.js"

const standardModels = new Set(["raccoon-chat", "raccoon-completion", "raccoon-pro-chat", "raccoon-pro-completion"])

type Body = {
  model?: string
  max_tokens?: number
  max_new_tokens?: number
  messages?: Array<{ role?: string; content?: unknown }>
}

export namespace RaccoonGateway {
  export async function send(
    connection: { baseURL: string; access: string; orgCode?: string },
    input: string | URL | Request,
    init?: RequestInit,
    fetcher: typeof fetch = fetch,
  ) {
    const headers = new Headers(init?.headers)
    headers.set("authorization", `Bearer ${connection.access}`)
    if (connection.orgCode) headers.set("x-org-code", connection.orgCode)
    const request = rewrite(connection.baseURL, connection.orgCode, input, { ...init, headers })
    return normalize(await fetcher(request.url, request.init))
  }

  export function rewrite(baseURL: string, orgCode: string | undefined, input: string | URL | Request, init: RequestInit = {}) {
    const url = new URL(input instanceof URL ? input.href : typeof input === "string" ? input : input.url)
    const endpoint = url.pathname.endsWith("/chat/completions") || url.pathname.endsWith("/chat-completions")
      ? "chat-completions"
      : url.pathname.endsWith("/completions")
        ? "completions"
        : undefined
    if (endpoint) {
      const root = new URL(baseURL)
      url.protocol = root.protocol
      url.hostname = root.hostname
      url.port = root.port
      url.pathname = RaccoonConnection.gatewayPath(orgCode, endpoint)
    }
    const body = typeof init.body === "string" ? (JSON.parse(init.body) as Body) : undefined
    return {
      url: url.href,
      init: body
        ? {
            ...init,
            body: JSON.stringify({
              ...body,
              messages: body.messages?.map((message) => ({
                ...message,
                content: Array.isArray(message.content)
                  ? message.content
                      .map((part) => (part && typeof part === "object" && "text" in part ? String(part.text) : ""))
                      .filter(Boolean)
                      .join("\n")
                  : message.content,
              })),
              model: body.model && standardModels.has(body.model) ? undefined : body.model,
              max_new_tokens: body.max_new_tokens ?? body.max_tokens,
            }),
          }
        : init,
    }
  }

  export function normalize(response: Response) {
    if (!response.body || !response.headers.get("content-type")?.includes("text/event-stream")) return response
    const decoder = new TextDecoder()
    const encoder = new TextEncoder()
    let pending = ""
    const stream = response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          const lines = (pending + decoder.decode(chunk, { stream: true })).split(/\r?\n/)
          pending = lines.pop() ?? ""
          const result = lines.map(normalizeLine).filter((line): line is string => line !== undefined).join("\n")
          if (result) controller.enqueue(encoder.encode(`${result}\n`))
        },
        flush(controller) {
          const result = normalizeLine(pending + decoder.decode())
          if (result) controller.enqueue(encoder.encode(result))
        },
      }),
    )
    return new Response(stream, { status: response.status, statusText: response.statusText, headers: response.headers })
  }
}

function normalizeLine(line: string) {
  if (!line.startsWith("data:")) return line
  const data = line.slice(5).trimStart()
  if (!data || data === "[DONE]") return line
  try {
    const value = JSON.parse(data) as {
      is_heartbeat?: boolean
      data?: Record<string, unknown>
      choices?: unknown
      status?: { code?: number; message?: string }
    }
    if (value.is_heartbeat) return undefined
    const body = (value.data ?? value) as {
      choices?: Array<{
        role?: string
        delta?:
          | string
          | { role?: string; content?: string; tool_calls?: Array<{ function?: { name?: string; arguments?: string } }> }
        finish_reason?: string | null
      }> | null
      status?: { code?: number; message?: string }
    }
    if (body.status?.code && body.status.code !== 0)
      return `data: ${JSON.stringify({ error: { message: body.status.message ?? "Raccoon engine error", type: "raccoon_error", code: body.status.code } })}`
    body.choices ??= []
    for (const choice of body.choices) {
      if (typeof choice.delta === "string") {
        choice.delta = { ...(choice.role ? { role: choice.role } : {}), content: choice.delta }
        delete choice.role
      }
      if (choice.delta?.role === "") delete choice.delta.role
      if (choice.finish_reason === "") choice.finish_reason = null
      for (const call of choice.delta?.tool_calls ?? []) {
        if (call.function?.name !== "bash" || !call.function.arguments) continue
        const args = JSON.parse(call.function.arguments) as { command?: string; description?: string }
        if (args.command && !args.description)
          call.function.arguments = JSON.stringify({ ...args, description: args.command.split(/\s+/).slice(0, 6).join(" ") })
      }
    }
    return `data: ${JSON.stringify(body)}`
  } catch {
    return line
  }
}
// raccoon_change end
