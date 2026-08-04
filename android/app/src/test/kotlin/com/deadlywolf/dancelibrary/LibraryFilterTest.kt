package com.deadlywolf.dancelibrary

import com.deadlywolf.dancelibrary.model.lesson
import org.junit.Assert.assertEquals
import org.junit.Test

class LibraryFilterTest {
    private val salsa = lesson(catalogOrdinal = 2, categoryId = "salsa", title = "Salsa turn")
    private val bachata = lesson(
        id = "56f6047d-66f4-4e09-a219-6443ea3244b1",
        catalogOrdinal = 1,
        categoryId = "bachata",
        title = "Bachata turn",
    )

    @Test
    fun favoritesFilterUsesStableCatalogOrder() {
        val result = filterLessons(
            lessons = listOf(salsa, bachata),
            query = "",
            favorites = setOf(bachata.id),
        )

        assertEquals(listOf(bachata.id), result.map { it.id })
    }

    @Test
    fun catalogOrderIsStableAfterSearch() {
        val result = filterLessons(
            lessons = listOf(salsa, bachata),
            query = "turn",
        )

        assertEquals(listOf(bachata.id, salsa.id), result.map { it.id })
    }

    @Test
    fun changingLessonsKeepsSessionToolsButClearsTheLessonSpecificLoop() {
        val next = sessionForLesson(
            previous = PracticePlayerSession(
                lessonId = "lesson-a",
                speed = 0.75f,
                mirrored = true,
                loopStartMs = 10_000L,
                loopEndMs = 20_000L,
                theaterMode = true,
            ),
            lessonId = "lesson-b",
        )

        assertEquals("lesson-b", next.lessonId)
        assertEquals(0.75f, next.speed)
        assertEquals(true, next.mirrored)
        assertEquals(null, next.loopStartMs)
        assertEquals(null, next.loopEndMs)
        assertEquals(true, next.theaterMode)
    }

    @Test
    fun unavailableLessonClearsInheritedTheaterModeAndDuplicateSummary() {
        val previous = PracticePlayerSession(
            lessonId = "lesson-a",
            speed = 0.75f,
            mirrored = true,
            theaterMode = true,
        )
        val next = sessionForLesson(previous, "lesson-b", theaterModeAllowed = false)
        val unavailable = lesson(
            availability = "unavailable",
            availabilityReason = "Duplicate source",
            rawSummary = "Incorrect duplicate analysis",
        )

        assertEquals(false, next.theaterMode)
        assertEquals("", summaryForBackup(unavailable))
    }

    @Test
    fun transientPlaybackKeepsExactResumeAcrossPlayerRecreation() {
        val positions = updateTransientPlaybackPosition(
            positions = emptyMap(),
            lessonId = salsa.id,
            positionMs = 18_750L,
            durationMs = 120_000L,
        )

        assertEquals(18_750L, positions[salsa.id])
    }

    @Test
    fun finalFiveSecondsClearTransientResumeLikeTheWebsite() {
        val positions = updateTransientPlaybackPosition(
            positions = mapOf(salsa.id to 18_750L),
            lessonId = salsa.id,
            positionMs = 115_000L,
            durationMs = 120_000L,
        )

        assertEquals(emptyMap<String, Long>(), positions)
    }

    @Test
    fun shortInMemoryPositionSurvivesRotationWithoutBecomingDurableHistory() {
        val positions = updateTransientPlaybackPosition(
            positions = emptyMap(),
            lessonId = salsa.id,
            positionMs = 4_000L,
            durationMs = 120_000L,
        )

        assertEquals(4_000L, positions[salsa.id])
    }

    @Test
    fun suppressedPersistedPositionCannotReappearAfterCompletion() {
        val merged = mergePlaybackPositions(
            persisted = mapOf(salsa.id to 15_000L),
            transient = emptyMap(),
            suppressed = setOf(salsa.id),
        )

        assertEquals(emptyMap<String, Long>(), merged)
    }

    @Test
    fun watchedAndResumeStateCanCoexist() {
        val merged = mergePlaybackPositions(
            persisted = mapOf(salsa.id to 15_000L),
            transient = mapOf(salsa.id to 16_000L),
            suppressed = emptySet(),
        )

        assertEquals(16_000L, merged[salsa.id])
        assertEquals(false, isPlaybackComplete(114_999L, 120_000L))
        assertEquals(true, isPlaybackComplete(115_000L, 120_000L))
    }
}
