package com.sensetime.sensecode.jetbrains.raccoon.autocomplete

import com.intellij.ide.util.PropertiesComponent
import com.intellij.openapi.project.Project
import java.lang.reflect.Proxy

internal inline fun <reified T> platformProxy(crossinline call: (String, Array<out Any?>) -> Any?): T =
    Proxy.newProxyInstance(T::class.java.classLoader, arrayOf(T::class.java)) { proxy, method, args ->
        when (method.name) {
            "hashCode" -> System.identityHashCode(proxy)
            "equals" -> proxy === args?.firstOrNull()
            "toString" -> "Test ${T::class.java.simpleName}"
            else -> call(method.name, args ?: emptyArray())
        }
    } as T

internal fun settingsProject(properties: PropertiesComponent): Project = platformProxy { name, args ->
    when (name) {
        "getService" -> {
            check(args[0] == PropertiesComponent::class.java)
            properties
        }
        else -> error("Unexpected Project.$name")
    }
}

// Keep the platform's final boolean overload and getBoolean implementation real. Only the
// abstract storage primitive is supplied, with IntelliJ's remove-default-value semantics.
internal class TestProperties : PropertiesComponent() {
    private val values = mutableMapOf<String, String>()
    var booleanDefault: Boolean? = null

    override fun getValue(name: String): String? = values[name]
    override fun isValueSet(name: String) = values.containsKey(name)
    override fun unsetValue(name: String) { values.remove(name) }
    override fun setValue(name: String, value: String?) {
        if (value == null) values.remove(name) else values[name] = value
    }
    override fun setValue(name: String, value: String?, defaultValue: String?) {
        setValue(name, value.takeUnless { it == defaultValue })
    }
    override fun setValue(name: String, value: Boolean, defaultValue: Boolean) {
        booleanDefault = defaultValue
        setValue(name, value.toString(), defaultValue.toString())
    }
    override fun setValue(name: String, value: Float, defaultValue: Float) = error("unused")
    override fun setValue(name: String, value: Int, defaultValue: Int) = error("unused")
    override fun getValues(name: String): Array<String>? = error("unused")
    override fun setValues(name: String, values: Array<out String>?) = error("unused")
    override fun getList(name: String): List<String>? = error("unused")
    override fun setList(name: String, values: Collection<String>?) = error("unused")
    override fun updateValue(name: String, value: Boolean): Boolean = error("unused")
}
