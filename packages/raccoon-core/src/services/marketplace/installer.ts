import { applyEdits, modify, parse, type ParseError } from "jsonc-parser/lib/esm/main.js"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import type { OpenCodeClient } from "@opencode/client/promise"
import { GLOBAL_CONFIG_FILES, PROJECT_CONFIG_FILES, pickConfigFile } from "../../provider/config/config-paths.js"
import { globalConfigRoot } from "./config-root.js"
import type {
  MarketplaceInstalledMetadata,
  MarketplaceInstalledServer,
  MarketplaceInstallOptions,
  MarketplaceInstallResult,
  MarketplaceManualInstall,
  MarketplaceMcpItem,
  MarketplaceRemoveResult,
  MarketplaceScope,
  McpServerConfig,
} from "./types.js"

type McpConfig = McpServerConfig

export class MarketplaceInstaller {
  async detect(client: OpenCodeClient, directory: string): Promise<MarketplaceInstalledMetadata> {
    const [project, user] = await Promise.all([
      readMcpIDs(await pickConfigFile(directory, PROJECT_CONFIG_FILES)),
      this.globalConfigFile(client, directory).then(readMcpIDs),
    ])
    return {
      project: Object.fromEntries(project.map((id) => [id, { type: "mcp" as const }])),
      user: Object.fromEntries(user.map((id) => [id, { type: "mcp" as const }])),
    }
  }

  async listInstalled(client: OpenCodeClient, directory: string): Promise<MarketplaceInstalledServer[]> {
    const [project, user] = await Promise.all([
      readMcpEntries(await pickConfigFile(directory, PROJECT_CONFIG_FILES)),
      this.globalConfigFile(client, directory).then(readMcpEntries),
    ])
    return [
      ...project.map((entry) => ({ ...entry, scope: "project" as const })),
      ...user.map((entry) => ({ ...entry, scope: "user" as const })),
    ]
  }

  async setEnabled(
    client: OpenCodeClient,
    directory: string,
    id: string,
    scope: MarketplaceScope,
    enabled: boolean,
  ): Promise<MarketplaceRemoveResult> {
    const file = await this.configFile(client, directory, scope)
    await setMcpEnabled(file, id, enabled)
    await reloadConfig(client, directory, scope)
    return { success: true, id, scope }
  }

  async updateConfig(
    client: OpenCodeClient,
    directory: string,
    id: string,
    scope: MarketplaceScope,
    rawConfig: McpServerConfig,
  ): Promise<MarketplaceRemoveResult> {
    const config = sanitizeManualConfig(rawConfig)
    if (!config) {
      return { success: false, id, scope, error: "Invalid MCP server configuration." }
    }
    const file = await this.configFile(client, directory, scope)
    await writeMcpToFile(file, id, config, false, true)
    await reloadConfig(client, directory, scope)
    return { success: true, id, scope }
  }

  async install(
    client: OpenCodeClient,
    directory: string,
    item: MarketplaceMcpItem,
    options: MarketplaceInstallOptions,
  ): Promise<MarketplaceInstallResult> {
    const transport = options.transport ?? (item.packages.length > 0 ? "package" : "remote")
    const config = transport === "remote"
      ? remotePackageConfig(item, options.headers, options.variables)
      : localPackageConfig(item, options.environment, options.variables)
    if (!config) {
      return {
        success: false,
        id: item.id,
        scope: options.scope,
        error:
          transport === "remote"
            ? "This MCP server does not provide a remote endpoint."
            : "This MCP server does not provide an automatically installable local package.",
      }
    }
    const missing = [
      ...(transport === "package"
        ? requiredEnvironmentVariables(item).filter((env) => !options.environment?.[env.name]?.trim())
        : []),
      // {{TOKEN}} substitutions apply to both package args and remote urls.
      ...requiredVariables(item).filter((entry) => !options.variables?.[entry.name]?.trim()),
    ]
    if (missing.length > 0) {
      return { success: false, id: item.id, scope: options.scope, error: `Missing required values: ${missing.map((entry) => entry.name).join(", ")}` }
    }

    const id = normalizeMcpID(item.name)
    const file = await this.configFile(client, directory, options.scope)
    await writeMcpToFile(file, id, config, false)
    await reloadConfig(client, directory, options.scope)
    return { success: true, id, scope: options.scope }
  }

