import { expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { LanguageProvider } from "../../../context/language"
import { SessionProvider } from "../../../context/session"
import { VSCodeProvider } from "../../../context/vscode"
import type { RaccoonMessagePart, RaccoonPermissionRequest } from "../../../protocol"
import { PermissionDock } from "./permission-dock"

test("explains the source, access, and persistent scope of an external directory request", () => {
  const request = {
    id: "permission_1",
    sessionID: "session_1",
    permission: "external_directory",
    patterns: ["/external/project/*"],
    metadata: { parentDir: "/external/project" },
    always: ["/external/project/*"],
    tool: { messageID: "msg_assistant", callID: "call_shell" },
  } satisfies RaccoonPermissionRequest
  const source = {
    id: "part_shell",
    callID: "call_shell",
    type: "tool",
    tool: "bash",
    status: "running",
    input: { command: "ls /external/project" },
  } as RaccoonMessagePart
  const html = renderToStaticMarkup(
    <VSCodeProvider>
      <LanguageProvider>
        <SessionProvider>
          <PermissionDock request={request} source={source} />
        </SessionProvider>
      </LanguageProvider>
    </VSCodeProvider>,
  )

  expect(html).toContain("触发操作")
  expect(html).not.toContain("用途")
  expect(html).toContain("执行命令：ls /external/project")
  expect(html).toContain("授权内容")
  expect(html).toContain("允许工具访问项目外的匹配路径；具体操作仍受对应工具权限控制")
  expect(html).toContain("始终允许范围")
  expect(html).toContain("/external/project/*")
  expect(html).toContain("对此范围始终允许")
})
