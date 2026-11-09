import { expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { LanguageProvider } from "../../context/language"
import { VSCodeProvider } from "../../context/vscode"
import { nextAgentTab, SettingsAgents } from "./settings-agents"

function renderAgents() {
  return renderToStaticMarkup(
    <VSCodeProvider>
      <LanguageProvider>
        <SettingsAgents
          agents={[
            { name: "build", mode: "primary", native: true, configScope: "project" },
            { name: "explore", mode: "subagent", native: true },
            { name: "assistant", mode: "all" },
          ]}
          connectedModels={[]}
          onConfigureAgent={() => {}}
          onDeleteAgent={() => {}}
        />
      </LanguageProvider>
    </VSCodeProvider>,
  )
}

test("agent model settings have a dedicated tab instead of extending the general form", () => {
  const html = renderAgents()

  expect(html.match(/role="tab"/g)).toHaveLength(4)
  expect(html).toContain('aria-controls="settings-agent-panel-model"')
  expect(html).not.toContain("temperature")
})

test("agent fields and navigation expose accessible names", () => {
  const html = renderAgents()

  expect(html).toContain('aria-label="智能体列表"')
  expect(html).toContain('aria-label="名称"')
  expect(html).toContain('aria-label="描述"')
  expect(html).toContain('aria-current="true"')
  expect(html).not.toContain(">primary<")
  expect(html).not.toContain(">subagent<")
})

test.each([
  { tab: "overview", key: "ArrowLeft", want: "permissions" },
  { tab: "overview", key: "ArrowRight", want: "model" },
  { tab: "model", key: "ArrowRight", want: "instructions" },
  { tab: "instructions", key: "ArrowLeft", want: "model" },
  { tab: "permissions", key: "ArrowRight", want: "overview" },
  { tab: "model", key: "Home", want: "overview" },
  { tab: "overview", key: "End", want: "permissions" },
  { tab: "overview", key: "Tab", want: undefined },
] as const)("agent tab keyboard navigation: $tab + $key", (entry) => {
  expect(nextAgentTab(entry.tab, entry.key)).toBe(entry.want)
})
