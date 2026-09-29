package com.sensetime.sensecode.jetbrains.raccoon

import com.intellij.openapi.editor.Document
import com.intellij.openapi.util.TextRange
import java.nio.file.Path

internal data class FunctionContext(
    val filePath: String,
    val selectedText: String,
    val startLine: Int,
    val endLine: Int,
    val diagnostics: List<Nothing> = emptyList(),
)

internal fun captureFunctionContext(document: Document, range: TextRange, filePath: String): FunctionContext? {
    if (range.startOffset < 0 || range.endOffset > document.textLength || range.isEmpty) return null
    return FunctionContext(
        filePath = filePath,
        selectedText = document.getText(range),
        startLine = document.getLineNumber(range.startOffset) + 1,
        endLine = document.getLineNumber(range.endOffset) + 1,
    )
}

internal fun projectRelativePath(basePath: String?, filePath: String): String {
    val path = Path.of(filePath)
    val base = basePath?.let(Path::of)
    return if (base != null && path.startsWith(base)) base.relativize(path).toString() else path.toString()
}
