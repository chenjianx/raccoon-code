package com.sensetime.sensecode.jetbrains.raccoon.autocomplete

import com.intellij.ide.util.PropertiesComponent
import com.intellij.openapi.components.Service
import com.intellij.openapi.project.Project

private const val ENABLED_KEY = "raccoon.autocomplete.enabled"
private const val MODEL_KEY = "raccoon.autocomplete.model"
const val DEFAULT_AUTOCOMPLETE_MODEL = "raccoon-pro-completion"

@Service(Service.Level.PROJECT)
class RaccoonAutocompleteSettings(project: Project) {
    private val properties = PropertiesComponent.getInstance(project)

    var enabled: Boolean
        get() = properties.getBoolean(ENABLED_KEY, true)
        set(value) = properties.setValue(ENABLED_KEY, value, true)

    var model: String
        get() = normalizeAutocompleteModel(properties.getValue(MODEL_KEY))
        set(value) = properties.setValue(MODEL_KEY, normalizeAutocompleteModel(value))
}

fun normalizeAutocompleteModel(model: String?): String =
    when (model) {
        "raccoon-completion" -> model
        else -> DEFAULT_AUTOCOMPLETE_MODEL
    }
