package com.sensetime.sensecode.jetbrains.raccoon

import com.google.gson.Gson
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.Service
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.fileEditor.OpenFileDescriptor
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowManager
import com.intellij.ui.content.ContentFactory
import com.sensetime.sensecode.jetbrains.raccoon.autocomplete.RaccoonAutocompleteSettings
import com.sensetime.sensecode.jetbrains.raccoon.autocomplete.RaccoonAutocompleteService
import java.io.File
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong

/**
 * Project-scoped owner of the Raccoon sidecar + webview surface. Spawns the Node sidecar, builds
 * the JCEF webview, and routes messages between them following the stdio RPC protocol in rpc.ts.
 *
 * There is a single "chat" webview surface. Unlike the VSCode host (which opens settings in a
 * separate editor panel), settings and history both render inline in this one webview, driven by
 * `showSettings`/`showHistory`/`showChat` messages from the sidecar's provider.
 *
 * Created lazily by [RaccoonToolWindowFactory]; disposed with the project.
 */
@Service(Service.Level.PROJECT)
class RaccoonService(private val project: Project) : Disposable {
    private val log = logger<RaccoonService>()
    private val gson = Gson()
    private val autocompleteCallbacks = AutocompleteCallbacks { log.warn("autocomplete request failed", it) }
    private val functionRangeCallbacks = ConcurrentHashMap<String, (List<FunctionVisionSpan>?) -> Unit>()
    private val autocompleteRevision = AtomicLong()
    val autocompleteEpoch: Long
        get() = autocompleteRevision.get()
    private val webviewReady = WebviewReadyState()
    private var chatWebview: RaccoonWebview? = null
    @Volatile
    private var sidecar: SidecarProcess? = null
    private var sidecarGeneration: Any? = null
    private var serverPort: Int? = null
    @Volatile
    private var disposed = false

    private var toolWindow: ToolWindow? = null

    /** Last chat-mode seen in a state frame; used when creating a session (parity with the webview). */
    @Volatile
    private var currentMode: String = "build"
    @Volatile
    private var currentPluginLanguage: String = Locale.getDefault().toLanguageTag()

    internal fun functionActionLocale(): Locale = Locale.forLanguageTag(currentPluginLanguage)

    /** Called by the tool window factory: build the chat surface and wire actions. */
    fun initToolWindow(toolWindow: ToolWindow) {
        this.toolWindow = toolWindow

        val view = RaccoonWebview(source = "chat", onWebviewMessage = { onWebviewMessage("chat", it) })
        Disposer.register(this, view)
        chatWebview = view

        val content = ContentFactory.getInstance().createContent(view.component, "", false)
        toolWindow.contentManager.addContent(content)

        toolWindow.setTitleActions(
            listOf(
                NewSessionAction(project),
                HistoryAction(project),
                SettingsAction(project),
            )
        )

        dispatchSidecarWork(
            execute = { ApplicationManager.getApplication().executeOnPooledThread(it) },
            start = {
                runCatching { ensureStarted() }
                    .onFailure { log.warn("failed to start Raccoon sidecar from Tool Window", it) }
                    .getOrDefault(false)
            },
            work = {},
        )
    }

