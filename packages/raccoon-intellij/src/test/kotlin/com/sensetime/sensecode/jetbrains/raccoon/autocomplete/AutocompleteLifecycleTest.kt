package com.sensetime.sensecode.jetbrains.raccoon.autocomplete

import com.intellij.codeInsight.lookup.Lookup
import com.intellij.codeInsight.lookup.LookupArranger
import com.intellij.codeInsight.lookup.LookupElement
import com.intellij.codeInsight.lookup.LookupEx
import com.intellij.codeInsight.lookup.LookupManager
import com.intellij.ide.util.PropertiesComponent
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.Application
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.editor.CaretModel
import com.intellij.openapi.editor.Document
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.editor.EditorCustomElementRenderer
import com.intellij.openapi.editor.EditorKind
import com.intellij.openapi.editor.Inlay
import com.intellij.openapi.editor.InlayModel
import com.intellij.openapi.editor.SelectionModel
import com.intellij.openapi.editor.colors.EditorColorsScheme
import com.intellij.openapi.project.Project
import com.sensetime.sensecode.jetbrains.raccoon.RaccoonService
import java.awt.Font
import java.beans.PropertyChangeListener
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class AutocompleteLifecycleTest {
    private val previousApplication = ApplicationManager.getApplication()
    private lateinit var fixture: EditorFixture

    @BeforeTest
    fun setup() { fixture = EditorFixture() }

    @AfterTest
    fun teardown() { ApplicationManager.setApplication(previousApplication) }

    @Test
    fun `active native lookup prevents trigger from starting snapshot or transport work`() {
        fixture.lookupOpen = true
        assertNull(runCatching { fixture.service.trigger(fixture.editor) }.exceptionOrNull())
        assertEquals(0, fixture.renders)
    }

    @Test
    fun `native lookup rejects arriving completion`() {
        fixture.seedPending()
        fixture.lookupOpen = true
        fixture.deliver()
        assertEquals(0, fixture.renders)
        assertFalse(fixture.service.hasSuggestion(fixture.editor, 0))
    }

    @Test
    fun `native lookup clears a visible suggestion and releases Tab`() {
        fixture.seedPending()
        fixture.deliver()
        assertTrue(fixture.service.hasSuggestion(fixture.editor, 0))
        fixture.lookupOpen = true
        assertFalse(fixture.service.hasSuggestion(fixture.editor, 0))
        assertEquals(0, fixture.inlays.size)
    }

    @Test
    fun `disable clears visible inlays on EDT`() = clearsVisible("disable")

    @Test
    fun `model change clears visible inlays on EDT`() = clearsVisible("model")

    @Test
    fun `current process exit clears visible inlays on EDT`() = clearsVisible("exit")

    private fun clearsVisible(event: String) {
        fixture.seedPending()
        fixture.deliver()
        assertTrue(fixture.service.hasSuggestion(fixture.editor, 0))
        fixture.event(event)
        assertEquals(1, fixture.inlays.size, "process callback must not touch editor")
        fixture.drainEdt()
        assertEquals(0, fixture.inlays.size, event)
        assertFalse(fixture.service.hasSuggestion(fixture.editor, 0), event)
    }

    @Test
    fun `disable rejects completion queued before invalidation`() = rejectsQueued("disable")

    @Test
    fun `model change rejects completion queued before invalidation`() = rejectsQueued("model")

    @Test
    fun `current process exit rejects completion queued before invalidation`() = rejectsQueued("exit")

    private fun rejectsQueued(event: String) {
        fixture.seedPending()
        fixture.queue.add { fixture.deliver() }
        fixture.event(event)
        fixture.drainEdt()
        assertEquals(0, fixture.renders, event)
        assertFalse(fixture.service.hasSuggestion(fixture.editor, 0), event)
    }

    @Test
    fun `old generation exit and unchanged model do not clear current suggestion`() {
        fixture.seedPending()
        fixture.deliver()
        fixture.event("oldExit")
        fixture.event("sameModel")
        fixture.drainEdt()
        assertTrue(fixture.service.hasSuggestion(fixture.editor, 0))
        assertEquals(1, fixture.inlays.size)
    }
}

