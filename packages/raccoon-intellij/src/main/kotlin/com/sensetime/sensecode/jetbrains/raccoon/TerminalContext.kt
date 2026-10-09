package com.sensetime.sensecode.jetbrains.raccoon

import com.intellij.openapi.editor.EditorFactory
import com.intellij.openapi.project.Project
import org.jetbrains.plugins.terminal.TerminalToolWindowManager
import javax.swing.SwingUtilities

internal data class TerminalSnapshot(val name: String, val output: String)

/** Reads the selected terminal tab on the UI thread, including classic and 2024.2 terminal widgets. */
internal fun captureTerminal(project: Project): TerminalSnapshot? {
    val content = TerminalToolWindowManager.getInstance(project).toolWindow?.contentManager?.selectedContent ?: return null
    val classic = TerminalToolWindowManager.getWidgetByContent(content)
    if (classic != null) return TerminalSnapshot(content.displayName ?: "Terminal", classic.text)

    val widget = TerminalToolWindowManager.findWidgetByContent(content) ?: return null
    val output = EditorFactory.getInstance().allEditors
        .filter { SwingUtilities.isDescendingFrom(it.component, widget.component) }
        .map { it.document.text }
        .filter { it.isNotBlank() }
        .joinToString("\n")
    return TerminalSnapshot(content.displayName ?: "Terminal", output)
}
