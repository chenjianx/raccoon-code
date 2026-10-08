import { describe, expect, test } from "bun:test"
import path from "node:path"

const resources = new URL("../src/main/resources/", import.meta.url)
const packagedResources = new URL("../build/resources/main/", import.meta.url)
const vscodeImages = new URL("../../raccoon-vscode/images/", import.meta.url)
const intellijDir = path.dirname(import.meta.dir)
const gradle = process.platform === "win32" ? ["cmd.exe", "/d", "/s", "/c", "gradlew.bat"] : ["./gradlew"]

function paths(svg: string) {
  return [...svg.matchAll(/\sd="([^"]+)"/g)].map((match) => match[1])
}

describe("IntelliJ icon assets", () => {
  test("uses the current VS Code raccoon artwork for IDE icons", async () => {
    const reference = await Bun.file(new URL("raccoon.svg", vscodeImages)).text()
    const variants = [
      ["icons/raccoon.svg", 16, "#6C707E"],
      ["icons/raccoonToolWindow.svg", 16, "#6C707E"],
      ["icons/raccoonToolWindow_dark.svg", 16, "#CED0D6"],
      ["icons/raccoonToolWindow@20x20.svg", 20, "#6C707E"],
      ["icons/raccoonToolWindow@20x20_dark.svg", 20, "#CED0D6"],
    ] as const

    for (const [name, size, color] of variants) {
      const file = Bun.file(new URL(name, resources))
      expect(await file.exists()).toBe(true)
      const svg = await file.text()

      expect(svg).toContain(`width="${size}"`)
      expect(svg).toContain(`height="${size}"`)
      expect(svg).toContain('viewBox="0 0 30 30"')
      expect([...svg.matchAll(/\s(?:fill|stroke)="(#[0-9A-Fa-f]{6})"/g)].map((match) => match[1])).toEqual(
        expect.arrayContaining([color]),
      )
      expect(svg.match(/\s(?:fill|stroke)="(#[0-9A-Fa-f]{6})"/g)?.every((attribute) => attribute.includes(color))).toBe(
        true,
      )
      expect(paths(svg)).toEqual(paths(reference))
    }
  })

  test("provides the current raccoon artwork as the packaged plugin logo", async () => {
    const file = Bun.file(new URL("META-INF/pluginIcon.svg", resources))
    expect(await file.exists()).toBe(true)

    const [logo, reference] = await Promise.all([
      file.text(),
      Bun.file(new URL("raccoon.svg", vscodeImages)).text(),
    ])

    expect(logo).toContain('width="40"')
    expect(logo).toContain('height="40"')
    expect(logo).toContain('viewBox="0 0 40 40"')
    expect(logo).toContain('transform="translate(4 4) scale(1.0666667)"')
    expect(paths(logo)).toEqual(paths(reference))
  })

  test("packages every IntelliJ icon resource", async () => {
    const result = Bun.spawnSync(
      [...gradle, "processResources", "-x", "prepareRaccoonWebview", "-x", "prepareRaccoonBinaries", "--rerun-tasks"],
      { cwd: intellijDir },
    )
    expect(result.exitCode).toBe(0)

    for (const name of [
      "META-INF/pluginIcon.svg",
      "icons/raccoon.svg",
      "icons/raccoonToolWindow.svg",
      "icons/raccoonToolWindow_dark.svg",
      "icons/raccoonToolWindow@20x20.svg",
      "icons/raccoonToolWindow@20x20_dark.svg",
    ]) {
      expect(await Bun.file(new URL(name, packagedResources)).exists()).toBe(true)
    }
  }, 120_000)
})
