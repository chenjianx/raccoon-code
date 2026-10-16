// @ts-expect-error Bun exposes this module to tests; the Sidecar compiler intentionally loads Node-only types.
import { expect, test } from "bun:test"
import { SidecarPlatform } from "./platform.js"

test("forwards the browser authorization URL to the IDE", async () => {
  const opened: string[] = []
  const platform = new SidecarPlatform({
    directory: "/workspace/project",
    locale: "en",
    autocompleteEnabled: false,
    autocompleteModel: "",
    storageDir: "/workspace/project",
    log: () => {},
    onAutocompleteSettingsChange: () => {},
    openExternal: (url: string) => { opened.push(url) },
  })

  await platform.ui.openExternal("https://example.com/login?redirect=http%3A%2F%2F127.0.0.1%3A12345%2Fauth%2Fcallback&state=test")

  expect(opened).toEqual(["https://example.com/login?redirect=http%3A%2F%2F127.0.0.1%3A12345%2Fauth%2Fcallback&state=test"])
})
