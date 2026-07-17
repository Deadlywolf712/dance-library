package com.deadlywolf.dancelibrary.ui.theme

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test

class DanceLibraryThemeTest {
    @Test
    fun parsesWebsiteHexRgbAndRgbaColors() {
        val hex = "#257db5".toComposeColor()
        val rgb = "rgb(37, 125, 181)".toComposeColor()
        val rgba = "rgba(255, 255, 255, 0.10)".toComposeColor()

        assertNotNull(hex)
        assertEquals(hex, rgb)
        assertEquals(26f / 255f, requireNotNull(rgba).alpha, 0.001f)
    }

    @Test
    fun parsesCssEightDigitHexAsRrggbbaa() {
        val color = requireNotNull("#ff000080".toComposeColor())

        assertEquals(1f, color.red, 0.001f)
        assertEquals(0f, color.green, 0.001f)
        assertEquals(0f, color.blue, 0.001f)
        assertEquals(128f / 255f, color.alpha, 0.001f)
    }
}
