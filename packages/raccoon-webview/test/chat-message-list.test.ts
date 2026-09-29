import { afterAll, beforeAll, expect, test } from "bun:test"
import { chromium, type Browser } from "../../../node_modules/.bun/node_modules/playwright"

const dist = new URL("../../raccoon-vscode/dist/webview/", import.meta.url)
let browser: Browser
let server: ReturnType<typeof Bun.serve>

beforeAll(async () => {
  const build = Bun.spawn(["bun", "run", "build"], {
    cwd: new URL("..", import.meta.url).pathname,
    stdout: "pipe",
    stderr: "pipe",
  })
  if ((await build.exited) !== 0) {
    throw new Error(`${await new Response(build.stdout).text()}\n${await new Response(build.stderr).text()}`)
  }

  server = Bun.serve({
    port: 0,
    async fetch(request) {
      const pathname = new URL(request.url).pathname
      const file = Bun.file(new URL(pathname === "/" ? "index.html" : pathname.slice(1), dist))
      if (!(await file.exists())) return new Response("Not found", { status: 404 })
      return new Response(file)
    },
  })
  browser = await chromium.launch({ channel: "chrome", headless: true })
}, 20_000)

afterAll(async () => {
  await browser?.close()
  server?.stop()
}, 20_000)

test("keeps the completed answer in view when a tool detail expands from the bottom", async () => {
  const page = await browser.newPage({ viewport: { width: 420, height: 760 } })
  await page.addInitScript(() => {
    const state = {
      activeSessionID: "session_1",
      activeSession: { id: "session_1", title: "Tool details", updatedAt: 1 },
      sessions: [{ id: "session_1", title: "Tool details", updatedAt: 1 }],
      messages: [
        {
          id: "message_user",
          role: "user",
          text: Array.from({ length: 24 }, (_, index) => `Previous context ${index + 1}`).join("\n"),
          parts: [
            {
              id: "part_user",
              type: "text",
              text: Array.from({ length: 24 }, (_, index) => `Previous context ${index + 1}`).join("\n"),
            },
          ],
          createdAt: 1,
        },
        {
          id: "message_assistant",
          role: "assistant",
          text: "Completed answer",
          parts: [
            {
              id: "part_tool",
              type: "tool",
              tool: "read",
              status: "completed",
              input: { filePath: "/workspace/CONTRIBUTING.md" },
              output: Array.from({ length: 40 }, (_, index) => `Output line ${index + 1}`).join("\n"),
            },
            { id: "part_answer", type: "text", text: "Completed answer" },
          ],
          createdAt: 2,
          completedAt: 3,
          agent: "build",
          providerID: "raccoon",
          modelID: "raccoon-pro-chat",
        },
      ],
      agents: [{ name: "build", mode: "primary", description: "Build" }],
      models: [
        {
          providerID: "raccoon",
          providerName: "Raccoon",
          modelID: "raccoon-pro-chat",
          modelName: "Raccoon Pro",
          connected: true,
          enabled: true,
        },
      ],
      providers: [],
      commands: [],
      commandConfigs: [],
      slashCommands: [],
      customProviders: [],
      mcpMarketplace: { items: [], installed: { project: {}, user: {} } },
      skillMarketplace: { sources: [], items: [], installed: { project: {}, user: {} } },
      mode: "build",
      loading: false,
      busy: false,
      raccoonLoggedIn: true,
    }
    Object.defineProperty(window, "acquireVsCodeApi", {
      value: () => ({ postMessage: () => {}, getState: () => state, setState: () => {} }),
    })
  })
  await page.goto(`http://127.0.0.1:${server.port}`)

  const messages = page.locator(".message-list")
  await messages.evaluate((element) => element.scrollTo({ top: element.scrollHeight }))
  await page.getByText("CONTRIBUTING.md", { exact: true }).click()

  expect(
    await messages.evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight),
  ).toBeLessThan(48)

  await page.close()
})
