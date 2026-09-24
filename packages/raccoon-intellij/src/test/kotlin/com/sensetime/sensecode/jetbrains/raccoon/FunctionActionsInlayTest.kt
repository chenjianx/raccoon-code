package com.sensetime.sensecode.jetbrains.raccoon

import com.intellij.openapi.util.TextRange
import com.intellij.openapi.editor.markup.TextAttributes
import com.intellij.testFramework.fixtures.LightJavaCodeInsightFixtureTestCase
import java.awt.Rectangle
import java.awt.image.BufferedImage
import java.util.Locale

class FunctionActionsInlayTest : LightJavaCodeInsightFixtureTestCase() {
    fun testInstallsBlockInlaysForJavaMethodsAfterRangesArrive() {
        val source = "class Example {\n  void first() {}\n  void second() {}\n}"
        myFixture.configureByText("Example.java", source)
        val ranges = listOf(
            TextRange(source.indexOf("void first"), source.indexOf("void second")),
            TextRange(source.indexOf("void second"), source.lastIndexOf('}')),
        )

        FunctionActionInlays.render(myFixture.editor, ranges)

        val inlays = myFixture.editor.inlayModel
            .getBlockElementsInRange(0, myFixture.editor.document.textLength)
            .filter { it.renderer is FunctionActionInlayRenderer }
        assertEquals(ranges.map(TextRange::getStartOffset), inlays.map { it.offset })
        assertTrue(inlays.all { it.widthInPixels > 0 && it.heightInPixels > 0 })
    }

    fun testReplacesStaleFunctionInlaysWhenRangesChange() {
        val source = "class Example {\n  void first() {}\n  void second() {}\n}"
        myFixture.configureByText("Example.java", source)
        val first = TextRange(source.indexOf("void first"), source.indexOf("void second"))
        val second = TextRange(source.indexOf("void second"), source.lastIndexOf('}'))

        FunctionActionInlays.render(myFixture.editor, listOf(first, second))
        FunctionActionInlays.render(myFixture.editor, listOf(second))

        val inlays = myFixture.editor.inlayModel
            .getBlockElementsInRange(0, myFixture.editor.document.textLength)
            .filter { it.renderer is FunctionActionInlayRenderer }
        assertEquals(listOf(second.startOffset), inlays.map { it.offset })
    }

    fun testAlignsIconWithIndentedFunctionStart() {
        val source = "class Example {\n    void run() {}\n}"
        myFixture.configureByText("Example.java", source)
        val range = TextRange(source.indexOf("void run"), source.lastIndexOf('}'))
        FunctionActionInlays.render(myFixture.editor, listOf(range))
        val inlay = functionInlays().single()
        val renderer = inlay.renderer as FunctionActionInlayRenderer
        val image = BufferedImage(200, myFixture.editor.lineHeight, BufferedImage.TYPE_INT_ARGB)

        renderer.paint(inlay, image.graphics, Rectangle(0, 0, image.width, image.height), TextAttributes())

        val firstPaintedX = (0 until image.width).first { x ->
            (0 until image.height).any { y -> image.getRGB(x, y).ushr(24) != 0 }
        }
        assertTrue(firstPaintedX >= myFixture.editor.offsetToXY(range.startOffset).x)
    }

    fun testClickableAreaExcludesIndentationBeforeIcon() {
        val source = "class Example {\n    void run() {}\n}"
        myFixture.configureByText("Example.java", source)
        val range = TextRange(source.indexOf("void run"), source.lastIndexOf('}'))
        FunctionActionInlays.render(myFixture.editor, listOf(range))
        val renderer = functionInlays().single().renderer as FunctionActionInlayRenderer
        val functionX = myFixture.editor.offsetToXY(range.startOffset).x

        assertFalse(renderer.containsX(functionX - 1))
        assertTrue(renderer.containsX(functionX))
    }

