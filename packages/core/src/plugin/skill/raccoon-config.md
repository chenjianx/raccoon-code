<!--
  Built-in skill. Name and description are registered in code at
  packages/core/src/plugin/skill.ts. The body below becomes the skill's content.
-->
<!-- raccoon_change start - bundle Raccoon marketplace instructions for V2 -->

# Installing MCP servers and skills

Use this when the user asks, in natural language, to **install / add / 安装 /
新增** an MCP server or a skill by name (e.g. "装个 playwright 的 mcp",
"add the github mcp", "安装 pdf 处理的 skill"). The Raccoon marketplace ships
its catalog on GitHub; you install by fetching that catalog and then editing
config / cloning the skill directory yourself. There is no install API to call.

<!-- raccoon_change start - use V2 config roots and reload behavior -->
After writing config or installing a skill, reload the current location with the
v2 `location.reload` API when the host exposes it. If that is unavailable,
restart the host and verify that the server or skill appears.

## Where things live

| Target     | Scope   | Location |
| ---------- | ------- | -------- |
| MCP server | project | An existing `raccoon.jsonc`, `raccoon.json`, `opencode.jsonc`, or `opencode.json` in the project |
| MCP server | user    | An existing config file in the global config directory reported by v2 `config.get` |
| Skill      | project | The existing `.opencode/skills` or `.raccoon/skills` directory |
| Skill      | user    | `skills/<name>/SKILL.md` under the global config directory |

Default to **project** scope unless the user says "globally" / "for all
projects" / "全局". Preserve an existing config file. If none exists, use
`raccoon.jsonc` and `.raccoon/skills` only when `RACCOON_CLI=1`; otherwise use
`opencode.jsonc` and `.opencode/skills`. For global scope, use the v2
`config.get` directory when available; otherwise `OPENCODE_CONFIG_DIR` or the
corresponding `XDG_CONFIG_HOME/{raccoon|opencode}` directory.
<!-- raccoon_change end -->

## Installing an MCP server

1. Fetch the catalog:
   `https://raw.githubusercontent.com/chenjianx/raccoon-marketplace/main/mcps/marketplace.yaml`
2. It is `{ items: [ { id, name, description, url, content, parameters } ] }`.
   Match the user's request against `id` / `name` / `description`. If several
   match, show the top candidates and ask which one; if none match, say so and
   offer to add it manually from a package name or URL the user provides.
3. `content` is either a JSON **string** or an array of install methods, each
   with a `content` JSON string. Parse it and pick a method Raccoon can run:
   - `{"command":"npx","args":["-y","<pkg>", ...],"env":{...}}` → local package
   - `{"command":"uvx","args":["<pkg>", ...],"env":{...}}` → local package
   - `{"type":"streamable-http"|"http"|"sse","url":"..."}` → remote endpoint

   Ignore `docker` / `node` / `python` / raw-binary methods — Raccoon cannot
   reconstruct those from a package identifier. If an entry only ships those,
   tell the user it is not auto-installable.
<!-- raccoon_change start - write native V2 MCP server entries -->
4. Write the server under the config file's `mcp.servers` object, keyed by the item
   `id` (normalize to `[A-Za-z0-9._-]`, collapsing other runs to `-`):

   ```jsonc
   {
     "mcp": {
       "servers": {
         "playwright": {
           "type": "local",
           "command": ["npx", "-y", "@playwright/mcp"]
         },
         "some-remote": {
           "type": "remote",
           "url": "https://mcp.example.com"
         }
       }
     }
   }
   ```

   - `command` is always an array. For npm: `["npx", "-y", "<pkg>@<version?>"]`.
     For pypi: `["uvx", "<pkg>==<version?>"]`. Preserve any extra args from the
     catalog method verbatim.
   - `type` is required (`"local"` or `"remote"`).
   - Servers are enabled by default. Use `"disabled": true` only when requested.
   - Preserve `$schema` and every field the user did not ask to change; do not
     clobber other `mcp` entries.
5. **Placeholders and secrets.** Catalog args, urls, and `env` values may carry
   `{{TOKEN}}` placeholders (and `parameters` describe them). For each required
   one — especially anything matching `TOKEN|KEY|SECRET|PASSWORD|PAT|CREDENTIAL|APIKEY`
   — ask the user for the value and substitute it before writing. Put secrets in
   `environment` (local) or `headers` (remote); never invent a value.
6. Reload the location or restart the host, then confirm the server appears.
<!-- raccoon_change end -->

## Installing a skill

1. Fetch the skill catalog:
   `https://raw.githubusercontent.com/chenjianx/raccoon-marketplace/main/skills/marketplace.yaml`
   Shape: `{ items: [ { id, name, description, category } ] }`. The skill lives
   at the `skills/<id>` subdirectory of the repo.
2. Match the request against `id` / `name` / `description`; the `id` must match
   `^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$` to be installable.
3. Sparse-checkout just that directory into a temp dir, then copy it to the
   target skills root from the table above. Refuse to overwrite an existing
   skill of the same name.

   ```bash
   tmp=$(mktemp -d)
   git clone --depth 1 --filter=blob:none --no-checkout \
     https://github.com/chenjianx/raccoon-marketplace "$tmp"
   git -C "$tmp" sparse-checkout init --cone
   git -C "$tmp" sparse-checkout set skills/<id>
   git -C "$tmp" checkout --force HEAD
   # verify skills/<id>/SKILL.md exists, then copy into place:
   mkdir -p <skills-root>
   cp -R "$tmp/skills/<id>" <skills-root>/<id>
   rm -rf "$tmp"
   ```

4. Verify `SKILL.md` is present in the checked-out directory before copying; if
   it is missing, the entry is not a valid skill — report that and stop. Do not
   copy any skill that contains symlinks.
5. Reload the location or restart the host, then confirm the skill appears.

## Notes

- These catalogs are fetched live from GitHub. If a fetch fails (offline, rate
  limit), say so rather than guessing package names or URLs.
- For V2 MCP config field shapes beyond the basics here, use the bundled
  `opencode` skill or the host's current config schema.
<!-- raccoon_change end -->
