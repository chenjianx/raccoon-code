// raccoon_change start - extend V2 config discovery with Raccoon file and directory names
export * as RaccoonConfig from "./config.js"

export const files = (base: readonly string[]) => ["config.json", ...base, "raccoon.json", "raccoon.jsonc"]

export const directories = [".raccoon", ".opencode"]
// raccoon_change end
