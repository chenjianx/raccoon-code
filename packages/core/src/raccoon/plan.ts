// raccoon_change start - resolve project and global plan paths for the Raccoon host
export * as RaccoonPlan from "./plan.js"

import path from "node:path"
import { Project } from "../project.js"

export function directory(input: { app: string; home: string; data: string; project: { id: string; directory: string } }) {
  if (input.app !== "raccoon") return path.join(input.home, ".opencode", "plan")
  if (input.project.id === Project.ID.global) return path.join(input.data, "plans")
  return path.join(input.project.directory, ".raccoon", "plans")
}
// raccoon_change end
