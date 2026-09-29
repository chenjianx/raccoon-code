import { access } from "node:fs/promises"
import { join } from "node:path"
import type { OpenCodeClient } from "@opencode/client/promise"

// Raccoon 配置文件/目录的统一解析助手。写入侧沿用已存在的文件，
// 使 v2 的配置发现和编辑器配置保持一致。

export const PROJECT_CONFIG_FILES = ["raccoon.jsonc", "raccoon.json", "opencode.jsonc", "opencode.json"]
export const GLOBAL_CONFIG_FILES = ["raccoon.jsonc", "raccoon.json", "opencode.jsonc", "opencode.json", "config.json"]
export const DEFAULT_CONFIG_FILE = "raccoon.jsonc"

export type ProjectConfigDirName = ".raccoon" | ".opencode"

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

// 返回第一个已存在的候选配置文件；都不存在则回退到 fallback（默认 raccoon.jsonc）。
// fallback 对应 Raccoon 默认配置文件。
export async function pickConfigFile(
  dir: string,
  candidates: string[],
  fallback: string = DEFAULT_CONFIG_FILE,
): Promise<string> {
  for (const candidate of candidates) {
    const candidatePath = join(dir, candidate)
    if (await exists(candidatePath)) return candidatePath
  }
  return join(dir, fallback)
}

// 项目内配置目录名：优先已存在的 .raccoon，其次已存在的 .opencode，都没有则默认 .raccoon。
// 与 Raccoon 的项目配置发现顺序一致。
export async function pickProjectConfigDirName(directory: string): Promise<ProjectConfigDirName> {
  if (await exists(join(directory, ".raccoon"))) return ".raccoon"
  if (await exists(join(directory, ".opencode"))) return ".opencode"
  return ".raccoon"
}

export async function globalConfigDir(client: OpenCodeClient, directory: string) {
  const config = await client.config.get({ location: { directory } })
  return config.find((entry) => entry.type === "directory")?.path
}
