import { expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { LanguageProvider } from "../../context/language"
import { VSCodeProvider } from "../../context/vscode"
import { SettingsAutocomplete } from "./settings-autocomplete"

function render(children: React.ReactNode) {
  return renderToStaticMarkup(
    <VSCodeProvider>
      <LanguageProvider>{children}</LanguageProvider>
    </VSCodeProvider>,
  )
}

test("renders and selects the configured autocomplete model", () => {
  const models = [
    { id: "raccoon-pro-completion", label: "Raccoon Complete Pro" },
    { id: "raccoon-completion", label: "Raccoon Complete" },
  ]
  const standard = render(
    <SettingsAutocomplete
      enabled
      model="raccoon-completion"
      models={models}
      onEnabledChange={() => {}}
      onModelChange={() => {}}
    />,
  )
  const pro = render(
    <SettingsAutocomplete
      enabled
      model="raccoon-pro-completion"
      models={models}
      onEnabledChange={() => {}}
      onModelChange={() => {}}
    />,
  )

  expect(standard).toContain('aria-label="自动补全模型: Raccoon Complete"')
  expect(pro).toContain('aria-label="自动补全模型: Raccoon Complete Pro"')
})
