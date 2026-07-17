package com.deadlywolf.dancelibrary.model

import com.deadlywolf.dancelibrary.data.CatalogValidator
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class CatalogTest {
    @Test
    fun streamUrlUsesBunnyIdAndNormalizesHost() {
        val lesson = lesson()

        assertEquals(
            "https://vz-example.b-cdn.net/${lesson.id}/playlist.m3u8",
            lesson.streamUrl("https://vz-example.b-cdn.net/"),
        )
    }

    @Test
    fun searchRequiresEveryTermAcrossLessonMetadata() {
        val lesson = lesson(title = "03 - Cross Body Lead", course = "Adolfo - Salsa On2")

        assertTrue(lesson.matchesSearch("salsa cross"))
        assertTrue(lesson.matchesSearch("ADOLFO on2"))
        assertFalse(lesson.matchesSearch("salsa bachata"))
    }

    @Test
    fun searchIgnoresAccents() {
        val lesson = lesson(course = "Alex Desirée - Salsa Partnerwork")

        assertTrue(lesson.matchesSearch("desiree"))
        assertTrue(lesson.matchesSearch("DÉSIRÉE"))
    }

    @Test
    fun validatorRejectsDuplicateBunnyIds() {
        val duplicate = lesson()
        val catalog = DanceCatalog(
            schemaVersion = 1,
            pullZoneHost = "vz-example.b-cdn.net",
            lessonCount = 2,
            lessons = listOf(duplicate, duplicate),
        )

        assertThrows(IllegalArgumentException::class.java) {
            CatalogValidator.requireValid(catalog)
        }
    }

    @Test
    fun validatorAcceptsOrderedChapters() {
        val catalog = DanceCatalog(
            schemaVersion = 1,
            pullZoneHost = "vz-example.b-cdn.net",
            lessonCount = 1,
            lessons = listOf(
                lesson(
                    chapters = listOf(
                        LessonChapter(10, "00:10", "Start", "Begin"),
                        LessonChapter(20, "00:20", "Next", "Continue"),
                    ),
                ),
            ),
        )

        CatalogValidator.requireValid(catalog)
    }
}

internal fun lesson(
    id: String = "9b0a1d6a-da85-4a75-92f8-8cc8d62abe96",
    title: String = "01 - Syncopation",
    course: String = "Adolfo - Salsa On2 Advanced",
    categoryId: String = "salsa",
    catalogOrdinal: Int = 0,
    chapters: List<LessonChapter> = emptyList(),
): Lesson = Lesson(
    id = id,
    legacyPath = "$course/$title.mp4",
    categoryId = categoryId,
    breadcrumbs = emptyList(),
    course = course,
    title = title,
    sortOrdinal = catalogOrdinal,
    catalogOrdinal = catalogOrdinal,
    bunnyId = id,
    collectionId = "30595781-8972-4091-8b85-acba26bde7e3",
    rawSummary = "",
    introParagraphs = emptyList(),
    chapters = chapters,
)
