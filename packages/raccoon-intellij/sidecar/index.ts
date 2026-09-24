import * as os from "node:os"
import * as path from "node:path"
import { getAutocompleteModel, RaccoonAutocompleteService, RaccoonProvider } from "@opencode-ai/raccoon-core"
import { SidecarAutocomplete } from "./autocomplete.js"
import { SidecarConnection } from "./connection.js"
import { sendFunctionAction } from "./function-actions.js"
import { createFunctionRangeExtractor } from "./function-ranges.js"
import { SidecarPlatform } from "./platform.js"
import { TerminalContextRequests } from "./terminal-context.js"
import { SidecarWebviewTransport } from "./transport.js"
import { createStdoutWriter, readStdin, type HostToSidecar } from "./rpc.js"

// Entry point for the Node sidecar that the IntelliJ plugin spawns. It assembles the same
// RaccoonProvider the VSCode extension uses (extension.ts), but wires its three ports to the
// Kotlin host over stdio instead of the vscode API. stdout carries framed RPC only; all human
// logging goes to stderr.

const send = createStdoutWriter(process.stdout)
const extractFunctionRanges = createFunctionRangeExtractor(path.join(__dirname, "grammars"), path.join(__dirname, "tree-sitter.wasm"))
const log = (message: string) => {
  process.stderr.write(message.endsWith("\n") ? message : message + "\n")
  send({ type: "log", message: message.trimEnd() })
}

function start(init: Extract<HostToSidecar, { type: "init" }>): (message: HostToSidecar) => void {
  const directory = init.directory || process.cwd()
  const storageDir = path.join(os.tmpdir(), "raccoon-intellij")

  const connection = new SidecarConnection(directory, log)
  const terminalRequests = new TerminalContextRequests(send)
  const platform = new SidecarPlatform({
    directory,
    locale: init.locale || "en",
    autocompleteEnabled: init.autocompleteEnabled ?? false,
    autocompleteModel: getAutocompleteModel(init.autocompleteModel ?? "").id,
    storageDir,
    log,
    onAutocompleteSettingsChange: (settings) => send({ type: "autocompleteSettings", ...settings }),
    requestTerminalContext: () => terminalRequests.capture(),
    openFile: (filePath, directory, line, column) => send({ type: "openFile", filePath, directory, line, column }),
  })
  const autocomplete = new SidecarAutocomplete(
    new RaccoonAutocompleteService(connection, directory, platform.settings.getAutocompleteModel(), { log }),
    send,
    { connection, settings: platform.settings },
  )
  const transport = new SidecarWebviewTransport(send, () => autocomplete.resetBackoff())

  const provider = new RaccoonProvider(connection, platform, transport)

  // Surface the server port to the host once connected so the JCEF webview's CSP can allow
  // direct connections to server-served media (parity with VSCode's port injection).
  connection.onStateChange((state) => {
    if (state === "connected") send({ type: "serverPort", port: connection.getServerConfig()?.port ?? null })
  })

  // Connect eagerly so the server is warming up before the user sends the first message.
  void connection.connect(directory).catch((error) => log(`initial backend connect failed: ${String(error)}`))

  send({ type: "ready", pluginLanguage: provider.getState().pluginLanguage ?? "en" })

  return (message: HostToSidecar) => {
    switch (message.type) {
      case "webviewMessage":
        // Every webview message (including webviewReady) flows through the provider's handler,
        // which owns readiness gating + state refresh. See RaccoonMessageRouter.handle.
        transport.dispatch(message.message, message.source)
        break
      case "autocompleteComplete":
        autocomplete.complete(message.requestID, message.input)
        break
      case "autocompleteCancel":
        autocomplete.cancel(message.requestID)
        break
      case "autocompleteAccept":
        autocomplete.accept(message.completion, message.filepath)
        break
      case "terminalContextResult":
        terminalRequests.receive(message)
        break
      case "functionAction":
        void sendFunctionAction(provider, transport, message.action, message.context).catch((error) =>
          log(`function action failed: ${String(error)}`),
        )
        break
      case "functionRanges":
        void extractFunctionRanges(message.fileName, message.text).then((ranges) =>
          send({ type: "functionRangesResult", requestID: message.requestID, ranges }),
        )
        break
      case "dispose":
        terminalRequests.dispose()
        autocomplete.dispose()
        provider.dispose()
        connection.dispose()
        process.exit(0)
        break
      case "init":
        // already initialized; ignore duplicate init
        break
    }
  }
}

// Single stdin reader: buffers until the host's init frame (workspace dir + locale), then
// hands subsequent frames to the running provider loop.
let running: ((message: HostToSidecar) => void) | null = null
readStdin(process.stdin, (message) => {
  if (running) {
    running(message)
    return
  }
  if (message.type === "init") running = start(message)
})
