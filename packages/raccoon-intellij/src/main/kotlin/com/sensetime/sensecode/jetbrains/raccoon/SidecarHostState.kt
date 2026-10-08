package com.sensetime.sensecode.jetbrains.raccoon

import com.google.gson.JsonObject

internal class AutocompleteCallbacks(
    private val onError: (Throwable) -> Unit = {},
) {
    private val callbacks = mutableMapOf<String, CallbackState>()

    fun request(
        requestID: String,
        callback: (String?) -> Unit,
        start: () -> Boolean,
        send: () -> Boolean,
    ) {
        if (!runCatching(start).onFailure(onError).getOrDefault(false)) {
            completeCallback(callback, null)
            return
        }

        val replaced = synchronized(this) {
            callbacks.put(requestID, CallbackState.Sending(callback))
                ?.let { notification(it.callback, null) }
        }
        replaced?.invoke()

        val sent = runCatching(send).onFailure(onError).getOrDefault(false)
        val completed = synchronized(this) {
            val state = callbacks[requestID]?.takeIf { it.callback === callback }
                ?: return@synchronized null
            if (!sent) {
                callbacks.remove(requestID)
                return@synchronized notification(callback, null)
            }
            if (state is CallbackState.Sending && state.result != null) {
                callbacks.remove(requestID)
                return@synchronized notification(callback, state.result.value)
            }
            callbacks[requestID] = CallbackState.Pending(callback)
            null
        }
        completed?.invoke()
    }

    fun cancel(requestID: String) {
        synchronized(this) { callbacks.remove(requestID) }
    }

    fun complete(requestID: String, completion: String?) {
        val completed = synchronized(this) {
            when (val state = callbacks[requestID]) {
                is CallbackState.Pending -> {
                    callbacks.remove(requestID)
                    notification(state.callback, completion)
                }
                is CallbackState.Sending -> {
                    if (state.result == null) {
                        callbacks[requestID] = state.copy(result = Result(completion))
                    }
                    null
                }
                null -> null
            }
        }
        completed?.invoke()
    }

    fun failAll() {
        takeFailureNotification().invoke()
    }

    fun takeFailureNotification(): () -> Unit {
        val pending = synchronized(this) {
            callbacks.values.map { it.callback }.also { callbacks.clear() }
        }
        return { pending.forEach { completeCallback(it, null) } }
    }

    private fun notification(callback: (String?) -> Unit, value: String?): () -> Unit =
        { completeCallback(callback, value) }

    private fun completeCallback(callback: (String?) -> Unit, completion: String?) {
        runCatching { callback(completion) }.onFailure(onError)
    }

    private sealed interface CallbackState {
        val callback: (String?) -> Unit

        data class Sending(
            override val callback: (String?) -> Unit,
            val result: Result? = null,
        ) : CallbackState

        data class Pending(override val callback: (String?) -> Unit) : CallbackState
    }

    private data class Result(val value: String?)
}

internal class WebviewReadyState {
    private var chatReady = false

    fun forward(source: String, message: JsonObject, send: (JsonObject) -> Boolean): Boolean {
        if (source == "chat" && message.get("type")?.asString == "webviewReady") {
            synchronized(this) { chatReady = true }
        }
        return send(webviewMessage(source, message))
    }

    fun replay(send: (JsonObject) -> Boolean): Boolean {
        if (!synchronized(this) { chatReady }) return true
        return send(webviewMessage("chat", JsonObject().apply { addProperty("type", "webviewReady") }))
    }

    private fun webviewMessage(source: String, message: JsonObject) = JsonObject().apply {
        addProperty("type", "webviewMessage")
        addProperty("source", source)
        add("message", message)
    }
}
