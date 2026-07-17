package com.deadlywolf.dancelibrary.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

val ArcticBackground = Color(0xFFE8ECF0)
val ArcticSurface = Color(0xFFF7F9FB)
val ArcticSurfaceMuted = Color(0xFFDDE2E8)
val ArcticText = Color(0xFF2C3E50)
val ArcticMutedText = Color(0xFF607487)
val ArcticBlue = Color(0xFF257DB5)
val ArcticOrange = Color(0xFFD64A12)

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
)

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
fun DanceLibraryTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = ArcticColors,
        typography = DanceTypography,
        content = content,
    )
}