    fun testRefreshRendersRangesAlreadyReturnedByTheExtractor() {
        val source = "class Example { void run() {} }"
        myFixture.configureByText("Example.java", source)
        val range = TextRange(source.indexOf("void run"), source.lastIndexOf('}'))
        FunctionVisionRanges.putSnapshot(myFixture.editor, listOf(range))

        FunctionActionInlays.refresh(myFixture.editor)

        val inlays = myFixture.editor.inlayModel
            .getBlockElementsInRange(0, myFixture.editor.document.textLength)
            .filter { it.renderer is FunctionActionInlayRenderer }
        assertEquals(listOf(range.startOffset), inlays.map { it.offset })
    }

    fun testInstallsBlockInlayForKotlinFunction() {
        myFixture.configureByText("Example.kt", "fun run() {}")
        val range = TextRange(0, 12)

        FunctionActionInlays.render(myFixture.editor, listOf(range))

        assertEquals(listOf(range.startOffset), functionInlays().map { it.offset })
    }

    fun testInstallsBlockInlayForPythonWithoutPythonPlugin() {
        myFixture.configureByText("Example.py", "def run():\n    pass\n")
        val range = TextRange(0, 19)

        FunctionActionInlays.render(myFixture.editor, listOf(range))

        assertEquals(listOf(range.startOffset), functionInlays().map { it.offset })
    }

    fun testPopupOpensBesideTheIconInsteadOfCoveringTheFunction() {
        val source = "class Example:\n    def run():\n        pass\n"
        myFixture.configureByText("Example.py", source)
        val editor = myFixture.editor
        editor.caretModel.moveToOffset(editor.document.textLength - 1)
        val range = TextRange(source.indexOf("def run"), source.length)
        FunctionActionInlays.render(editor, listOf(range))
        val inlay = functionInlays().single()
        val bounds = requireNotNull(inlay.bounds)

        val point = functionActionPopupPoint(editor, range, bounds)
        val functionStart = editor.offsetToXY(range.startOffset)
        assertEquals(editor.contentComponent, point.component)
        assertTrue(point.point.x > bounds.x + functionStart.x)
        assertTrue(point.point.y in bounds.y until bounds.y + bounds.height)
        assertTrue(point.point.y < functionStart.y)
    }

    fun testFunctionMenuLabelsFollowEnglishAndChineseLocales() {
        assertEquals(
            listOf("Explain", "Fix", "Improve", "Refactor", "Comment"),
            functionActionChoices(Locale.ENGLISH).keys.toList(),
        )
        assertEquals(
            listOf("解释", "修复", "优化", "重构", "注释"),
            functionActionChoices(Locale.SIMPLIFIED_CHINESE).keys.toList(),
        )
        assertEquals("解释", functionActionChoices(Locale.forLanguageTag("zh-Hans")).keys.first())
        assertEquals(
            listOf("解釋", "修復", "最佳化", "重構", "註解"),
            functionActionChoices(Locale.TRADITIONAL_CHINESE).keys.toList(),
        )
        assertEquals("解釋", functionActionChoices(Locale.forLanguageTag("zh-Hant-HK")).keys.first())
        assertEquals("EXPLAIN", functionActionChoices(Locale.SIMPLIFIED_CHINESE)["解释"])
    }

    fun testFunctionMenuFollowsThePluginLanguageWhenItChanges() {
        val service = project.getService(RaccoonService::class.java)

        service.onSidecarMessage("""{"type":"ready","pluginLanguage":"zh-Hans"}""")
        assertEquals("解释", functionActionChoices(service.functionActionLocale()).keys.first())

        service.onSidecarMessage(
            """{"type":"post","source":"chat","message":{"type":"state","state":{"pluginLanguage":"en"}}}""",
        )
        assertEquals("Explain", functionActionChoices(service.functionActionLocale()).keys.first())
    }

    private fun functionInlays() = myFixture.editor.inlayModel
        .getBlockElementsInRange(0, myFixture.editor.document.textLength)
        .filter { it.renderer is FunctionActionInlayRenderer }
}
