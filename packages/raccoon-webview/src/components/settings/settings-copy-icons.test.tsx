import { expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { LanguageProvider } from "../../context/language"
import { VSCodeProvider } from "../../context/vscode"
import type { RaccoonAgent } from "../../protocol"
import { PermissionRuleset } from "./permission-editor"
import { SettingsAgents } from "./settings-agents"

function render(children: React.ReactNode) {
  return renderToStaticMarkup(
    <VSCodeProvider>
      <LanguageProvider>{children}</LanguageProvider>
    </VSCodeProvider>,
  )
}

test("uses the clipboard icon for copying permission rules", () => {
  const html = render(<PermissionRuleset agent="build" rules={[]} />)

  expect(html).toContain('title="复制规则 JSON"')
  expect(html).toContain('d="M168,152a8,8,0,0,1-8,8H96')
})

test("uses the clipboard icon for duplicating an agent", () => {
  const agent = {
    name: "build",
    mode: "primary",
    configScope: "project",
  } satisfies RaccoonAgent
  const html = render(
    <SettingsAgents
      agents={[agent]}
      connectedModels={[]}
      onConfigureAgent={() => {}}
      onDeleteAgent={() => {}}
    />,
  )

  expect(html).toContain('title="复制智能体"')
  expect(html).toContain('d="M168,152a8,8,0,0,1-8,8H96')
})