    /** Starts the shared sidecar once, independently of whether the Tool Window has been opened. */
    @Synchronized
    fun ensureStarted(): Boolean {
        if (disposed) return false
        if (sidecar != null) return true

        val plugin = runCatching { RaccoonPaths.resolve() }
            .onFailure { log.warn("failed to resolve Raccoon sidecar resources", it) }
            .getOrNull()
            ?: return false
        val generation = Any()
        val proc = SidecarProcess(
            nodePath = plugin.nodePath,
            sidecarCjs = plugin.sidecarCjs,
            workingDir = project.basePath ?: System.getProperty("user.dir"),
            raccoonBin = plugin.raccoonBin,
            onMessage = ::onSidecarMessage,
            onTerminated = { onSidecarTerminated(generation) },
        )
        sidecar = proc
        sidecarGeneration = generation
        val startFailure = runCatching { proc.start() }.exceptionOrNull()
        if (startFailure != null) {
            sidecar = null
            sidecarGeneration = null
            runCatching { proc.dispose() }
                .onFailure { log.warn("failed to dispose Raccoon sidecar after startup failure", it) }
            log.warn("failed to start Raccoon sidecar", startFailure)
            return false
        }
        if (sidecarGeneration !== generation) return false

        val settings = project.getService(RaccoonAutocompleteSettings::class.java)
        val initialized = proc.send(gson.toJson(JsonObject().apply {
            addProperty("type", "init")
            addProperty("directory", project.basePath ?: System.getProperty("user.dir"))
            addProperty("locale", java.util.Locale.getDefault().toLanguageTag())
            addProperty("autocompleteEnabled", settings.enabled)
            addProperty("autocompleteModel", settings.model)
        }))
        if (!initialized) {
            discardSidecar(generation, proc, "failed to initialize Raccoon sidecar")
            return false
        }
        if (!webviewReady.replay { proc.send(gson.toJson(it)) }) {
            discardSidecar(generation, proc, "failed to replay Raccoon Webview readiness")
            return false
        }
        return true
    }

    fun requestAutocomplete(requestID: String, input: JsonObject, callback: (String?) -> Unit) {
        autocompleteCallbacks.request(
            requestID = requestID,
            callback = callback,
            start = ::ensureStarted,
            send = {
                val proc = synchronized(this) { sidecar }
                proc?.send(gson.toJson(JsonObject().apply {
                    addProperty("type", "autocompleteComplete")
                    addProperty("requestID", requestID)
                    add("input", input)
                })) == true
            },
        )
    }

    fun cancelAutocomplete(requestID: String) {
        autocompleteCallbacks.cancel(requestID)
        val proc = synchronized(this) { sidecar }
        proc?.send(gson.toJson(JsonObject().apply {
            addProperty("type", "autocompleteCancel")
            addProperty("requestID", requestID)
        }))
    }

    fun acceptAutocomplete(completion: String, filepath: String) {
        sidecar?.send(gson.toJson(JsonObject().apply {
            addProperty("type", "autocompleteAccept")
            addProperty("completion", completion)
            addProperty("filepath", filepath)
        }))
    }

    internal fun sendFunctionAction(action: String, context: FunctionContext) {
        ToolWindowManager.getInstance(project).getToolWindow("Raccoon")?.show()
        val message = gson.toJson(JsonObject().apply {
            addProperty("type", "functionAction")
            addProperty("action", action)
            add("context", gson.toJsonTree(context))
        })
        dispatchSidecarWork(
            execute = { ApplicationManager.getApplication().executeOnPooledThread(it) },
            start = {
                runCatching { ensureStarted() }
                    .onFailure { log.warn("failed to start Raccoon sidecar for editor action", it) }
                    .getOrDefault(false)
            },
            work = { sidecar?.send(message) },
        )
    }

    internal fun requestFunctionRanges(
        requestID: String,
        fileName: String,
        text: String,
        callback: (List<FunctionVisionSpan>?) -> Unit,
    ): Boolean {
        if (!ensureStarted()) return false
        functionRangeCallbacks[requestID] = callback
        val sent = sidecar?.send(gson.toJson(JsonObject().apply {
            addProperty("type", "functionRanges")
            addProperty("requestID", requestID)
            addProperty("fileName", fileName)
            addProperty("text", text)
        })) == true
        if (!sent) functionRangeCallbacks.remove(requestID)
        return sent
    }

    // ---- Title-bar action entry points (parity with VSCode's view/title toolbar) ----

    /** Start a fresh session in the chat surface. Mode mirrors the webview's own New Session button. */
    fun newSession() {
        sendChatMessage("""{"type":"createSession","mode":"${currentMode.jsonEscaped()}"}""")
    }

    /** Switch the chat surface to the history list (rendered inline via `showHistory`). */
    fun openHistory() {
        sendChatMessage("""{"type":"openHistory"}""")
    }

    /** Switch the chat surface to settings (rendered inline via `showSettings`, like history). */
    fun openSettings() {
        sendChatMessage("""{"type":"openSettings"}""")
    }

