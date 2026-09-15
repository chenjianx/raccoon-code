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

test("keeps reverted messages compact until the user expands and restores them", async () => {
  const page = await browser.newPage({ viewport: { width: 420, height: 760 } })
  await page.addInitScript(() => {
    const messages = [
      {
        id: "message_1",
        role: "user",
        text: "第一条已回滚消息",
        parts: [{ id: "part_1", type: "text", text: "第一条已回滚消息" }],
        createdAt: 1,
      },
      {
        id: "message_2",
        role: "user",
        text: "第二条已回滚消息",
        parts: [{ id: "part_2", type: "text", text: "第二条已回滚消息" }],
        createdAt: 2,
      },
    ]
    const session = {
      id: "session_1",
      title: "Reverted messages",
      updatedAt: 2,
      revert: { messageID: "message_1" },
    }
    const state = {
      activeSessionID: session.id,
      activeSession: session,
      sessions: [session],
      messages,
      agents: [],
      models: [],
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
    const posted: unknown[] = []
    Object.defineProperty(window, "__mockState", { value: state })
    Object.defineProperty(window, "__postedMessages", { value: posted })
    Object.defineProperty(window, "acquireVsCodeApi", {
      value: () => ({ postMessage: (message: unknown) => posted.push(message), getState: () => state, setState: () => {} }),
    })
  })
  await page.goto(`http://127.0.0.1:${server.port}`)

  const expand = page.getByRole("button", { name: "展开已回滚消息" })
  expect(await expand.count()).toBe(1)
  expect(await expand.getAttribute("aria-expanded")).toBe("false")
  expect(await page.getByText("第二条已回滚消息").count()).toBe(0)

  await expand.click()

  expect(await page.getByRole("button", { name: "折叠已回滚消息" }).getAttribute("aria-expanded")).toBe("true")
  expect(await page.getByText("第二条已回滚消息").count()).toBe(1)
  expect(await page.getByRole("button", { name: "恢复到此处" }).count()).toBe(2)
  expect(
    await page.locator(".message-list").evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight),
  ).toBeLessThan(2)

  await page.evaluate(() => {
    const current = (window as typeof window & { __mockState: Record<string, unknown> }).__mockState
    const activeSession = {
      ...(current.activeSession as Record<string, unknown>),
      revert: { messageID: "message_2" },
    }
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "state", state: { ...current, activeSession, sessions: [activeSession] } },
      }),
    )
  })

  const collapsed = page.getByRole("button", { name: "展开已回滚消息" })
  expect(await collapsed.count()).toBe(1)
  expect(await collapsed.getAttribute("aria-expanded")).toBe("false")

  await collapsed.click()
  expect(await page.getByRole("button", { name: "恢复到此处" }).count()).toBe(1)
  await page.getByRole("button", { name: "恢复到此处" }).click()
  expect(await page.evaluate(() => (window as typeof window & { __postedMessages: unknown[] }).__postedMessages.at(-1))).toEqual({
    type: "unrevertSession",
    sessionID: "session_1",
  })

  await page.close()
})
