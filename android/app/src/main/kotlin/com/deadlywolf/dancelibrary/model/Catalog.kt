package com.deadlywolf.dancelibrary.model

import java.text.Normalizer
import java.util.Locale

data class DanceCatalog(
    val schemaVersion: Int,
    val sourceSha256: String,
    val pullZoneHost: String,
    val lessonCount: Int,
    val summaryCount: Int,
    val chapterCount: Int,
    val introParagraphCount: Int,
    val defaultThemeId: String,
    val themes: List<ThemeSpec>,
    val categories: List<CatalogCategory>,
    val courses: List<CatalogCourse>,
    val folders: List<CatalogFolder>,
    val lessons: List<Lesson>,
)

data class ThemeSpec(
    val id: String,
    val name: String,
    val sortOrdinal: Int,
    val cssVariables: Map<String, String>,
) {
    fun css(variable: String): String = requireNotNull(cssVariables[variable]) {
        "Theme $id does not define $variable"
    }
}

object ThemeCssVariables {
    const val Background = "--bg-base"
    const val Surface = "--bg-surface"
    const val SurfaceHover = "--bg-surface-hover"
    const val Text = "--text-main"
    const val MutedText = "--text-muted"
    const val Accent = "--accent"
    const val Border = "--border-light"
    const val PillText = "--pill-text"

    val required: Set<String> = setOf(
        Background,
        Surface,
        SurfaceHover,
        Text,
        MutedText,
        Accent,
        Border,
        PillText,
    )
}

data class CatalogCategory(
    val id: String,
    val title: String,
    val sortOrdinal: Int,
    val lessonCount: Int,
    val courseCount: Int,
    val folderCount: Int,
)

data class CatalogCourse(
    val id: String,
    val categoryId: String,
    val rootFolderId: String,
    val title: String,
    val sortOrdinal: Int,
    val lessonCount: Int,
    val folderCount: Int,
    val presentation: CoursePresentation?,
)

data class CoursePresentation(
    val title: String,
    val subtitle: String,
    val intro: String,
)

data class CatalogFolder(
    val id: String,
    val parentId: String?,
    val categoryId: String,
    val courseId: String,
    val name: String,
    val pathSegments: List<String>,
    val sortOrdinal: Int,
    val directLessonCount: Int,
    val lessonCount: Int,
    val childFolderCount: Int,
    val presentation: FolderPresentation?,
)

data class FolderPresentation(
    val kind: String,
    val title: String?,
    val number: String?,
    val color: String?,
    val description: String,
    val tips: String?,
    val song: String?,
    val prerequisites: FolderPrerequisites?,
)

data class FolderPrerequisites(
    val on1: List<String>,
    val on2: List<String>,
)

data class Lesson(
    val id: String,
    val legacyPath: String,
    val categoryId: String,
    val categoryTitle: String,
    val courseId: String,
    val folderId: String,
    val breadcrumbs: List<String>,
    val course: String,
    val playlistId: String,
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
    get() = categoryTitle

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
