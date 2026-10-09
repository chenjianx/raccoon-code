// @ts-expect-error Bun exposes this module to tests; the Sidecar compiler intentionally loads Node-only types.
import { expect, test } from "bun:test"
import { SidecarPlatform } from "./platform.js"
import type { SidecarToHost } from "./rpc.js"

test("forwards message file links with their location to the IDE", () => {
  const sent: SidecarToHost[] = []
  const platform = new SidecarPlatform({
    directory: "/workspace/project",
    locale: "en",
    autocompleteEnabled: false,
    autocompleteModel: "",
    storageDir: "/workspace/project",
    log: () => {},
    onAutocompleteSettingsChange: () => {},
    openFile: (filePath, directory, line, column) => sent.push({ type: "openFile", filePath, directory, line, column }),
  })

  platform.ui.openFile("src/example.ts", "/workspace/project", 12, 3)

  expect(sent).toEqual([{ type: "openFile", filePath: "src/example.ts", directory: "/workspace/project", line: 12, column: 3 }])
})