  async installManual(
    client: OpenCodeClient,
    directory: string,
    request: MarketplaceManualInstall,
  ): Promise<MarketplaceInstallResult> {
    const id = normalizeMcpID(request.id)
    const config = sanitizeManualConfig(request.config)
    if (!config) {
      return { success: false, id, scope: request.scope, error: "Invalid MCP server configuration." }
    }
    const file = await this.configFile(client, directory, request.scope)
    await writeMcpToFile(file, id, config, false)
    await reloadConfig(client, directory, request.scope)
    return { success: true, id, scope: request.scope }
  }

  async remove(
    client: OpenCodeClient,
    directory: string,
    item: MarketplaceMcpItem,
    scope: MarketplaceScope,
  ): Promise<MarketplaceRemoveResult> {
    const id = normalizeMcpID(item.name)
    const file = await this.configFile(client, directory, scope)
    await writeMcpToFile(file, id, undefined, true)
    await reloadConfig(client, directory, scope)
    return { success: true, id, scope }
  }

  async removeById(
    client: OpenCodeClient,
    directory: string,
    id: string,
    scope: MarketplaceScope,
  ): Promise<MarketplaceRemoveResult> {
    const file = await this.configFile(client, directory, scope)
    await writeMcpToFile(file, id, undefined, true)
    await reloadConfig(client, directory, scope)
    return { success: true, id, scope }
  }

  private async configFile(client: OpenCodeClient, directory: string, scope: MarketplaceScope) {
    if (scope === "project") return await pickConfigFile(directory, PROJECT_CONFIG_FILES)
    return await this.globalConfigFile(client, directory)
  }

  private async globalConfigFile(client: OpenCodeClient, directory: string) {
    return await pickConfigFile(await globalConfigRoot(client, directory), GLOBAL_CONFIG_FILES)
  }
}

async function writeMcpToFile(
  file: string,
  id: string,
  value: McpConfig | undefined,
  allowMissing: boolean,
  allowOverwrite = false,
) {
  const raw = await readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined
    throw error
  })
  if (!raw && value === undefined && allowMissing) return false
  const source = raw?.trim() ? raw : "{}"
  const config = parseConfig(source, file)
  const exists = mcpPaths(config, id).length > 0
  if (value !== undefined && exists && !allowOverwrite) throw new Error(`MCP server "${id}" is already installed`)
  if (value === undefined && !exists && allowMissing) return false
  const paths = value === undefined
    ? mcpPaths(config, id)
    : [["mcp", "servers", id], ...mcpPaths(config, id).filter((path) => path[1] !== "servers")]
  const updated = paths.reduce((text, path) => applyEdits(text, modify(text, path, value && path[1] === "servers" ? toNativeConfig(value) : undefined, {
    formattingOptions: { insertSpaces: true, tabSize: 2 },
  })), source)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, updated.endsWith("\n") ? updated : `${updated}\n`)
  return true
}

async function readMcpIDs(file: string) {
  return (await readMcpEntries(file)).map((entry) => entry.id)
}

async function readMcpEntries(file: string): Promise<Array<{ id: string; config: McpServerConfig }>> {
  const raw = await readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "{}"
    throw error
  })
  const config = parseConfig(raw, file)
  const mcp = asRecord(config.mcp)
  const native = asRecord(mcp?.servers)
  return Object.entries({
    ...Object.fromEntries(Object.entries(mcp ?? {}).filter(([id]) => id !== "servers" && id !== "timeout")),
    ...native,
  }).flatMap(([id, value]) => {
    const config = toServerConfig(value)
    return config ? [{ id, config }] : []
  })
}

