import { expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { LanguageProvider } from "../../context/language"
import { VSCodeProvider } from "../../context/vscode"
import { MarkdownLite } from "./markdown-lite"

test("uses the clipboard icon for copying code", () => {
  const html = renderToStaticMarkup(
    <VSCodeProvider>
      <LanguageProvider>
        <MarkdownLite text={"```ts\nconst value = 1\n```"} />
      </LanguageProvider>
    </VSCodeProvider>,
  )

  expect(html).toContain('data-slot="markdown-code-copy"')
  expect(html).toContain('d="M168,152a8,8,0,0,1-8,8H96')
})
