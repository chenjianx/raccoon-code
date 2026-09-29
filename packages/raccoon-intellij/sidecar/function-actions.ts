import type { EditorContext, EditorContextAction } from "@opencode-ai/raccoon-core"

export async function sendFunctionAction(
  provider: {
    getState(): { activeSessionID?: string }
    refresh(): Promise<void>
    sendCapturedEditorContext(action: EditorContextAction, context: EditorContext): Promise<void>
    appendCapturedEditorContext(context: EditorContext): Promise<void>
  },
  transport: { post(source: "chat", message: { type: "showChat" }): void },
  action: EditorContextAction,
  context: EditorContext,
): Promise<void> {
  transport.post("chat", { type: "showChat" })
  if (action === "ADD_TO_CONTEXT") {
    await provider.appendCapturedEditorContext(context)
    return
  }
  if (!provider.getState().activeSessionID) await provider.refresh()
  await provider.sendCapturedEditorContext(action, context)
}
