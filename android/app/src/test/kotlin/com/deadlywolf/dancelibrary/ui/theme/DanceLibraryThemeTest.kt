package com.deadlywolf.dancelibrary.ui.theme

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import com.google.gson.Gson
import com.deadlywolf.dancelibrary.model.DanceCatalog
import java.io.File
import org.junit.Test

class DanceLibraryThemeTest {
    @Test
    fun everyBundledThemeKeepsSmallTextReadableOnNativeSurfaces() {
        val catalog = Gson().fromJson(File("src/main/assets/catalog.json").readText(), DanceCatalog::class.java)
        assertEquals(103, catalog.themes.size)
        catalog.themes.forEach { theme ->
            val colors = theme.toColorScheme()
            val surfaces = listOf(colors.background, colors.surface, colors.surfaceVariant, colors.primaryContainer,
                colors.secondaryContainer, colors.surfaceContainer, colors.surfaceContainerHigh)
            for (foreground in listOf(colors.onSurface, colors.onSurfaceVariant, colors.primary, colors.secondary, colors.error)) {
                for (surface in surfaces) assertTrue("${theme.id}: small text contrast ${colorContrast(foreground, surface)}",
                    colorContrast(foreground, surface) >= 4.49f)
            }
            assertTrue("${theme.id}: button text", colorContrast(colors.onPrimary, colors.primary) >= 4.49f)
            assertTrue("${theme.id}: container text", colorContrast(colors.onPrimaryContainer, colors.primaryContainer) >= 4.49f)
        }
    }
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
