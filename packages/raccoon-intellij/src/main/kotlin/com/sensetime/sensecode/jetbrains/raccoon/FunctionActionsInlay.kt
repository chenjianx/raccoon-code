package com.sensetime.sensecode.jetbrains.raccoon

import com.intellij.ide.DataManager
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.DefaultActionGroup
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.editor.EditorCustomElementRenderer
import com.intellij.openapi.editor.Inlay
import com.intellij.openapi.editor.markup.TextAttributes
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.ui.popup.JBPopupFactory
import com.intellij.openapi.util.IconLoader
import com.intellij.openapi.util.TextRange
import com.intellij.psi.PsiDocumentManager
import com.intellij.ui.awt.RelativePoint
import java.awt.Graphics
import java.awt.Point
import java.awt.Rectangle
import java.util.Locale
import java.util.ResourceBundle

private val FUNCTION_ICON = IconLoader.getIcon("/icons/raccoonToolWindow.svg", FunctionActionInlayRenderer::class.java)
private val FUNCTION_ACTIONS = listOf(
    "function.action.explain" to "EXPLAIN",
    "function.action.fix" to "FIX",
    "function.action.improve" to "IMPROVE",
    "function.action.refactor" to "REFACTOR",
    "function.action.comment" to "COMMENT",
)

internal fun functionActionChoices(locale: Locale): Map<String, String> {
    val language = when {
        locale.language != "zh" -> locale
        locale.script == "Hant" || locale.country in setOf("TW", "HK", "MO") -> Locale.TRADITIONAL_CHINESE
        else -> Locale.SIMPLIFIED_CHINESE
    }
    val bundle = ResourceBundle.getBundle("messages.RaccoonBundle", language, FunctionActionInlayRenderer::class.java.classLoader)
    return FUNCTION_ACTIONS.associate { bundle.getString(it.first) to it.second }
}

internal class FunctionActionInlayRenderer(
    private val editor: Editor,
    val range: TextRange,
    val stamp: Long,
) : EditorCustomElementRenderer {
    private val iconX = editor.offsetToXY(range.startOffset).x

    override fun calcWidthInPixels(inlay: Inlay<*>): Int = iconX + FUNCTION_ICON.iconWidth

    override fun calcHeightInPixels(inlay: Inlay<*>): Int = maxOf(editor.lineHeight, FUNCTION_ICON.iconHeight)

    override fun paint(inlay: Inlay<*>, graphics: Graphics, targetRegion: Rectangle, textAttributes: TextAttributes) {
        FUNCTION_ICON.paintIcon(
            editor.contentComponent,
            graphics,
            targetRegion.x + iconX,
            targetRegion.y + (targetRegion.height - FUNCTION_ICON.iconHeight) / 2,
        )
    }

    fun containsX(x: Int) = x in iconX until iconX + FUNCTION_ICON.iconWidth
}

internal object FunctionActionInlays {
    fun refresh(editor: Editor) {
        clear(editor)
        val file = FileDocumentManager.getInstance().getFile(editor.document) ?: return
        if (!FunctionVisionRanges.supports(file.name)) return
        FunctionVisionRanges.request(editor, file.name) { ranges ->
            if (!editor.isDisposed) render(editor, ranges)
        }
    }

    fun render(editor: Editor, ranges: List<TextRange>) {
        clear(editor)
        ranges.forEach { range ->
            editor.inlayModel.addBlockElement(
                range.startOffset,
                false,
                true,
                0,
                FunctionActionInlayRenderer(editor, range, editor.document.modificationStamp),
            )
        }
    }

    fun clear(editor: Editor) {
        editor.inlayModel.getBlockElementsInRange(0, editor.document.textLength)
            .filter { it.renderer is FunctionActionInlayRenderer }
            .forEach { it.dispose() }
    }

    fun handleClick(editor: Editor, renderer: FunctionActionInlayRenderer, bounds: Rectangle) {
        val project = editor.project ?: return
        val service = project.getService(RaccoonService::class.java)
        val group = DefaultActionGroup()
        functionActionChoices(service.functionActionLocale()).forEach { (label, action) ->
            group.add(object : AnAction(label), DumbAware {
                override fun actionPerformed(event: AnActionEvent) {
                    PsiDocumentManager.getInstance(project).commitDocument(editor.document)
                    if (renderer.stamp != editor.document.modificationStamp) return
                    val file = PsiDocumentManager.getInstance(project).getPsiFile(editor.document)
                        ?.virtualFile ?: return
                    val context = captureFunctionContext(
                        editor.document,
                        renderer.range,
                        projectRelativePath(project.basePath, file.path),
                    ) ?: return
                    service.sendFunctionAction(action, context)
                }
            })
        }
        JBPopupFactory.getInstance().createActionGroupPopup(
            null,
            group,
            DataManager.getInstance().getDataContext(editor.contentComponent),
            JBPopupFactory.ActionSelectionAid.SPEEDSEARCH,
            true,
        )
            .show(functionActionPopupPoint(editor, renderer.range, bounds))
    }
}

internal fun functionActionPopupPoint(editor: Editor, range: TextRange, bounds: Rectangle): RelativePoint {
    return RelativePoint(
        editor.contentComponent,
        Point(
            bounds.x + editor.offsetToXY(range.startOffset).x + FUNCTION_ICON.iconWidth + 4,
            bounds.y + (bounds.height - FUNCTION_ICON.iconHeight) / 2,
        ),
    )
}
