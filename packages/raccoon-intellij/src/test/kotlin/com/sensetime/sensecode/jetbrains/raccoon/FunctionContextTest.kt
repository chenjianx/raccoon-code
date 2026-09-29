package com.sensetime.sensecode.jetbrains.raccoon

import com.intellij.openapi.editor.impl.DocumentImpl
import com.intellij.openapi.application.Application
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.util.TextRange
import com.intellij.openapi.util.ThrowableComputable
import com.sensetime.sensecode.jetbrains.raccoon.autocomplete.platformProxy
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class FunctionContextTest {
    private val previousApplication = ApplicationManager.getApplication()

    @BeforeTest
    fun setup() {
        ApplicationManager.setApplication(platformProxy<Application> { name, args ->
            when (name) {
                "runReadAction" -> (args[0] as ThrowableComputable<*, *>).compute()
                "isUnitTestMode" -> true
                else -> error("Unexpected Application.$name")
            }
        })
    }

    @AfterTest
    fun teardown() { ApplicationManager.setApplication(previousApplication) }

    @Test
    fun `captures current unsaved document text with one based lines`() {
        val document = DocumentImpl("class Foo {\n  void run() {\n    work();\n  }\n}\n")
        val start = document.text.indexOf("void run")
        val end = document.text.indexOf("\n  }", start) + "\n  }".length

        val context = captureFunctionContext(document, TextRange(start, end), "src/Foo.java")

        assertEquals("void run() {\n    work();\n  }", context?.selectedText)
        assertEquals("src/Foo.java", context?.filePath)
        assertEquals(2, context?.startLine)
        assertEquals(4, context?.endLine)
    }

    @Test
    fun `rejects a stale range after the document shrinks`() {
        val document = DocumentImpl("short")
        assertNull(captureFunctionContext(document, TextRange(2, 30), "Foo.java"))
    }

    @Test
    fun `uses a project relative path for files inside the project`() {
        assertEquals("src/Foo.java", projectRelativePath("/workspace", "/workspace/src/Foo.java"))
    }

    @Test
    fun `uses the exclusive end position line like VS Code`() {
        val document = DocumentImpl("first\nsecond")

        val context = captureFunctionContext(document, TextRange(0, 6), "Example.java")

        assertEquals("first\n", context?.selectedText)
        assertEquals(1, context?.startLine)
        assertEquals(2, context?.endLine)
    }
}
