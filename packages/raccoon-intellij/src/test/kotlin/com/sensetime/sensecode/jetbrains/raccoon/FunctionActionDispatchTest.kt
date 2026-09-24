package com.sensetime.sensecode.jetbrains.raccoon

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull

class FunctionActionDispatchTest {
    @Test
    fun `defers sidecar startup and send to the supplied executor`() {
        val events = mutableListOf<String>()
        var pending: Runnable? = null

        dispatchSidecarWork(
            execute = { pending = it },
            start = { events.add("start"); true },
            work = { events.add("send") },
        )

        assertEquals(emptyList(), events)
        assertNotNull(pending).run()
        assertEquals(listOf("start", "send"), events)
    }
}
