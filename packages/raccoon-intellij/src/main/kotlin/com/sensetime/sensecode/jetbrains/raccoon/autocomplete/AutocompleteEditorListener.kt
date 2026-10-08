package com.sensetime.sensecode.jetbrains.raccoon.autocomplete

import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.editor.EditorKind
import com.intellij.openapi.editor.event.CaretEvent
import com.intellij.openapi.editor.event.CaretListener
import com.intellij.openapi.editor.event.DocumentEvent
import com.intellij.openapi.editor.event.DocumentListener
import com.intellij.openapi.editor.event.EditorFactoryEvent
import com.intellij.openapi.editor.event.EditorFactoryListener
import com.intellij.openapi.editor.event.EditorMouseEvent
import com.intellij.openapi.editor.event.EditorMouseListener
import com.intellij.openapi.editor.event.SelectionEvent
import com.intellij.openapi.editor.event.SelectionListener
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.fileEditor.FileEditorManagerEvent
import com.intellij.openapi.fileEditor.FileEditorManagerListener
import com.intellij.openapi.fileEditor.TextEditor
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.util.Key
import com.sensetime.sensecode.jetbrains.raccoon.FunctionActionInlayRenderer
import com.sensetime.sensecode.jetbrains.raccoon.FunctionActionInlays
import javax.swing.SwingUtilities

private val LISTENERS_KEY = Key.create<Disposable>("raccoon.autocomplete.editor.listeners")

class AutocompleteEditorListener : EditorFactoryListener {
    override fun editorCreated(event: EditorFactoryEvent) {
        val editor = event.editor
        val project = editor.project ?: return
        if (editor.editorKind != EditorKind.MAIN_EDITOR || project.isDisposed) return
        if (editor.getUserData(LISTENERS_KEY) != null) return

        project.getService(AutocompleteLookupListener::class.java)
        val service = project.getService(RaccoonAutocompleteService::class.java)
        val listeners = Disposer.newDisposable("Raccoon autocomplete editor listeners")
        editor.putUserData(LISTENERS_KEY, listeners)
        Disposer.register(project, listeners)
        Disposer.register(listeners) { editor.putUserData(LISTENERS_KEY, null) }
        ApplicationManager.getApplication().invokeLater {
            if (!project.isDisposed && !editor.isDisposed) FunctionActionInlays.refresh(editor)
        }

        editor.document.addDocumentListener(object : DocumentListener {
            override fun documentChanged(event: DocumentEvent) {
                ApplicationManager.getApplication().invokeLater {
                    if (project.isDisposed || editor.isDisposed) return@invokeLater
                    FunctionActionInlays.refresh(editor)
                    if (FileEditorManager.getInstance(project).selectedTextEditor !== editor) return@invokeLater
                    service.trigger(editor)
                }
            }
        }, listeners)
        editor.addEditorMouseListener(object : EditorMouseListener {
            override fun mouseClicked(event: EditorMouseEvent) {
                if (!SwingUtilities.isLeftMouseButton(event.mouseEvent)) return
                val inlay = event.inlay ?: return
                val renderer = inlay.renderer as? FunctionActionInlayRenderer ?: return
                val bounds = inlay.bounds ?: return
                if (!renderer.containsX(event.mouseEvent.x - bounds.x)) return
                FunctionActionInlays.handleClick(editor, renderer, bounds)
                event.consume()
            }
        }, listeners)
        editor.caretModel.addCaretListener(object : CaretListener {
            override fun caretPositionChanged(event: CaretEvent) {
                clearSuggestion()
            }

            override fun caretAdded(event: CaretEvent) {
                clearSuggestion()
            }

            override fun caretRemoved(event: CaretEvent) {
                clearSuggestion()
            }

            private fun clearSuggestion() {
                if (!service.isAccepting) service.clear(editor)
            }
        }, listeners)
        editor.selectionModel.addSelectionListener(object : SelectionListener {
            override fun selectionChanged(event: SelectionEvent) {
                if (!service.isAccepting) service.clear(editor)
            }
        }, listeners)
        project.messageBus.connect(listeners).subscribe(
            FileEditorManagerListener.FILE_EDITOR_MANAGER,
            object : FileEditorManagerListener {
                override fun selectionChanged(event: FileEditorManagerEvent) {
                    if ((event.oldEditor as? TextEditor)?.editor === editor) service.clear(editor)
                    if ((event.newEditor as? TextEditor)?.editor === editor) FunctionActionInlays.refresh(editor)
                }
            },
        )
    }

    override fun editorReleased(event: EditorFactoryEvent) {
        val editor = event.editor
        val project = editor.project
        if (project != null && !project.isDisposed) {
            project.getService(RaccoonAutocompleteService::class.java).clear(editor)
        }
        FunctionActionInlays.clear(editor)
        editor.getUserData(LISTENERS_KEY)?.let(Disposer::dispose)
        editor.putUserData(LISTENERS_KEY, null)
    }
}