    private fun sendChatMessage(messageJson: String) {
        sidecar?.send("""{"type":"webviewMessage","source":"chat","message":$messageJson}""")
    }

    /** webview -> host: forward every message through the sidecar tagged with its surface source. */
    private fun onWebviewMessage(source: String, json: String) {
        val message = runCatching { JsonParser.parseString(json).asJsonObject }.getOrNull() ?: return
        webviewReady.forward(source, message) { frame ->
            sidecar?.send(gson.toJson(frame)) == true
        }
    }

    /** sidecar -> host: handle lifecycle frames; relay `post` payloads into the chat surface. */
    internal fun onSidecarMessage(json: String) {
        val obj = runCatching { JsonParser.parseString(json).asJsonObject }.getOrNull() ?: return
        when (obj.get("type")?.asString) {
            "post" -> {
                val message = obj.get("message") ?: return
                trackState(message)
                ApplicationManager.getApplication().invokeLater {
                    chatWebview?.postToWebview(message.toString())
                }
            }
            "serverPort" -> {
                serverPort = obj.get("port")?.takeIf { !it.isJsonNull }?.asInt
                log.info("Raccoon server port: $serverPort")
            }
            "autocompleteResult" -> {
                val requestID = obj.get("requestID")?.asString ?: return
                val completion = obj.get("completion")?.takeIf { !it.isJsonNull }?.asString
                autocompleteCallbacks.complete(requestID, completion)
            }
            "autocompleteSettings" -> {
                val settings = project.getService(RaccoonAutocompleteSettings::class.java)
                val previousModel = settings.model
                obj.get("enabled")?.takeIf { !it.isJsonNull }?.asBoolean?.let { settings.enabled = it }
                obj.get("model")?.takeIf { !it.isJsonNull }?.asString?.let { settings.model = it }
                if (!settings.enabled || settings.model != previousModel) invalidateAutocomplete()
            }
            "captureTerminal" -> {
                val requestID = obj.get("requestID")?.asString ?: return
                val proc = sidecar ?: return
                ApplicationManager.getApplication().invokeLater {
                    if (disposed || project.isDisposed || sidecar !== proc) return@invokeLater
                    val snapshot = runCatching { captureTerminal(project) }
                        .onFailure { log.warn("failed to capture terminal output", it) }
                        .getOrNull()
                    proc.send(gson.toJson(JsonObject().apply {
                        addProperty("type", "terminalContextResult")
                        addProperty("requestID", requestID)
                        snapshot?.let {
                            addProperty("name", it.name)
                            addProperty("output", it.output)
                        }
                    }))
                }
            }
            "openFile" -> {
                val filePath = obj.get("filePath")?.asString ?: return
                val directory = obj.get("directory")?.asString ?: return
                val line = obj.get("line")?.takeIf { !it.isJsonNull }?.asInt
                val column = obj.get("column")?.takeIf { !it.isJsonNull }?.asInt
                ApplicationManager.getApplication().invokeLater {
                    if (disposed || project.isDisposed) return@invokeLater
                    val file = LocalFileSystem.getInstance().refreshAndFindFileByIoFile(resolveLinkedFile(filePath, directory))
                    if (file == null || file.isDirectory) {
                        log.warn("File not found: $filePath")
                        return@invokeLater
                    }
                    OpenFileDescriptor(project, file, (line ?: 1).coerceAtLeast(1) - 1, (column ?: 1).coerceAtLeast(1) - 1)
                        .navigate(true)
                }
            }
            "functionRangesResult" -> {
                val requestID = obj.get("requestID")?.asString ?: return
                val spans = obj.getAsJsonArray("ranges")?.mapNotNull { item ->
                    val range = item.asJsonObject
                    val start = range.get("start")?.asInt ?: return@mapNotNull null
                    val end = range.get("end")?.asInt ?: return@mapNotNull null
                    FunctionVisionSpan(start, end)
                } ?: emptyList()
                functionRangeCallbacks.remove(requestID)?.invoke(spans)
            }
            "log" -> log.info("[sidecar] ${obj.get("message")?.asString}")
            "ready" -> {
                obj.get("pluginLanguage")?.takeIf { !it.isJsonNull }?.asString?.let { currentPluginLanguage = it }
                log.info("Raccoon sidecar ready")
            }
        }
    }