async function setMcpEnabled(file: string, id: string, enabled: boolean) {
  const raw = await readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined
    throw error
  })
  const source = raw?.trim() ? raw : "{}"
  const config = parseConfig(source, file)
  const paths = mcpPaths(config, id)
  if (!paths.length) throw new Error(`MCP server "${id}" is not installed`)
  if (paths[0]![1] !== "servers") {
    const server = toServerConfig(asRecord(config.mcp)?.[id])
    if (!server) throw new Error(`MCP server "${id}" has invalid configuration`)
    await writeMcpToFile(file, id, { ...server, enabled }, false, true)
    return
  }
  const updated = applyEdits(
    source,
    modify(source, [...paths[0]!, "disabled"], !enabled, {
      formattingOptions: { insertSpaces: true, tabSize: 2 },
    }),
  )
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, updated.endsWith("\n") ? updated : `${updated}\n`)
}

function toServerConfig(value: unknown): McpServerConfig | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const type = typeof record.type === "string" ? record.type.toLowerCase() : undefined
  if (type !== "local" && type !== "remote") return undefined
  const timeout = typeof record.timeout === "number" ? record.timeout : asRecord(record.timeout)?.execution
  const enabled = typeof record.enabled === "boolean" ? record.enabled : typeof record.disabled === "boolean" ? !record.disabled : undefined
  if (type === "remote") {
    const url = typeof record.url === "string" ? record.url : ""
    return {
      type: "remote",
      url,
      ...(isStringRecord(record.headers) ? { headers: record.headers } : {}),
      ...(enabled !== undefined ? { enabled } : {}),
      ...(typeof timeout === "number" ? { timeout } : {}),
    }
  }
  const command = Array.isArray(record.command)
    ? record.command.filter((part): part is string => typeof part === "string")
    : []
  return {
    type: "local",
    command,
    ...(typeof record.cwd === "string" ? { cwd: record.cwd } : {}),
    ...(isStringRecord(record.environment) ? { environment: record.environment } : {}),
    ...(enabled !== undefined ? { enabled } : {}),
    ...(typeof timeout === "number" ? { timeout } : {}),
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function mcpPaths(config: Record<string, unknown>, id: string): string[][] {
  const mcp = asRecord(config.mcp)
  return [
    ...(Object.hasOwn(asRecord(mcp?.servers) ?? {}, id) ? [["mcp", "servers", id]] : []),
    ...(Object.hasOwn(mcp ?? {}, id) ? [["mcp", id]] : []),
  ]
}

function toNativeConfig(config: McpConfig) {
  const { enabled, timeout, ...server } = config
  return {
    ...server,
    ...(enabled === false ? { disabled: true } : {}),
    ...(timeout !== undefined ? { timeout: { catalog: timeout, execution: timeout } } : {}),
  }
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  return Object.values(value as Record<string, unknown>).every((entry) => typeof entry === "string")
}

function parseConfig(raw: string, file: string) {
  const errors: ParseError[] = []
  const parsed = parse(raw, errors, { allowTrailingComma: true })
  if (errors.length > 0) throw new Error(`Failed to parse config file ${file}`)
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>
  return {}
}

function cleanRecord(record: Record<string, string>) {
  return Object.fromEntries(Object.entries(record).filter((entry) => entry[0].trim() && entry[1].trim()))
}

function localPackageConfig(
  item: MarketplaceMcpItem,
  environment: Record<string, string> | undefined,
  variables: Record<string, string> | undefined,
): McpConfig | undefined {
  const pkg = item.packages.find((entry) => entry.registryType.toLowerCase() === "npm" && entry.transport?.type === "stdio")
    ?? item.packages.find((entry) => entry.registryType.toLowerCase() === "pypi" && entry.transport?.type === "stdio" && entry.runtimeHint === "uvx")
  if (!pkg) return undefined
  const command = pkg.runtimeArguments?.length
    ? applyArgTemplate(pkg.runtimeArguments, variables ?? {}, item.variables)
    : pkg.registryType.toLowerCase() === "npm"
      ? ["npx", "-y", packageSpecifier(pkg.identifier, pkg.version)]
      : ["uvx", pythonSpecifier(pkg.identifier, pkg.version)]
  const clean = cleanRecord(environment ?? {})
  return {
    type: "local",
    command,
    ...(Object.keys(clean).length > 0 ? { environment: clean } : {}),
  }
}

function remotePackageConfig(
  item: MarketplaceMcpItem,
  headers: Record<string, string> | undefined,
  variables: Record<string, string> | undefined,
): McpConfig | undefined {
  const remote = item.remotes[0]
  if (!remote?.url) return undefined
  const clean = cleanRecord(headers ?? {})
  return {
    type: "remote",
    url: substituteTokens(remote.url, variables ?? {}),
    ...(Object.keys(clean).length > 0 ? { headers: clean } : {}),
  }
}

// Replace every {{TOKEN}} in a string with its value (empty string when unset).
function substituteTokens(text: string, variables: Record<string, string>): string {
  return text.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, key: string) => variables[key] ?? "")
}

