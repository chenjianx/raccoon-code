// raccoon_change start - convert authenticated Raccoon profiles into v2 catalog models
import { Model } from "../../model.js"
import { Provider } from "../../provider.js"
import { RaccoonConnection } from "./connection.js"

type Profile = {
  name?: string
  model?: string
  apiBase?: string
  roles?: string[]
  capabilities?: string[]
  defaultCompletionOptions?: { contextLength?: number; maxTokens?: number }
  orgScopeId?: string
}

type Profiles = { data?: { config?: { models?: Profile[] } } }
type Settings = { data?: { settings?: { capabilities?: string[] } } }

export namespace RaccoonModels {
  export function fromProfiles(baseURL: string, profiles: Profile[], orgCode?: string): Model.Info[] {
    return profiles.flatMap((profile) => {
      if (!profile.model || (profile.roles?.length && profile.roles.every((role) => role === "autocomplete"))) return []
      const context = profile.defaultCompletionOptions?.contextLength ?? 64_000
      const id = Model.ID.make(profile.model)
      return [
        {
          ...Model.Info.default(Provider.ID.make("raccoon"), id),
          name: profile.name ?? profile.model,
          package: Provider.aisdk("@ai-sdk/openai-compatible"),
          settings: { baseURL: RaccoonConnection.baseURL(profile.apiBase ?? baseURL) },
          ...(profile.orgScopeId ?? orgCode ? { body: { orgScopeId: profile.orgScopeId ?? orgCode } } : {}),
          capabilities: {
            tools: (profile.capabilities?.includes("tool_use") || profile.roles?.some((role) => role !== "autocomplete")) ?? true,
            input: ["text"],
            output: ["text"],
          },
          limit: {
            context,
            input: Math.max(0, Math.min(context - 4096, 60_000)),
            output: 4096,
          },
        },
      ]
    })
  }

  export async function discover(baseURL: string, access: string, orgCode?: string) {
    const headers = { Authorization: `Bearer ${access}`, "Content-Type": "application/json" }
    const settingsResponse = await fetch(`${baseURL}/api/plugin/setting/v1/settings`, {
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    })
    if (!settingsResponse.ok) throw new Error(`Failed to fetch Raccoon settings: ${settingsResponse.status}`)
    const settings = (await settingsResponse.json()) as Settings
    if (!settings.data?.settings?.capabilities?.includes("chatv2")) return []
    const response = await fetch(
      `${baseURL}${orgCode ? "/api/plugin/org/setting/v1/profiles" : "/api/plugin/setting/v1/profiles"}`,
      {
        headers: { ...headers, ...(orgCode ? { "x-org-code": orgCode } : {}) },
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      },
    )
    if (!response.ok) throw new Error(`Failed to fetch Raccoon profiles: ${response.status}`)
    const profiles = (await response.json()) as Profiles
    return fromProfiles(baseURL, profiles.data?.config?.models ?? [], orgCode)
  }
}
// raccoon_change end
