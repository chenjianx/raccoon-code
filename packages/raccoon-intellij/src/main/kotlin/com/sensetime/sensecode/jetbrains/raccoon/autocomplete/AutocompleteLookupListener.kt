package com.sensetime.sensecode.jetbrains.raccoon.autocomplete

import com.intellij.codeInsight.lookup.Lookup
import com.intellij.codeInsight.lookup.LookupManagerListener
import com.intellij.openapi.Disposable
import com.intellij.openapi.components.Service
import com.intellij.openapi.project.Project

@Service(Service.Level.PROJECT)
class AutocompleteLookupListener(private val project: Project) : Disposable {
    init {
        project.messageBus.connect(this).subscribe(
            LookupManagerListener.TOPIC,
            object : LookupManagerListener {
                override fun activeLookupChanged(oldLookup: Lookup?, newLookup: Lookup?) {
                    val editor = newLookup?.editor ?: return
                    project.getService(RaccoonAutocompleteService::class.java).clear(editor)
                }
            },
        )
    }

    override fun dispose() = Unit
}