// Substitute {{TOKEN}} placeholders across a command template. An arg that is exactly
// a single optional placeholder with no value is dropped, along with a preceding flag arg.
function applyArgTemplate(
  args: string[],
  variables: Record<string, string>,
  declared: MarketplaceMcpItem["variables"],
): string[] {
  const optional = new Set(declared.filter((entry) => !(entry.isRequired || entry.isSecret)).map((entry) => entry.name))
  const result: string[] = []
  for (const arg of args) {
    const soleToken = arg.match(/^\{\{\s*([^}]+?)\s*\}\}$/)
    const key = soleToken?.[1]
    if (key) {
      const value = variables[key]?.trim()
      if (!value && optional.has(key)) {
        // Drop an immediately preceding flag (e.g. `--read-only` for an empty `{{X}}`).
        const last = result[result.length - 1]
        if (last !== undefined && last.startsWith("-")) result.pop()
        continue
      }
    }
    result.push(substituteTokens(arg, variables))
  }
  return result
}

function sanitizeManualConfig(config: McpServerConfig): McpConfig | undefined {
  if (config.type === "local") {
    const command = Array.isArray(config.command) ? config.command.map((part) => `${part}`).filter((part) => part.length > 0) : []
    if (command.length === 0) return undefined
    const environment = cleanRecord(config.environment ?? {})
    return {
      type: "local",
      command,
      ...(config.cwd?.trim() ? { cwd: config.cwd.trim() } : {}),
      ...(Object.keys(environment).length > 0 ? { environment } : {}),
      ...(config.enabled === false ? { enabled: false } : {}),
      ...(typeof config.timeout === "number" ? { timeout: config.timeout } : {}),
    }
  }
  if (config.type === "remote") {
    const url = config.url?.trim()
    if (!url) return undefined
    const headers = cleanRecord(config.headers ?? {})
    return {
      type: "remote",
      url,
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
      ...(config.enabled === false ? { enabled: false } : {}),
      ...(typeof config.timeout === "number" ? { timeout: config.timeout } : {}),
    }
  }
  return undefined
}

function packageSpecifier(identifier: string, version: string | undefined) {
  if (!version) return identifier
  return `${identifier}@${version}`
}

function pythonSpecifier(identifier: string, version: string | undefined) {
  if (!version) return identifier
  return `${identifier}==${version}`
}

function requiredEnvironmentVariables(item: MarketplaceMcpItem) {
  const seen = new Set<string>()
  return item.environmentVariables.filter((env) => {
    if (!env.name || seen.has(env.name)) return false
    seen.add(env.name)
    return env.isRequired || env.isSecret
  })
}

function requiredVariables(item: MarketplaceMcpItem) {
  const seen = new Set<string>()
  return item.variables.filter((entry) => {
    if (!entry.name || seen.has(entry.name)) return false
    seen.add(entry.name)
    return entry.isRequired || entry.isSecret
  })
}

async function reloadConfig(client: OpenCodeClient, directory: string, scope: MarketplaceScope) {
  await client.location.reload()
}

export function normalizeMcpID(name: string) {
  const normalized = name
    .trim()
    .replace(/[\\/]+/g, "-")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return normalized || "mcp-server"
}