    private fun onSidecarTerminated(generation: Any) {
        val notifyFailure = synchronized(this) {
            if (sidecarGeneration !== generation) return
            sidecar = null
            sidecarGeneration = null
            invalidateAutocomplete()
            autocompleteCallbacks.takeFailureNotification()
        }
        notifyFailure()
        failFunctionRangeCallbacks()
    }

    private fun invalidateAutocomplete() {
        // Advance before scheduling EDT cleanup so an already queued result cannot render first.
        val epoch = autocompleteRevision.incrementAndGet()
        ApplicationManager.getApplication().invokeLater {
            if (disposed || project.isDisposed) return@invokeLater
            project.getServiceIfCreated(RaccoonAutocompleteService::class.java)?.invalidateBefore(epoch)
        }
    }

    /** Keep native editor actions in sync with the webview's effective language and chat mode. */
    private fun trackState(message: com.google.gson.JsonElement) {
        val obj = message as? com.google.gson.JsonObject ?: return
        if (obj.get("type")?.asString != "state") return
        val state = obj.getAsJsonObject("state") ?: return
        state.get("mode")?.takeIf { !it.isJsonNull }?.asString?.let { currentMode = it }
        state.get("pluginLanguage")?.takeIf { !it.isJsonNull }?.asString?.let { currentPluginLanguage = it }
    }

    override fun dispose() {
        val proc = synchronized(this) {
            if (disposed) return
            disposed = true
            val current = sidecar
            sidecar = null
            sidecarGeneration = null
            current
        }
        proc?.dispose()
        autocompleteCallbacks.failAll()
        failFunctionRangeCallbacks()
        chatWebview = null
        toolWindow = null
    }

    private fun discardSidecar(generation: Any, proc: SidecarProcess, message: String) {
        if (sidecarGeneration === generation) {
            sidecar = null
            sidecarGeneration = null
        }
        log.warn(message)
        runCatching { proc.dispose() }
            .onFailure { log.warn("failed to dispose unusable Raccoon sidecar", it) }
    }

    private fun failFunctionRangeCallbacks() {
        functionRangeCallbacks.entries.toList().forEach { entry ->
            if (functionRangeCallbacks.remove(entry.key, entry.value)) entry.value(null)
        }
    }
}

private fun resolveLinkedFile(filePath: String, directory: String): File {
    val file = File(filePath)
    if (file.isAbsolute) return file
    val relative = filePath.replace('\\', '/').removePrefix("./")
    val directoryParts = directory.replace('\\', '/').split('/').filter { it.isNotEmpty() }
    val fileParts = relative.split('/').filter { it.isNotEmpty() }
    val overlap = (fileParts.size - 1 downTo 1).firstOrNull { length ->
        length <= directoryParts.size && fileParts.take(length) == directoryParts.takeLast(length)
    } ?: 0
    return File(directory, if (overlap > 0) fileParts.drop(overlap).joinToString("/") else relative)
}

internal fun dispatchSidecarWork(
    execute: (Runnable) -> Unit,
    start: () -> Boolean,
    work: () -> Unit,
) {
    execute(Runnable {
        if (!start()) return@Runnable
        work()
    })
}

/** Resolves the bundled sidecar.cjs, a `node` runtime, and the opencode binary at runtime. */
private object RaccoonPaths {
    private val log = logger<RaccoonService>()
    data class Resolved(val nodePath: String, val sidecarCjs: String, val raccoonBin: String?)

