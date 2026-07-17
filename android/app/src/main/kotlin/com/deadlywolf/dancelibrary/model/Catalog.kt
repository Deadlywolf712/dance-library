package com.deadlywolf.dancelibrary.model

import java.text.Normalizer
import java.util.Locale

data class DanceCatalog(
    val schemaVersion: Int,
    val pullZoneHost: String,
    val lessonCount: Int,
    val lessons: List<Lesson>,
)

data class Lesson(
    val id: String,
    val legacyPath: String,
    val categoryId: String,
    val breadcrumbs: List<String>,
    val course: String,
    val title: String,
    val sortOrdinal: Int,
    val catalogOrdinal: Int,
    val bunnyId: String,
    val collectionId: String,
    val rawSummary: String,
    val introParagraphs: List<String>,
    val chapters: List<LessonChapter>,
)

val Lesson.category: String
    get() = when (categoryId) {
        "salsa" -> "Salsa"
        "bachata" -> "Bachata"
        "zouk" -> "Zouk"
        "kizomba" -> "Kizomba"
        "salsa-masterclass" -> "Salsa Masterclass"
        "kizomba-masterclass" -> "Kizomba Masterclass"
        else -> categoryId.split('-').joinToString(" ") { word ->
            word.replaceFirstChar { if (it.isLowerCase()) it.titlecase(Locale.ROOT) else it.toString() }
        }
    }

data class LessonChapter(
    val seconds: Long,
    val label: String,
    val title: String,
    val description: String,
)

fun Lesson.streamUrl(pullZone: String): String =
    "https://${pullZone.trim().removePrefix("https://").removePrefix("http://").trimEnd('/')}/$bunnyId/playlist.m3u8"

fun Lesson.matchesSearch(query: String): Boolean {
    val terms = query.searchNormalized().split(Regex("\\s+")).filter(String::isNotBlank)
    if (terms.isEmpty()) return true
    val haystack = buildString {
        append(title)
        append(' ')
        append(course)
        append(' ')
        append(category)
        append(' ')
        append(breadcrumbs.joinToString(" "))
    }.searchNormalized()
    return terms.all(haystack::contains)
}

private val combiningMarks = Regex("\\p{M}+")

private fun String.searchNormalized(): String = Normalizer
    .normalize(trim(), Normalizer.Form.NFKD)
    .replace(combiningMarks, "")
    .lowercase(Locale.ROOT)
