package com.sensetime.sensecode.jetbrains.raccoon

import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.actionSystem.DefaultActionGroup
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.util.TextRange

open class EditorSelectionAction internal constructor(
    private val action: String,
    private val send: (Project, String, FunctionContext) -> Unit = { project, action, context ->
        project.getService(RaccoonService::class.java).sendFunctionAction(action, context)
    },
) : AnAction(), DumbAware {
    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val editor = e.getData(CommonDataKeys.EDITOR) ?: return
        val file = FileDocumentManager.getInstance().getFile(editor.document) ?: return
        val context = captureFunctionContext(
            editor.document,
            TextRange(editor.selectionModel.selectionStart, editor.selectionModel.selectionEnd),
            projectRelativePath(project.basePath, file.path),
        ) ?: return
        send(project, action, context)
    }

    override fun update(e: AnActionEvent) {
        e.presentation.isEnabledAndVisible = hasEditorSelection(e)
    }

    override fun getActionUpdateThread() = ActionUpdateThread.EDT
}

class EditorSelectionActionGroup : DefaultActionGroup(), DumbAware {
    override fun update(e: AnActionEvent) {
        e.presentation.isEnabledAndVisible = hasEditorSelection(e)
    }

    override fun getActionUpdateThread() = ActionUpdateThread.EDT
}

private fun hasEditorSelection(e: AnActionEvent): Boolean =
    e.project != null &&
        e.getData(CommonDataKeys.EDITOR)?.selectionModel?.hasSelection() == true

class ExplainSelectionAction : EditorSelectionAction("EXPLAIN")

class FixSelectionAction : EditorSelectionAction("FIX")

class ImproveSelectionAction : EditorSelectionAction("IMPROVE")

class AddSelectionToContextAction : EditorSelectionAction("ADD_TO_CONTEXT")
