package com.deadlywolf.dancelibrary.ui.theme

import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import com.deadlywolf.dancelibrary.model.ThemeSpec

private val ArcticBackground = Color(0xFFE8ECF0)
private val ArcticSurface = Color(0xFFF7F9FB)
private val ArcticSurfaceMuted = Color(0xFFDDE2E8)
private val ArcticText = Color(0xFF2C3E50)
private val ArcticMutedText = Color(0xFF607487)
private val ArcticBlue = Color(0xFF257DB5)
private val ArcticOrange = Color(0xFFD64A12)

private val ArcticColors = lightColorScheme(
    primary = ArcticBlue,
    onPrimary = Color.White,
    primaryContainer = Color(0xFFCDE9FA),
    onPrimaryContainer = Color(0xFF123D57),
    secondary = ArcticOrange,
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFFFDBCC),
    onSecondaryContainer = Color(0xFF5A1C05),
    background = ArcticBackground,
    onBackground = ArcticText,
    surface = ArcticSurface,
    onSurface = ArcticText,
    surfaceVariant = ArcticSurfaceMuted,
    onSurfaceVariant = ArcticMutedText,
    outline = Color(0xFF738597),
    outlineVariant = Color(0xFFBEC8D2),
    error = Color(0xFFBA1A1A),
).withReadableText()

private val DanceTypography = Typography(
    headlineLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Black,
        fontSize = 34.sp,
        lineHeight = 38.sp,
        letterSpacing = (-0.6).sp,
    ),
    headlineSmall = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Bold,
        fontSize = 24.sp,
        lineHeight = 30.sp,
    ),
    titleLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Bold,
        fontSize = 20.sp,
        lineHeight = 25.sp,
    ),
    titleMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 16.sp,
        lineHeight = 22.sp,
    ),
    bodyLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Normal,
        fontSize = 16.sp,
        lineHeight = 24.sp,
    ),
    bodyMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Normal,
        fontSize = 14.sp,
        lineHeight = 20.sp,
    ),
    labelLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 14.sp,
        lineHeight = 18.sp,
    ),
)

@Composable
fun DanceLibraryTheme(
    theme: ThemeSpec? = null,
    content: @Composable () -> Unit,
) {
    val colors = remember(theme) { theme?.toColorScheme() ?: ArcticColors }
    MaterialTheme(
        colorScheme = colors,
        typography = DanceTypography,
        content = content,
    )
}

internal fun ThemeSpec.toColorScheme(): ColorScheme {
    val background = cssVariables["--bg-base"].toComposeColor() ?: ArcticBackground
    val surface = cssVariables["--bg-surface"].toComposeColor() ?: ArcticSurface
    val surfaceHover = cssVariables["--bg-surface-hover"].toComposeColor() ?: ArcticSurfaceMuted
    val text = cssVariables["--text-main"].toComposeColor() ?: ArcticText
    val mutedText = cssVariables["--text-muted"].toComposeColor() ?: ArcticMutedText
    val accent = cssVariables["--accent"].toComposeColor() ?: ArcticBlue
    val accentHover = cssVariables["--accent-hover"].toComposeColor() ?: accent
    val border = cssVariables["--border-light"].toComposeColor() ?: mutedText.copy(alpha = 0.55f)
    val dark = background.luminance() < 0.42f
    val onAccent = readableOn(accent)
    val primaryContainer = blend(accent, background, if (dark) 0.30f else 0.18f)
    val secondaryContainer = blend(accentHover, background, if (dark) 0.34f else 0.20f)

    val base = if (dark) darkColorScheme() else lightColorScheme()
    return base.copy(
        primary = accent,
        onPrimary = onAccent,
        primaryContainer = primaryContainer,
        onPrimaryContainer = readableOn(primaryContainer),
        secondary = accentHover,
        onSecondary = readableOn(accentHover),
        secondaryContainer = secondaryContainer,
        onSecondaryContainer = readableOn(secondaryContainer),
        background = background,
        onBackground = text,
        surface = surface,
        onSurface = text,
        surfaceVariant = surfaceHover,
        onSurfaceVariant = mutedText,
        outline = border,
        outlineVariant = blend(border, background, 0.52f),
        surfaceContainer = blend(surfaceHover, background, 0.35f),
        surfaceContainerLow = blend(surface, background, 0.65f),
        surfaceContainerHigh = blend(surfaceHover, background, 0.65f),
        surfaceContainerHighest = surfaceHover,
        surfaceContainerLowest = background,
    ).withReadableText()
}

/** Web accent/muted colors also become small native text; retain their hue while
 * increasing contrast on the actual native surfaces where those roles are used. */
