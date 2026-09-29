package com.sensetime.sensecode.jetbrains.raccoon

import com.intellij.openapi.actionSystem.ActionGroup
import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.actionSystem.DataContext
import com.intellij.openapi.actionSystem.IdeActions
import com.intellij.testFramework.TestActionEvent
import com.intellij.testFramework.fixtures.LightJavaCodeInsightFixtureTestCase

class EditorContextMenuTest : LightJavaCodeInsightFixtureTestCase() {
    fun testRegistersSelectionActionsInTheEditorPopupMenu() {
        val actionManager = ActionManager.getInstance()
        val group = actionManager.getAction("Raccoon.EditorContextMenu")

        assertNotNull(group)
        assertTrue(group is ActionGroup)
        assertTrue((group as ActionGroup).isPopup)
        assertEquals(
            listOf(
                "Raccoon.ExplainSelection",
                "Raccoon.FixSelection",
                "Raccoon.ImproveSelection",
                "Raccoon.AddSelectionToContext",
            ),
            group.getChildren(null).map { actionManager.getId(it) },
        )

        val editorPopup = actionManager.getAction(IdeActions.GROUP_EDITOR_POPUP) as ActionGroup
        assertTrue(editorPopup.getChildren(null).contains(group))
    }

    fun testSelectionActionsAreVisibleOnlyForAnEditorSelection() {
        myFixture.configureByText("Example.java", "class Example { void run() {} }")
        val actionManager = ActionManager.getInstance()
        val action = actionManager.getAction("Raccoon.ExplainSelection")
        val group = actionManager.getAction("Raccoon.EditorContextMenu")
        val context = DataContext { dataId ->
            when (dataId) {
                CommonDataKeys.EDITOR.name -> myFixture.editor
                CommonDataKeys.PROJECT.name -> project
                else -> null
            }
        }
        val withoutSelection = TestActionEvent.createTestEvent(action, context)
        val groupWithoutSelection = TestActionEvent.createTestEvent(group, context)

        action.update(withoutSelection)
        group.update(groupWithoutSelection)

        assertFalse(withoutSelection.presentation.isEnabledAndVisible)
        assertFalse(groupWithoutSelection.presentation.isEnabledAndVisible)

        myFixture.editor.selectionModel.setSelection(0, 5)
        val withSelection = TestActionEvent.createTestEvent(action, context)
        val groupWithSelection = TestActionEvent.createTestEvent(group, context)
        action.update(withSelection)
        group.update(groupWithSelection)

        assertTrue(withSelection.presentation.isEnabledAndVisible)
        assertTrue(groupWithSelection.presentation.isEnabledAndVisible)
    }

    fun testSelectionActionSendsCurrentUnsavedSelection() {
        val file = myFixture.addFileToProject(
            "src/Example.java",
            "class Example { void run() {} }",
        )
        myFixture.configureFromExistingVirtualFile(file.virtualFile)
        val editor = myFixture.editor
        editor.caretModel.moveToOffset(editor.document.text.indexOf("void"))
        myFixture.type("public ")
        val start = editor.document.text.indexOf("void")
        editor.selectionModel.setSelection(start, start + "void run() {}".length)
        val context = DataContext { dataId ->
            when (dataId) {
                CommonDataKeys.EDITOR.name -> editor
                CommonDataKeys.PROJECT.name -> project
                else -> null
            }
        }
        var captured: Pair<String, FunctionContext>? = null
        val action = EditorSelectionAction("EXPLAIN") { _, actionType, selectedContext ->
            captured = actionType to selectedContext
        }

        action.actionPerformed(TestActionEvent.createTestEvent(action, context))

        assertEquals("EXPLAIN", captured?.first)
        assertEquals(file.virtualFile.path, captured?.second?.filePath)
        assertEquals("void run() {}", captured?.second?.selectedText)
        assertEquals(1, captured?.second?.startLine)
        assertEquals(1, captured?.second?.endLine)
    }
}
