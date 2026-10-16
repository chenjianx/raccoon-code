import { expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { LanguageProvider } from "../../context/language"
import { VSCodeProvider } from "../../context/vscode"
import { SettingsProviderConnectDialog } from "./settings-provider-connect-dialog"

test("shows the authorization code while the device login is pending", () => {
  const html = renderToStaticMarkup(
    <VSCodeProvider>
      <LanguageProvider>
        <SettingsProviderConnectDialog
          providerID="github-copilot"
          name="GitHub Copilot"
          connected={false}
          methods={[{ type: "oauth", label: "GitHub login" }]}
          draft={{ methodIndex: 0, apiKey: "", inputs: {} }}
          connecting
          instructions="Enter code: ABCD-EFGH"
          onClose={() => {}}
          onMethodChange={() => {}}
          onApiKeyChange={() => {}}
          onInputChange={() => {}}
          onConnect={() => {}}
        />
      </LanguageProvider>
    </VSCodeProvider>,
  )

  expect(html).toContain("Enter code: ABCD-EFGH")
  expect(html).toContain('role="status"')
})
