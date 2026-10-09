package com.sensetime.sensecode.jetbrains.raccoon.autocomplete

import com.google.gson.JsonObject
import com.intellij.codeInsight.lookup.LookupManager
import com.intellij.injected.editor.DocumentWindow
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ReadAction
import com.intellij.openapi.command.WriteCommandAction
import com.intellij.openapi.components.Service
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.editor.EditorKind
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.project.Project
import com.sensetime.sensecode.jetbrains.raccoon.RaccoonService
import java.util.Locale
import java.util.UUID

data class PendingAutocomplete(
    val requestID: String,
    val editor: Editor,
    val documentStamp: Long,
    val caretOffset: Int,
    val replaceEndOffset: Int,
    val filepath: String,
    val displayText: String?,
    val insertText: String?,
    val epoch: Long,
)

@Service(Service.Level.PROJECT)
class RaccoonAutocompleteService(private val project: Project) : Disposable {
    private val log = logger<RaccoonAutocompleteService>()
    private val settings = project.getService(RaccoonAutocompleteSettings::class.java)
    private val raccoonService = project.getService(RaccoonService::class.java)
    private var pending: PendingAutocomplete? = null
    private var accepting = false

    val isAccepting: Boolean
        get() = accepting

    fun trigger(editor: Editor) {
        if (accepting) return
        clear()
        if (!settings.enabled) return
        if (!canRequest(editor)) return
        val epoch = raccoonService.autocompleteEpoch

        val snapshot = runCatching {
            ReadAction.compute<AutocompleteSnapshot?, RuntimeException> {
                val caret = editor.caretModel.primaryCaret
                val document = editor.document
                val virtualFile = FileDocumentManager.getInstance().getFile(document)
                    ?: return@compute null
                val caretOffset = caret.offset
                val line = document.getLineNumber(caretOffset)
                AutocompleteSnapshot(
                    documentText = document.immutableCharSequence.toString(),
                    documentStamp = document.modificationStamp,
                    caretOffset = caretOffset,
                    lineEndOffset = document.getLineEndOffset(line),
                    line = line,
                    character = autocompleteProtocolCharacter(caretOffset, document.getLineStartOffset(line)),
                    filepath = virtualFile.path,
                    languageID = virtualFile.fileType.name.lowercase(Locale.ROOT),
                )
            }
        }
            .onFailure { log.warn("failed to capture Raccoon autocomplete snapshot", it) }
            .getOrNull()
            ?: return
        val requestID = UUID.randomUUID().toString()
        pending = PendingAutocomplete(
            requestID = requestID,
            editor = editor,
            documentStamp = snapshot.documentStamp,
            caretOffset = snapshot.caretOffset,
            replaceEndOffset = snapshot.lineEndOffset,
            filepath = snapshot.filepath,
            displayText = null,
            insertText = null,
            epoch = epoch,
        )
        raccoonService.requestAutocomplete(requestID, snapshot.toInput(requestID)) { completion ->
            ApplicationManager.getApplication().invokeLater {
                receive(requestID, editor, completion)
            }
        }
    }

    fun hasSuggestion(editor: Editor, caretOffset: Int): Boolean {
        val current = pending ?: return false
        if (current.editor !== editor) return false
        if (!settings.enabled || current.epoch != raccoonService.autocompleteEpoch ||
            editor.isDisposed || LookupManager.getActiveLookup(editor) != null
        ) {
            clear(editor)
            return false
        }
        return !accepting &&
            current.editor === editor &&
            !editor.isDisposed &&
            editor.caretModel.caretCount == 1 &&
            !editor.selectionModel.hasSelection() &&
            current.caretOffset == caretOffset &&
            current.documentStamp == editor.document.modificationStamp &&
            current.displayText?.isNotEmpty() == true &&
            current.insertText?.isNotEmpty() == true
    }