private fun ColorScheme.withReadableText(): ColorScheme {
    // A few medium-dark themes have tinted cards too bright for white text but
    // a page too dark for black text. Bring only those surfaces toward the page
    // before selecting shared text colors; changing text alone cannot fix them.
    val ink = readableOn(background)
    fun readableSurface(surface: Color): Color {
        if (colorContrast(ink, surface) >= 4.5f) return surface
        var low = 0f
        var high = 1f
        repeat(24) {
            val midpoint = (low + high) / 2f
            if (colorContrast(ink, blend(background, surface, midpoint)) >= 4.5f) high = midpoint else low = midpoint
        }
        return blend(background, surface, high)
    }
    val normalized = copy(
        surface = readableSurface(surface), surfaceVariant = readableSurface(surfaceVariant),
        primaryContainer = readableSurface(primaryContainer), secondaryContainer = readableSurface(secondaryContainer),
        surfaceContainer = readableSurface(surfaceContainer), surfaceContainerLow = readableSurface(surfaceContainerLow),
        surfaceContainerHigh = readableSurface(surfaceContainerHigh), surfaceContainerHighest = readableSurface(surfaceContainerHighest),
    )
    val textSurfaces = listOf(background, normalized.surface, normalized.surfaceVariant, normalized.primaryContainer, normalized.secondaryContainer,
        normalized.surfaceContainer, normalized.surfaceContainerLow, normalized.surfaceContainerHigh, normalized.surfaceContainerHighest)
    val accessiblePrimary = readableText(primary, textSurfaces)
    val accessibleSecondary = readableText(secondary, textSurfaces)
    return normalized.copy(
        primary = accessiblePrimary, onPrimary = readableOn(accessiblePrimary),
        secondary = accessibleSecondary, onSecondary = readableOn(accessibleSecondary),
        onBackground = readableText(onBackground, listOf(background)),
        onSurface = readableText(onSurface, textSurfaces),
        onSurfaceVariant = readableText(onSurfaceVariant, textSurfaces),
        onPrimaryContainer = readableOn(normalized.primaryContainer),
        onSecondaryContainer = readableOn(normalized.secondaryContainer),
        error = readableText(error, textSurfaces),
    )
}

internal fun colorContrast(foreground: Color, background: Color): Float {
    val opaqueForeground = blend(foreground, background, foreground.alpha)
    val first = opaqueForeground.luminance()
    val second = background.luminance()
    return (maxOf(first, second) + 0.05f) / (minOf(first, second) + 0.05f)
}

internal fun readableText(requested: Color, backgrounds: List<Color>, minimum: Float = 4.5f): Color {
    fun contrast(color: Color) = backgrounds.minOf { colorContrast(color, it) }
    val opaque = requested.copy(alpha = 1f)
    if (contrast(opaque) >= minimum) return opaque
    val target = if (contrast(Color.Black) >= contrast(Color.White)) Color.Black else Color.White
    var low = 0f
    var high = 1f
    repeat(24) {
        val midpoint = (low + high) / 2f
        if (contrast(blend(target, opaque, midpoint)) >= minimum) high = midpoint else low = midpoint
    }
    return blend(target, opaque, high)
}

internal fun String?.toComposeColor(): Color? {
    val raw = this?.trim() ?: return null
    parseRgbColor(raw)?.let { return it }
    val value = raw.removePrefix("#")
    return runCatching {
        when (value.length) {
            3 -> Color(
                red = value.substring(0, 1).repeat(2).toInt(16) / 255f,
                green = value.substring(1, 2).repeat(2).toInt(16) / 255f,
                blue = value.substring(2, 3).repeat(2).toInt(16) / 255f,
            )
            6 -> Color(0xFF000000L or value.toLong(16))
            8 -> Color(
                red = value.substring(0, 2).toInt(16) / 255f,
                green = value.substring(2, 4).toInt(16) / 255f,
                blue = value.substring(4, 6).toInt(16) / 255f,
                alpha = value.substring(6, 8).toInt(16) / 255f,
            )
            else -> return null
        }
    }.getOrNull()
}

private fun parseRgbColor(value: String): Color? {
    val match = RGB_COLOR.matchEntire(value) ?: return null
    val parts = match.groupValues[1].split(',').map(String::trim)
    if (parts.size !in 3..4) return null
    return runCatching {
        fun channel(raw: String): Float = if (raw.endsWith('%')) {
            raw.dropLast(1).toFloat().div(100f)
        } else {
            raw.toFloat().div(255f)
        }.coerceIn(0f, 1f)
        val alpha = parts.getOrNull(3)?.toFloatOrNull()?.coerceIn(0f, 1f) ?: 1f
        Color(channel(parts[0]), channel(parts[1]), channel(parts[2]), alpha)
    }.getOrNull()
}

private fun readableOn(color: Color): Color =
    if (colorContrast(Color.Black, color) >= colorContrast(Color.White, color)) Color.Black else Color.White

private fun blend(foreground: Color, background: Color, foregroundAmount: Float): Color {
    val amount = foregroundAmount.coerceIn(0f, 1f)
    return Color(
        red = foreground.red * amount + background.red * (1f - amount),
        green = foreground.green * amount + background.green * (1f - amount),
        blue = foreground.blue * amount + background.blue * (1f - amount),
        alpha = 1f,
    )
}

private val RGB_COLOR = Regex("rgba?\\(([^)]+)\\)", RegexOption.IGNORE_CASE)
