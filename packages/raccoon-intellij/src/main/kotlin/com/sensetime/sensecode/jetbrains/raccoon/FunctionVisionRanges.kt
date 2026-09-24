package com.sensetime.sensecode.jetbrains.raccoon

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.util.Key
import com.intellij.openapi.util.TextRange
import java.util.UUID

internal data class FunctionVisionSpan(val start: Int, val end: Int)

private data class FunctionVisionSnapshot(val stamp: Long, val ranges: List<TextRange>)
private data class PendingFunctionVisionRequest(
    val stamp: Long,
    val callbacks: MutableList<(List<TextRange>) -> Unit>,
)
private val SNAPSHOT_KEY = Key.create<FunctionVisionSnapshot>("raccoon.function.ranges")
private val PENDING_KEY = Key.create<PendingFunctionVisionRequest>("raccoon.function.pending")

internal object FunctionVisionRanges {
    private val supportedExtensions by lazy {
        javaClass.getResourceAsStream("/sidecar/extensions.txt")
            ?.bufferedReader()?.use { it.readLines() }?.filter { it.isNotBlank() }?.toSet() ?: emptySet()
    }

    fun supports(fileName: String) = supportedExtensions.any { fileName.lowercase().endsWith(it) }

    fun putSnapshot(editor: Editor, ranges: List<TextRange>) {
        editor.putUserData(SNAPSHOT_KEY, FunctionVisionSnapshot(editor.document.modificationStamp, ranges))
    }

    fun request(editor: Editor, fileName: String, onReady: (List<TextRange>) -> Unit) {
        if (!supports(fileName)) {
            onReady(emptyList())
            return
        }
        val project = editor.project ?: return
        val stamp = editor.document.modificationStamp
        editor.getUserData(SNAPSHOT_KEY)?.takeIf { it.stamp == stamp }?.let {
            onReady(it.ranges)
            return
        }
        synchronized(editor) {
            editor.getUserData(PENDING_KEY)?.takeIf { it.stamp == stamp }?.let {
                it.callbacks.add(onReady)
                return
            }
            editor.putUserData(PENDING_KEY, PendingFunctionVisionRequest(stamp, mutableListOf(onReady)))
        }

        val text = editor.document.text
        val requestID = UUID.randomUUID().toString()
        ApplicationManager.getApplication().executeOnPooledThread {
            val sent = project.getService(RaccoonService::class.java).requestFunctionRanges(requestID, fileName, text) { spans ->
                ApplicationManager.getApplication().invokeLater {
                    if (editor.isDisposed || project.isDisposed) return@invokeLater
                    val callbacks = synchronized(editor) {
                        editor.getUserData(PENDING_KEY)?.takeIf { it.stamp == stamp }?.also {
                            editor.putUserData(PENDING_KEY, null)
                        }?.callbacks.orEmpty()
                    }
                    if (spans == null || editor.document.modificationStamp != stamp) return@invokeLater
                    val ranges = spans.filter { it.start >= 0 && it.end > it.start && it.end <= editor.document.textLength }
                        .map { TextRange(it.start, it.end) }
                    putSnapshot(editor, ranges)
                    callbacks.forEach { it(ranges) }
                }
            }
            if (!sent) ApplicationManager.getApplication().invokeLater {
                if (!editor.isDisposed && editor.getUserData(PENDING_KEY)?.stamp == stamp) {
                    editor.putUserData(PENDING_KEY, null)
                }
            }
        }
    }
}
