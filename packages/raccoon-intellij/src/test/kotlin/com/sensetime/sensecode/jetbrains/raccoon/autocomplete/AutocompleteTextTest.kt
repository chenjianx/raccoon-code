package com.sensetime.sensecode.jetbrains.raccoon.autocomplete

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class AutocompleteTextTest {
    @Test
    fun `single-line completion replaces through line end`() {
        assertEquals(
            AutocompleteRenderPlan("println(value)", "println(value)", 13),
            planAutocomplete("val x = prin)", 8, 13, "println(value)"),
        )
    }

    @Test
    fun `multiline completion is rejected before nonblank line suffix`() {
        assertNull(planAutocomplete("val x = suffix", 8, 14, "first\nsecond"))
    }

    @Test
    fun `matching suffix is hidden without changing inserted completion`() {
        assertEquals(
            AutocompleteRenderPlan("value", "value)", 8),
            planAutocomplete("return )", 7, 8, "value)"),
        )
    }

    @Test
    fun `multiline completion may replace a blank line suffix`() {
        assertEquals(
            AutocompleteRenderPlan("first\nsecond", "first\nsecond", 10),
            planAutocomplete("return    ", 6, 10, "first\nsecond"),
        )
    }

    @Test
    fun `completion beginning with the existing suffix is rejected`() {
        assertNull(planAutocomplete("return value", 7, 12, "value.toString()"))
    }

    @Test
    fun `empty completion and invalid ranges are rejected`() {
        assertNull(planAutocomplete("value", 5, 5, ""))
        assertNull(planAutocomplete("value", -1, 5, "next"))
        assertNull(planAutocomplete("value", 4, 3, "next"))
        assertNull(planAutocomplete("value", 4, 6, "next"))
    }

    @Test
    fun `protocol character counts a tab as one UTF-16 code unit`() {
        val documentText = "\tcall()"

        assertEquals(1, autocompleteProtocolCharacter(documentText.indexOf('c'), 0))
    }

    @Test
    fun `protocol character counts an emoji as two UTF-16 code units`() {
        val documentText = "😀call()"

        assertEquals(2, autocompleteProtocolCharacter(documentText.indexOf('c'), 0))
    }

    @Test
    fun `protocol character ignores virtual columns beyond the document offset`() {
        val documentText = "call()"

        assertEquals(documentText.length, autocompleteProtocolCharacter(documentText.length, 0))
    }
}
