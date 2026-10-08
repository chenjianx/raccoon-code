package com.sensetime.sensecode.jetbrains.raccoon.autocomplete

import com.intellij.openapi.editor.DefaultLanguageHighlighterColors
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.editor.EditorCustomElementRenderer
import com.intellij.openapi.editor.Inlay
import com.intellij.openapi.editor.colors.EditorFontType
import com.intellij.openapi.editor.markup.TextAttributes
import java.awt.Font
import java.awt.Graphics
import java.awt.Rectangle

class RaccoonInlayRenderer(
    private val editor: Editor,
    text: String,
) : EditorCustomElementRenderer {
    private val lines = text.split('\n')
    private val font = runCatching { editor.colorsScheme.getFont(EditorFontType.PLAIN) }
        .getOrNull()
        ?: Font(editor.colorsScheme.editorFontName, Font.PLAIN, editor.colorsScheme.editorFontSize)

    override fun calcWidthInPixels(inlay: Inlay<*>): Int {
        val metrics = editor.contentComponent.getFontMetrics(font)
        return lines.maxOfOrNull(metrics::stringWidth) ?: 0
    }

    override fun calcHeightInPixels(inlay: Inlay<*>): Int = editor.lineHeight * lines.size.coerceAtLeast(1)

    override fun paint(inlay: Inlay<*>, graphics: Graphics, targetRegion: Rectangle, textAttributes: TextAttributes) {
        graphics.font = font
        graphics.color = editor.colorsScheme
            .getAttributes(DefaultLanguageHighlighterColors.INLINE_SUGGESTION)
            .foregroundColor
            ?: editor.colorsScheme.defaultForeground
        lines.forEachIndexed { index, line ->
            graphics.drawString(line, targetRegion.x, targetRegion.y + editor.ascent + index * editor.lineHeight)
        }
    }

    companion object {
        fun render(editor: Editor, offset: Int, text: String) {
            val lines = text.split('\n')
            lines.firstOrNull()?.takeIf(String::isNotEmpty)?.let {
                editor.inlayModel.addInlineElement(offset, true, RaccoonInlayRenderer(editor, it))
            }
            lines.drop(1).takeIf { remaining -> remaining.any(String::isNotEmpty) }?.let {
                editor.inlayModel.addBlockElement(
                    offset,
                    true,
                    false,
                    0,
                    RaccoonInlayRenderer(editor, it.joinToString("\n")),
                )
            }
        }
    }
}
