package com.sensetime.sensecode.jetbrains.raccoon

import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.testFramework.PlatformTestUtil
import com.intellij.testFramework.fixtures.LightJavaCodeInsightFixtureTestCase
import java.nio.file.Files
import java.nio.file.Path

class OpenFileTest : LightJavaCodeInsightFixtureTestCase() {
    fun testOpensMessageFileLinkAtOneBasedLineAndColumn() {
        val directory = Files.createTempDirectory(Path.of("build").toAbsolutePath(), "raccoon-link-")
        val source = Files.createDirectory(directory.resolve("src"))
        val file = Files.writeString(source.resolve("Example.java"), "first\nsecond\nthird\n")
        try {
            project.getService(RaccoonService::class.java).onSidecarMessage(
                """{"type":"openFile","filePath":"src/Example.java","directory":"$directory","line":2,"column":3}"""
            )
            PlatformTestUtil.dispatchAllEventsInIdeEventQueue()

            val editor = FileEditorManager.getInstance(project).selectedTextEditor ?: error("File was not opened")
            assertEquals(file.toString(), FileEditorManager.getInstance(project).selectedFiles.single().path)
            assertEquals(1, editor.caretModel.logicalPosition.line)
            assertEquals(2, editor.caretModel.logicalPosition.column)
        } finally {
            FileEditorManager.getInstance(project).selectedFiles.forEach { FileEditorManager.getInstance(project).closeFile(it) }
            Files.deleteIfExists(file)
            Files.deleteIfExists(source)
            Files.deleteIfExists(directory)
        }
    }
}
