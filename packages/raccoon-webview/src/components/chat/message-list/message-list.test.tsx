import { afterEach, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { LanguageProvider } from "../../../context/language"
import { SessionProvider } from "../../../context/session"
import { VSCodeProvider } from "../../../context/vscode"
import type { RaccoonMessage, RaccoonPermissionRequest, RaccoonState } from "../../../protocol"
import { MessageList } from "./message-list"

afterEach(() => {
  Reflect.deleteProperty(globalThis, "acquireVsCodeApi")
})

test("shows every queued permission tool as waiting instead of working", () => {
  const messages = [
    {
      id: "msg_assistant",
      role: "assistant",
      text: "",
      parts: [
        {
          id: "part_shell",
          callID: "call_shell",
          type: "tool",
          tool: "bash",
          status: "running",
          input: { command: "ls /external/project" },
        },
        {
          id: "part_read",
          callID: "call_read",
          type: "tool",
          tool: "read",
          status: "running",
          input: { filePath: "/external/project/README.md" },
        },
      ],
      createdAt: 1,
    },
  ] as RaccoonMessage[]
  const permission = {
    id: "permission_1",
    sessionID: "session_1",
    permission: "external_directory",
    patterns: ["/external/project/*"],
    metadata: { parentDir: "/external/project" },
    always: ["/external/project/*"],
    tool: { messageID: "msg_assistant", callID: "call_shell" },
  } satisfies RaccoonPermissionRequest
  const queuedPermission = {
    id: "permission_2",
    sessionID: "session_1",
    permission: "external_directory",
    patterns: ["/external/project/*"],
    metadata: { filepath: "/external/project/README.md", parentDir: "/external/project" },
    always: ["/external/project/*"],
    tool: { messageID: "msg_assistant", callID: "call_read" },
  } satisfies RaccoonPermissionRequest
  const state = {
    activeSessionID: "session_1",
    sessions: [{ id: "session_1", title: "Permission state", updatedAt: 1 }],
    messages,
    agents: [],
    models: [],
    providers: [],
    mode: "build",
    loading: true,
    busy: true,
  } satisfies RaccoonState

  Object.defineProperty(globalThis, "acquireVsCodeApi", {
    configurable: true,
    value: () => ({
      postMessage: () => {},
      getState: () => state,
      setState: () => {},
    }),
  })

  const html = renderToStaticMarkup(
    <VSCodeProvider>
      <LanguageProvider>
        <SessionProvider>
          <MessageList
            {...({ messages, busy: true, sessionID: "session_1", permissions: [permission, queuedPermission] } as Parameters<
              typeof MessageList
            >[0])}
          />
        </SessionProvider>
      </LanguageProvider>
    </VSCodeProvider>,
  )

  expect(html).toContain("等待你授权，授权后继续")
  expect(html).not.toContain("小浣熊正在处理")
  expect(html.match(/data-status="waiting_permission"/g)?.length).toBe(2)
  expect(html).not.toContain("执行中")
})
