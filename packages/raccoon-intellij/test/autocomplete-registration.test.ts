import { expect, test } from "bun:test"

const pluginXml = new URL("../src/main/resources/META-INF/plugin.xml", import.meta.url)
const editorListener = new URL(
  "../src/main/kotlin/com/sensetime/sensecode/jetbrains/raccoon/autocomplete/AutocompleteEditorListener.kt",
  import.meta.url,
)

test("registers conditional IntelliJ autocomplete interactions", async () => {
  const xml = await Bun.file(pluginXml).text()

  expect(xml).toContain("AutocompleteEditorListener")
  expect(xml).toContain("RaccoonActionPromoter")
  expect(xml).toContain("AcceptAutocompleteAction")
  expect(xml).toContain('first-keystroke="TAB"')
  expect(xml).toContain("CancelAutocompleteAction")
  expect(xml).toContain('first-keystroke="ESCAPE"')
  expect(xml).not.toContain("PartialAcceptAutocompleteAction")
  expect(xml).not.toContain("AutocompleteSpinnerWidget")
})

test("handles secondary caret lifecycle changes", async () => {
  const source = await Bun.file(editorListener).text()

  expect(source).toContain("override fun caretAdded")
  expect(source).toContain("override fun caretRemoved")
})
