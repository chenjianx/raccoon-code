package com.sensetime.sensecode.jetbrains.raccoon.autocomplete

import com.intellij.openapi.actionSystem.DataContext
import com.intellij.openapi.editor.Caret
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.editor.actionSystem.EditorAction
import com.intellij.openapi.editor.actionSystem.EditorActionHandler

class CancelAutocompleteAction : EditorAction(Handler()) {
    private class Handler : EditorActionHandler() {
        override fun isEnabledForCaret(editor: Editor, caret: Caret, dataContext: DataContext): Boolean =
            editor.project
                ?.getService(RaccoonAutocompleteService::class.java)
                ?.hasSuggestion(editor, caret.offset) == true

        override fun doExecute(editor: Editor, caret: Caret?, dataContext: DataContext) {
            editor.project?.getService(RaccoonAutocompleteService::class.java)?.clear(editor)
        }
    }
}