private class EditorFixture {
    val queue = ArrayDeque<() -> Unit>()
    val inlays = mutableListOf<Inlay<EditorCustomElementRenderer>>()
    var renders = 0
    var lookupOpen = false
    private var onEdt = true
    private val properties = TestProperties()
    private val services = mutableMapOf<Class<*>, Any>()
    private val generation = Any()
    private val project: Project = platformProxy { name, args ->
        when (name) {
            "getService", "getServiceIfCreated" -> services[args[0]] ?: error("Missing service ${args[0]}")
            "isDisposed" -> false
            else -> error("Unexpected Project.$name")
        }
    }
    val settings = RaccoonAutocompleteSettings(settingsProject(properties))
    private val host = RaccoonService(project)
    private val document: Document = platformProxy { name, _ ->
        when (name) {
            "getModificationStamp" -> 1L
            "getTextLength" -> 0
            "getImmutableCharSequence" -> ""
            else -> error("Unexpected Document.$name")
        }
    }
    private val carets: CaretModel = platformProxy { name, _ ->
        when (name) {
            "getCaretCount" -> 1
            "getOffset" -> 0
            else -> error("Unexpected CaretModel.$name")
        }
    }
    private val selection: SelectionModel = platformProxy { name, _ ->
        check(name == "hasSelection")
        false
    }
    private val colors: EditorColorsScheme = platformProxy { name, _ ->
        check(name == "getFont")
        Font(Font.MONOSPACED, Font.PLAIN, 12)
    }
    private val inlayModel: InlayModel = platformProxy { name, args ->
        check(onEdt) { "Editor accessed off EDT" }
        when (name) {
            "getInlineElementsInRange" -> inlays.toList()
            "getBlockElementsInRange" -> emptyList<Inlay<EditorCustomElementRenderer>>()
            "addInlineElement" -> {
                renders += 1
                val renderer = args.last()
                platformProxy<Inlay<EditorCustomElementRenderer>> { method, _ ->
                    when (method) {
                        "getRenderer" -> renderer
                        "dispose" -> { check(onEdt); inlays.clear(); Unit }
                        else -> error("Unexpected Inlay.$method")
                    }
                }.also { inlays.add(it) }
            }
            else -> error("Unexpected InlayModel.$name")
        }
    }
    val editor: Editor = platformProxy { name, _ ->
        check(onEdt) { "Editor accessed off EDT" }
        when (name) {
            "getProject" -> project
            "isDisposed", "isViewer" -> false
            "getEditorKind" -> EditorKind.MAIN_EDITOR
            "getDocument" -> document
            "getCaretModel" -> carets
            "getSelectionModel" -> selection
            "getInlayModel" -> inlayModel
            "getColorsScheme" -> colors
            else -> error("Unexpected Editor.$name")
        }
    }
    private val lookup: LookupEx = platformProxy { name, _ ->
        check(name == "getTopLevelEditor")
        editor
    }
    val service: RaccoonAutocompleteService

    init {
        services[PropertiesComponent::class.java] = properties
        services[RaccoonAutocompleteSettings::class.java] = settings
        services[RaccoonService::class.java] = host
        services[LookupManager::class.java] = object : LookupManager() {
            override fun getActiveLookup(): LookupEx? = lookup.takeIf { lookupOpen }
            override fun hideActiveLookup() = error("unused")
            override fun showLookup(editor: Editor, items: Array<out LookupElement>, prefix: String, arranger: LookupArranger): LookupEx = error("unused")
            override fun createLookup(editor: Editor, items: Array<out LookupElement>, prefix: String, arranger: LookupArranger): Lookup = error("unused")
            override fun addPropertyChangeListener(listener: PropertyChangeListener) = error("unused")
            override fun addPropertyChangeListener(listener: PropertyChangeListener, disposable: Disposable) = error("unused")
            override fun removePropertyChangeListener(listener: PropertyChangeListener) = error("unused")
        }
        ApplicationManager.setApplication(platformProxy<Application> { name, args ->
            when (name) {
                "invokeLater" -> { queue.add { (args[0] as Runnable).run() }; Unit }
                "isDispatchThread" -> onEdt
                "assertIsDispatchThread" -> { check(onEdt); Unit }
                else -> error("Unexpected Application.$name")
            }
        })
        service = RaccoonAutocompleteService(project)
        services[RaccoonAutocompleteService::class.java] = service
    }

    fun seedPending() {
        RaccoonService::class.java.getDeclaredField("sidecarGeneration").apply { isAccessible = true }.set(host, generation)
        RaccoonAutocompleteService::class.java.getDeclaredField("pending").apply { isAccessible = true }.set(
            service, PendingAutocomplete("request", editor, 1L, 0, 0, "/workspace/test.kt", null, null, host.autocompleteEpoch),
        )
    }

    fun deliver() {
        RaccoonAutocompleteService::class.java.getDeclaredMethod("receive", String::class.java, Editor::class.java, String::class.java)
            .apply { isAccessible = true }.invoke(service, "request", editor, "value")
    }

    fun event(event: String) {
        onEdt = false
        try {
            if (event == "exit" || event == "oldExit") {
                RaccoonService::class.java.getDeclaredMethod("onSidecarTerminated", Any::class.java)
                    .apply { isAccessible = true }.invoke(host, if (event == "exit") generation else Any())
                return
            }
            val json = when (event) {
                "disable" -> """{"type":"autocompleteSettings","enabled":false}"""
                "model" -> """{"type":"autocompleteSettings","model":"${if (settings.model == "raccoon-completion") "raccoon-pro-completion" else "raccoon-completion"}"}"""
                else -> """{"type":"autocompleteSettings","model":"${settings.model}"}"""
            }
            RaccoonService::class.java.getDeclaredMethod("onSidecarMessage", String::class.java)
                .apply { isAccessible = true }.invoke(host, json)
        } finally {
            onEdt = true
        }
    }

    fun drainEdt() {
        check(onEdt)
        while (queue.isNotEmpty()) queue.removeFirst().invoke()
    }
}