    fun resolve(): Resolved {
        // sidecar.cjs ships as a plugin resource on the classpath. node can't execute a script
        // inside a jar, so extract it (and its sourcemap) to a stable temp dir on first use.
        val sidecar = extractResource("/sidecar/sidecar.cjs", "sidecar.cjs")
        runCatching { extractResource("/sidecar/sidecar.cjs.map", "sidecar.cjs.map") }
        extractResource("/sidecar/tree-sitter.wasm", "tree-sitter.wasm")
        val grammars = javaClass.getResourceAsStream("/sidecar/grammars.txt")
            ?.bufferedReader()?.use { it.readLines() } ?: error("missing Tree-sitter grammar manifest")
        grammars.filter { it.isNotBlank() }.forEach { grammar ->
            extractResource("/sidecar/grammars/$grammar", "grammars/$grammar")
        }
        val target = currentTarget()
        val binaryName = if (target.startsWith("win32-")) "raccoon.exe" else "raccoon"
        val raccoonBin = runCatching {
            extractResource("/bin/$target/$binaryName", binaryName)
        }
            .getOrNull()
            ?.takeIf { isRunnableForCurrentPlatform(File(it)) }
        val node = System.getenv("RACCOON_NODE")?.takeIf { File(it).exists() } ?: findNode()
        return Resolved(node, sidecar, raccoonBin)
    }

    private fun isRunnableForCurrentPlatform(file: File): Boolean {
        if (!file.isFile || !file.canExecute()) return false
        val header = runCatching { file.inputStream().use { it.readNBytes(4) } }.getOrNull() ?: return false
        val os = System.getProperty("os.name").lowercase()
        return when {
            os.contains("win") -> header.size >= 2 && header[0] == 'M'.code.toByte() && header[1] == 'Z'.code.toByte()
            os.contains("mac") -> header.contentEquals(byteArrayOf(0xFE.toByte(), 0xED.toByte(), 0xFA.toByte(), 0xCE.toByte())) ||
                header.contentEquals(byteArrayOf(0xFE.toByte(), 0xED.toByte(), 0xFA.toByte(), 0xCF.toByte())) ||
                header.contentEquals(byteArrayOf(0xCE.toByte(), 0xFA.toByte(), 0xED.toByte(), 0xFE.toByte())) ||
                header.contentEquals(byteArrayOf(0xCF.toByte(), 0xFA.toByte(), 0xED.toByte(), 0xFE.toByte()))
            else -> header.contentEquals(byteArrayOf(0x7F, 'E'.code.toByte(), 'L'.code.toByte(), 'F'.code.toByte()))
        }
    }

    private fun currentTarget(): String {
        val os = System.getProperty("os.name").lowercase()
        val platform = when {
            os.contains("win") -> "win32"
            os.contains("mac") -> "darwin"
            else -> "linux"
        }
        val arch = when (System.getProperty("os.arch").lowercase()) {
            "aarch64", "arm64" -> "arm64"
            else -> "x64"
        }
        val abi = if (platform == "linux" && isMusl()) "-musl" else ""
        return "$platform-$arch$abi"
    }

    private fun isMusl(): Boolean {
        if (File("/etc/alpine-release").exists()) return true
        return runCatching {
            ProcessBuilder("ldd", "--version")
                .redirectErrorStream(true)
                .start()
                .inputStream
                .bufferedReader()
                .use { it.readText() }
                .contains("musl", ignoreCase = true)
        }.getOrDefault(false)
    }

    private fun extractResource(resourcePath: String, fileName: String): String {
        val input = javaClass.getResourceAsStream(resourcePath)
            ?: error("missing plugin resource: $resourcePath")
        val dir = File(System.getProperty("java.io.tmpdir"), "raccoon-intellij-sidecar").apply { mkdirs() }
        val target = File(dir, fileName)
        target.parentFile.mkdirs()
        input.use { stream -> target.outputStream().use { stream.copyTo(it) } }
        if (resourcePath.startsWith("/bin/")) target.setExecutable(true)
        return target.absolutePath
    }

    private fun findNode(): String {
        // Resolve `node` against the login-shell PATH (IntelliJ launched from Finder has a minimal
        // PATH; this picks up nvm/homebrew installs the way the terminal would).
        com.intellij.execution.configurations.PathEnvironmentVariableUtil.findInPath("node")
            ?.let { return it.absolutePath }
        val candidates = listOf("/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node")
        candidates.firstOrNull { File(it).exists() }?.let { return it }
        log.info("node not found in PATH or common locations; falling back to bare 'node'")
        return "node"
    }
}

private fun String.jsonEscaped(): String =
    replace("\\", "\\\\").replace("\"", "\\\"")
