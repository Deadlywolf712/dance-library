package com.deadlywolf.dancelibrary.ui

import androidx.media3.common.C
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PracticePlayerControllerTest {
    @Test
    fun seekTargetsAreClampedToTheKnownTimeline() {
        assertEquals(0L, clampPracticeSeekPosition(-1_000L, 60_000L))
        assertEquals(25_000L, clampPracticeSeekPosition(25_000L, 60_000L))
        assertEquals(60_000L, clampPracticeSeekPosition(75_000L, 60_000L))
        assertEquals(75_000L, clampPracticeSeekPosition(75_000L, null))
        assertEquals(75_000L, clampPracticeSeekPosition(75_000L, -1L))
        assertNull(knownDurationMs(C.TIME_UNSET))
        assertNull(knownDurationMs(0L))
        assertEquals(60_000L, knownDurationMs(60_000L))
    }

    @Test
    fun playbackSpeedRejectsNonFiniteValuesAndStaysInWebsiteRange() {
        assertEquals(0.5f, normalizedPracticeSpeed(0.25f))
        assertEquals(0.75f, normalizedPracticeSpeed(0.75f))
        assertEquals(2f, normalizedPracticeSpeed(3f))
        assertNull(normalizedPracticeSpeed(Float.NaN))
        assertNull(normalizedPracticeSpeed(Float.POSITIVE_INFINITY))
        assertEquals(
            listOf(0.5f, 0.75f, 1f, 1.25f, 1.5f, 1.75f, 2f),
            PRACTICE_PLAYBACK_SPEEDS,
        )
    }

    @Test
    fun loopNormalizesReversedEndpointsAndEnforcesHalfSecondMinimum() {
        assertEquals(
            PracticeLoop(startMs = 2_000L, endMs = 5_000L),
            normalizedPracticeLoop(5_000L, 2_000L, durationMs = 10_000L),
        )
        assertEquals(
            PracticeLoop(startMs = 3_000L, endMs = 3_500L),
            normalizedPracticeLoop(3_000L, 3_100L, durationMs = 10_000L),
        )
    }

    @Test
    fun loopNearTheEndMovesItsStartBackAndRejectsTooShortMedia() {
        assertEquals(
            PracticeLoop(startMs = 9_500L, endMs = 10_000L),
            normalizedPracticeLoop(9_900L, 10_000L, durationMs = 10_000L),
        )
        assertNull(normalizedPracticeLoop(0L, 200L, durationMs = 400L))
    }

    @Test
    fun activeLoopWrapsOnlyWhenPlaybackIsRequestedAtOrAfterItsEnd() {
        val active = PracticeLoop(startMs = 1_000L, endMs = 2_000L)
        assertFalse(shouldWrapPracticeLoop(positionMs = 1_999L, loop = active, playbackRequested = true))
        assertTrue(shouldWrapPracticeLoop(positionMs = 2_000L, loop = active, playbackRequested = true))
        assertFalse(shouldWrapPracticeLoop(positionMs = 2_500L, loop = active, playbackRequested = false))
        assertFalse(
            shouldWrapPracticeLoop(
                positionMs = 2_500L,
                loop = PracticeLoop(startMs = 1_000L),
                playbackRequested = true,
            ),
        )
    }
}
