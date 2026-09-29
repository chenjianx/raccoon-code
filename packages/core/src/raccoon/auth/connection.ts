// raccoon_change start - resolve v2 Raccoon credentials and gateway routes
import { Effect } from "effect"
import type { IntegrationDomain } from "@opencode/plugin/effect/integration"
import { Integration } from "../../integration.js"

const defaultBaseURL = "https://xiaohuanxiong.com"

export namespace RaccoonConnection {
  export function baseURL(input?: string) {
    return (input?.trim() || process.env.RACCOON_API_URL || process.env.RACCOON_BASE_URL || defaultBaseURL).replace(
      /\/+$/,
      "",
    )
  }

  export function baseURLFromMetadata(metadata: Readonly<Record<string, unknown>> | undefined) {
    return baseURL(
      typeof metadata?.baseURL === "string"
        ? metadata.baseURL
        : typeof metadata?.enterpriseUrl === "string"
          ? metadata.enterpriseUrl
          : undefined,
    )
  }

  export function orgCode(user: { id?: string; orgs?: Array<{ id?: string; code?: string; name?: string }> } | undefined) {
    return user?.orgs?.[0]?.code
  }

  export function gatewayPath(code: string | undefined, endpoint: "completions" | "chat-completions") {
    return `/api/plugin/${code ? "org/" : ""}llm/v2/${endpoint}`
  }

  export const resolve = Effect.fn("RaccoonConnection.resolve")(function* (integration: Integration.Interface) {
    const connection = yield* integration.connection.active(Integration.ID.make("raccoon"))
    if (!connection) return undefined
    const credential = yield* integration.connection.resolve(connection)
    if (!credential || credential.type !== "oauth") return undefined
    return {
      baseURL: baseURLFromMetadata(credential.metadata),
      access: credential.access,
      orgCode: typeof credential.metadata?.orgCode === "string" ? credential.metadata.orgCode : undefined,
      connection,
    }
  })

  export const resolvePlugin = Effect.fn("RaccoonConnection.resolvePlugin")(function* (
    integration: IntegrationDomain,
  ) {
    const connection = yield* integration.connection.active("raccoon")
    if (!connection) return undefined
    const credential = yield* integration.connection.resolve(connection)
    if (!credential || credential.type !== "oauth") return undefined
    return {
      baseURL: baseURLFromMetadata(credential.metadata),
      access: credential.access,
      orgCode: typeof credential.metadata?.orgCode === "string" ? credential.metadata.orgCode : undefined,
      connection,
    }
  })
}
// raccoon_change end
