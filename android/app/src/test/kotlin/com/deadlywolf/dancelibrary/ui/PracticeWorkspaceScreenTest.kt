package com.deadlywolf.dancelibrary.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PracticeWorkspaceScreenTest {
    @Test
    fun timestampInputPreservesMillisecondsAndLongLessonHours() {
        assertEquals(10_250L, parsePracticeTime("0:10.25"))
        assertEquals(12_500L, parsePracticeTime("12.5"))
        assertEquals(3_723_004L, parsePracticeTime("1:02:03.004"))
        assertEquals(7_200_000L, parsePracticeTime("120:00"))
        assertEquals(0L, parsePracticeTime(" 0:00 "))
    }

    @Test
    fun malformedAndOutOfRangeTimePartsCannotCreateSegments() {
        listOf("", "-1:00", "0:60", "1:60:00", "1.5:00", "0:00.1234", "1e2:00", "1:2:3:4", "NaN:00").forEach {
            assertNull("Accepted malformed timestamp: $it", parsePracticeTime(it))
        }
    }

    @Test
    fun prefillingTheCurrentLoopDoesNotRoundAwaySubseconds() {
        listOf(0L, 1L, 250L, 59_999L, 60_123L, 3_601_050L).forEach { position ->
            assertEquals(position, parsePracticeTime(formatPracticeInput(position)))
        }
    }
}
