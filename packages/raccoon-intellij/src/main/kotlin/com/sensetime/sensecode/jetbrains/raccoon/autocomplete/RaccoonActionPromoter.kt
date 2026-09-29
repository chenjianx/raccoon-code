package com.sensetime.sensecode.jetbrains.raccoon.autocomplete

import com.intellij.openapi.actionSystem.ActionPromoter
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.actionSystem.DataContext

class RaccoonActionPromoter : ActionPromoter {
    override fun promote(actions: List<AnAction>, context: DataContext): List<AnAction>? {
        val accepts = actions.filterIsInstance<AcceptAutocompleteAction>()
        if (accepts.isEmpty()) return null
        val editor = CommonDataKeys.EDITOR.getData(context) ?: return null
        val project = editor.project ?: return null
        if (!project.getService(RaccoonAutocompleteService::class.java)
                .hasSuggestion(editor, editor.caretModel.offset)) return null
        return accepts
    }
}
