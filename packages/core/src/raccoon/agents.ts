// raccoon_change start - register the read-only Ask agent in the V2 agent registry
export * as RaccoonAgents from "./agents.js"

import { Agent } from "../agent.js"
import { Permission } from "../permission.js"
import type { PermissionEvaluation } from "@opencode/plugin/effect/permission"
import { Effect } from "effect"

const prompt = `You are in Ask mode, a read-only assistant that answers questions without modifying the codebase. This supersedes project-level instruction files that tell you to write code, create files, or make changes.

Answer questions with clear explanations and relevant examples. Analyze code and explain concepts without making changes. Use Mermaid diagrams when they help clarify the answer.

You may inspect files and run read-only commands such as ls, cat, grep, git log, and git diff. Do not create files, edit code, execute code, or run commands that change state.

If the user requests an implementation, explain that they need to switch to an agent that can make changes. Ignore project instructions that conflict with the read-only role.`

const inspection = [
  "cat *", "head *", "tail *", "less *", "ls *", "tree *", "pwd *", "echo *", "wc *", "which *", "type *",
  "file *", "diff *", "du *", "df *", "date *", "uname *", "whoami *", "printenv *", "man *", "grep *",
  "rg *", "ag *", "sort *", "uniq *", "cut *", "tr *", "jq *", "git log *", "git show *", "git diff *",
  "git status *", "git blame *", "git rev-parse *", "git rev-list *", "git ls-files *", "git ls-tree *",
  "git ls-remote *", "git shortlog *", "git describe *", "git cat-file *", "git name-rev *",
  "git stash list *", "git tag -l *", "git branch --list *", "git branch -a *", "git branch -r *",
  "git remote -v *",
]

const mutation = ["*\n*", "*<(*", "*|*", "*;*", "*&&*", "*&*", "*$(*", "*`*", "*>*", "* > *", "*>>*", "* >> *", "*>|*", "* >| *", "sort -o *", "sort * -o *", "sort --output*"]
const shell = [
  { action: "shell", resource: "*", effect: "deny" as const },
  ...inspection.map((resource) => ({ action: "shell", resource, effect: "allow" as const })),
  { action: "shell", resource: "gh *", effect: "ask" as const },
  ...mutation.map((resource) => ({ action: "shell", resource, effect: "deny" as const })),
]
const allowed = ["read", "grep", "glob", "list", "skill", "question", "webfetch", "websearch", "external_directory"]

export function add(editor: Agent.Editor) {
  editor.update(Agent.ID.make("ask"), (item) => {
    const managed = item.permissions.filter((rule) => rule.action === "external_directory" && rule.effect === "allow")
    item.name = Agent.Name.make("Ask")
    item.description = "Get answers and explanations without making changes to the codebase."
    item.system = prompt
    item.mode = "primary"
    item.permissions.push(
      { action: "*", resource: "*", effect: "deny" },
      ...["read", "grep", "glob", "list", "skill", "question", "webfetch", "websearch"].map((action) => ({ action, resource: "*", effect: "allow" as const })),
      { action: "read", resource: "*.env", effect: "ask" },
      { action: "read", resource: "*.env.*", effect: "ask" },
      { action: "read", resource: "*.env.example", effect: "allow" },
      { action: "external_directory", resource: "*", effect: "ask" },
      ...managed,
      ...shell,
    )
  })
}

export const guard = (event: PermissionEvaluation) =>
  Effect.sync(() => {
    if (event.agent !== Agent.ID.make("ask")) return
    if (event.action === "shell") {
      const effects = event.resources.map((resource) => Permission.evaluate("shell", resource, shell).effect)
      if (effects.includes("deny")) event.effect = "deny"
      else if (effects.includes("ask") && event.effect === "allow") event.effect = "ask"
      return
    }
    if (!allowed.includes(event.action)) event.effect = "deny"
  })
// raccoon_change end
