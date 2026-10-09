package com.sensetime.sensecode.jetbrains.raccoon.autocomplete

data class AutocompleteRenderPlan(
    val displayText: String,
    val insertText: String,
    val replaceEndOffset: Int,
)

internal fun autocompleteProtocolCharacter(caretOffset: Int, lineStartOffset: Int): Int =
    caretOffset - lineStartOffset

fun planAutocomplete(
    documentText: String,
    caretOffset: Int,
    lineEndOffset: Int,
    completion: String,
): AutocompleteRenderPlan? {
    if (completion.isEmpty()) return null
    if (caretOffset < 0 || lineEndOffset < caretOffset || lineEndOffset > documentText.length) return null

    val lineSuffix = documentText.substring(caretOffset, lineEndOffset)
    if ('\n' in completion && lineSuffix.isNotBlank()) return null

    val existingSuffix = lineSuffix.trim()
    if (existingSuffix.isEmpty() || '\n' in completion) {
        return AutocompleteRenderPlan(completion, completion, lineEndOffset)
    }
    if (completion.startsWith(existingSuffix)) return null

    val suffixOffset = completion.lastIndexOf(existingSuffix)
    val displayText = if (suffixOffset > 0) completion.substring(0, suffixOffset) else completion
    if (displayText.isEmpty()) return null
    return AutocompleteRenderPlan(displayText, completion, lineEndOffset)
}
