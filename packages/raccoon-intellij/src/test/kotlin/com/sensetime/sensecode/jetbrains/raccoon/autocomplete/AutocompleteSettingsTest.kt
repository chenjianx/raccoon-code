package com.sensetime.sensecode.jetbrains.raccoon.autocomplete

import com.google.gson.JsonObject
import com.sensetime.sensecode.jetbrains.raccoon.AutocompleteCallbacks
import com.sensetime.sensecode.jetbrains.raccoon.WebviewReadyState
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlin.concurrent.thread

class AutocompleteSettingsTest {
    @Test
    fun `disabled setting survives reconstruction using the platform boolean default`() {
        val properties = TestProperties()
        val project = settingsProject(properties)
        val settings = RaccoonAutocompleteSettings(project)
        assertTrue(settings.enabled)

        settings.enabled = false

        assertEquals(true, properties.booleanDefault)
        assertFalse(settings.enabled)
        assertFalse(RaccoonAutocompleteSettings(project).enabled)
        settings.enabled = true
        assertTrue(RaccoonAutocompleteSettings(project).enabled)
        assertFalse(properties.isValueSet("raccoon.autocomplete.enabled"))
    }

    @Test
    fun `unknown model falls back to pro completion`() {
        assertEquals("raccoon-pro-completion", normalizeAutocompleteModel("unknown"))
    }

    @Test
    fun `known completion model is preserved`() {
        assertEquals("raccoon-completion", normalizeAutocompleteModel("raccoon-completion"))
    }

    @Test
    fun `startup failure completes autocomplete request without sending`() {
        val results = mutableListOf<String?>()
        var sends = 0

        AutocompleteCallbacks().request(
            requestID = "request-1",
            callback = results::add,
            start = { error("sidecar failed to start") },
            send = {
                sends += 1
                true
            },
        )

        assertEquals(listOf<String?>(null), results)
        assertEquals(0, sends)
    }

    @Test
    fun `write failure removes and completes pending autocomplete request`() {
        val results = mutableListOf<String?>()
        val callbacks = AutocompleteCallbacks()

        callbacks.request("request-1", results::add, start = { true }, send = { false })
        callbacks.complete("request-1", "late completion")

        assertEquals(listOf<String?>(null), results)
    }

    @Test
    fun `write failure wins over result received while send is in flight`() {
        val results = mutableListOf<String?>()
        val callbacks = AutocompleteCallbacks()
        val sendStarted = CountDownLatch(1)
        val finishSend = CountDownLatch(1)
        val request = thread {
            callbacks.request("request-1", results::add, start = { true }) {
                sendStarted.countDown()
                assertTrue(finishSend.await(5, TimeUnit.SECONDS))
                false
            }
        }

        assertTrue(sendStarted.await(5, TimeUnit.SECONDS))
        callbacks.complete("request-1", "completion received before send returned")
        finishSend.countDown()
        request.join(5_000)

        assertFalse(request.isAlive)
        assertEquals(listOf<String?>(null), results)
        callbacks.complete("request-1", "late completion")
        assertEquals(listOf<String?>(null), results)
    }

    @Test
    fun `observed webview readiness is replayed for every sidecar generation`() {
        val state = WebviewReadyState()
        val attempts = mutableListOf<JsonObject>()
        val ready = JsonObject().apply { addProperty("type", "webviewReady") }

        assertFalse(state.forward("chat", ready) { attempts.add(it); false })
        assertTrue(state.replay { attempts.add(it); true })
        assertTrue(state.replay { attempts.add(it); true })

        assertEquals(3, attempts.size)
        attempts.forEach { frame ->
            assertEquals("webviewMessage", frame.get("type").asString)
            assertEquals("chat", frame.get("source").asString)
            assertEquals("webviewReady", frame.getAsJsonObject("message").get("type").asString)
        }
    }
}
