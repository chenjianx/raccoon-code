import { expect, test } from "bun:test"
import path from "node:path"

const intellijDir = path.dirname(import.meta.dir)
const gradle = process.platform === "win32" ? ["cmd.exe", "/d", "/s", "/c", "gradlew.bat"] : ["./gradlew"]

test("processResources builds the shared webview before packaging IntelliJ resources", () => {
  const result = Bun.spawnSync([...gradle, "processResources", "--dry-run"], {
    cwd: intellijDir,
  })
  const output = result.stdout.toString()

  expect(result.exitCode).toBe(0)
  expect(output).toContain(":prepareRaccoonWebview SKIPPED")
  expect(output.indexOf(":prepareRaccoonWebview SKIPPED")).toBeLessThan(output.indexOf(":processResources SKIPPED"))
})

test("processResources packages the current shared webview", async () => {
  const result = Bun.spawnSync([...gradle, "processResources", "-x", "prepareRaccoonBinaries", "--rerun-tasks"], {
    cwd: intellijDir,
  })
  const translations = await Bun.file(path.join(intellijDir, "../raccoon-webview/src/i18n/zh.ts")).text()
  const title = translations.match(/"login\.title":\s*"([^"]+)"/)?.[1]
  const bundle = await Bun.file(path.join(intellijDir, "build/resources/main/webview/assets/index.js")).text()
  const styles = await Bun.file(path.join(intellijDir, "build/resources/main/webview/assets/index.css")).text()

  expect(result.exitCode).toBe(0)
  expect(title).toBeDefined()
  expect(bundle).toContain(`"login.title":"${title}"`)
  expect(styles).toContain(".login-methods{")
}, 120_000)
