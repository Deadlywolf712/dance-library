package com.deadlywolf.dancelibrary.ui

import androidx.media3.common.C
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class HlsVideoPlayerTest {
    @Test
    fun resumeIsAppliedOnlyInsideKnownPlayableRange() {
        assertEquals(30_000L, validatedResumePositionMs(30_000L, 60_000L))
        assertEquals(4_000L, validatedResumePositionMs(4_000L, 60_000L))
        assertEquals(54_000L, validatedResumePositionMs(54_000L, 60_000L))
        assertNull(validatedResumePositionMs(499L, 60_000L))
        assertNull(validatedResumePositionMs(55_000L, 60_000L))
        assertNull(validatedResumePositionMs(90_000L, 60_000L))
        assertNull(validatedResumePositionMs(30_000L, C.TIME_UNSET))
    }

    @Test
    fun explicitBookmarkSeekWinsOverSavedResume() {
        assertEquals(42_000L, initialPlaybackPositionMs(42_000L, 15_000L, 60_000L))
        assertEquals(60_000L, initialPlaybackPositionMs(90_000L, 15_000L, 60_000L))
        assertEquals(15_000L, initialPlaybackPositionMs(null, 15_000L, 60_000L))
    }

    @Test
    fun progressRequiresKnownDurationAndNeverExceedsIt() {
        assertEquals(
            PlaybackProgress(positionMs = 60_000L, durationMs = 60_000L),
            normalizedPlaybackProgress(positionMs = 90_000L, durationMs = 60_000L),
        )
        assertNull(normalizedPlaybackProgress(positionMs = 10_000L, durationMs = C.TIME_UNSET))
        assertNull(normalizedPlaybackProgress(positionMs = -1L, durationMs = 60_000L))
    }

    @Test
    fun everyNonLifecyclePauseUpdatesRestoredPlaybackIntent() {
        assertEquals(true, shouldPersistPlaybackIntent(pausedForLifecycle = false))
        assertEquals(false, shouldPersistPlaybackIntent(pausedForLifecycle = true))
    }
}