    fun accept(editor: Editor) {
        val current = pending ?: return
        if (!hasSuggestion(editor, editor.caretModel.offset)) {
            clear(editor)
            return
        }
        val insertText = current.insertText ?: return
        if (current.replaceEndOffset > editor.document.textLength) {
            clear(editor)
            return
        }

        accepting = true
        val result = runCatching {
            WriteCommandAction.runWriteCommandAction(project, Runnable {
                editor.document.replaceString(current.caretOffset, current.replaceEndOffset, insertText)
                editor.caretModel.moveToOffset(current.caretOffset + insertText.length)
            })
        }
        if (result.isSuccess) {
            raccoonService.acceptAutocomplete(insertText, current.filepath)
        } else {
            log.warn("failed to accept Raccoon autocomplete", result.exceptionOrNull())
        }
        removeRaccoonInlays(editor)
        pending = null
        ApplicationManager.getApplication().invokeLater { accepting = false }
    }

    fun clear(editor: Editor? = null) {
        val current = pending
        val target = editor ?: current?.editor
        if (target != null && !target.isDisposed) removeRaccoonInlays(target)
        if (current == null || editor != null && current.editor !== editor) return
        pending = null
        raccoonService.cancelAutocomplete(current.requestID)
    }

    fun invalidateBefore(epoch: Long) {
        ApplicationManager.getApplication().assertIsDispatchThread()
        if ((pending?.epoch ?: return) < epoch) clear()
    }

    override fun dispose() {
        clear()
    }

    private fun canRequest(editor: Editor): Boolean {
        if (project.isDisposed || editor.isDisposed || editor.isViewer || editor.project !== project) return false
        if (editor.editorKind != EditorKind.MAIN_EDITOR) return false
        if (editor.caretModel.caretCount != 1 || editor.selectionModel.hasSelection()) return false
        if (editor.document is DocumentWindow) return false
        if (LookupManager.getActiveLookup(editor) != null) return false
        return FileDocumentManager.getInstance().getFile(editor.document) != null
    }

    private fun receive(requestID: String, editor: Editor, completion: String?) {
        val current = pending ?: return
        if (current.requestID != requestID || current.editor !== editor) return
        if (!settings.enabled || current.epoch != raccoonService.autocompleteEpoch ||
            LookupManager.getActiveLookup(editor) != null
        ) {
            clear(editor)
            return
        }
        if (editor.isDisposed || current.documentStamp != editor.document.modificationStamp) {
            pending = null
            return
        }
        if (current.caretOffset != editor.caretModel.offset || completion == null) {
            pending = null
            return
        }
        val plan = planAutocomplete(
            editor.document.immutableCharSequence.toString(),
            current.caretOffset,
            current.replaceEndOffset,
            completion,
        ) ?: run {
            pending = null
            return
        }
        RaccoonInlayRenderer.render(editor, current.caretOffset, plan.displayText)
        pending = current.copy(
            replaceEndOffset = plan.replaceEndOffset,
            displayText = plan.displayText,
            insertText = plan.insertText,
        )
    }

    private fun removeRaccoonInlays(editor: Editor) {
        val endOffset = editor.document.textLength
        editor.inlayModel.getInlineElementsInRange(0, endOffset)
            .filter { it.renderer is RaccoonInlayRenderer }
            .forEach { it.dispose() }
        editor.inlayModel.getBlockElementsInRange(0, endOffset)
            .filter { it.renderer is RaccoonInlayRenderer }
            .forEach { it.dispose() }
    }
}

private data class AutocompleteSnapshot(
    val documentText: String,
    val documentStamp: Long,
    val caretOffset: Int,
    val lineEndOffset: Int,
    val line: Int,
    val character: Int,
    val filepath: String,
    val languageID: String,
) {
    fun toInput(completionID: String) = JsonObject().apply {
        addProperty("completionId", completionID)
        addProperty("filepath", filepath)
        addProperty("languageId", languageID)
        add("pos", JsonObject().apply {
            addProperty("line", line)
            addProperty("character", character)
        })
        addProperty("fileContents", documentText)
        addProperty("isUntitledFile", false)
    }
}
