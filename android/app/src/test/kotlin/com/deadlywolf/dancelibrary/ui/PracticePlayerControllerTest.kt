package com.deadlywolf.dancelibrary.ui

import androidx.media3.common.C
import androidx.media3.common.Player
import androidx.media3.common.PlaybackParameters
import java.lang.reflect.Proxy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PracticePlayerControllerTest {
    @Test
    fun aNewerControllerSeekWinsWhenMetadataArrivesAfterAnInitialTimestamp() {
        val player = DelayedPlayer()
        val initial = InitialPlaybackPositionOwner(10_000L)
        val controller = Media3PracticePlayerController("lesson-a", player.player, {}, {}, initial::supersede)
        controller.seekTo(40_000L)
        player.durationMs = 90_000L
        initial.takeOnReady(25_000L, player.durationMs)?.let(player.player::seekTo)
        assertEquals(40_000L, player.positionMs)
    }

    @Test
    fun aNewerRelativeSeekAlsoPreventsAnOlderResumeFromWinning() {
        val player = DelayedPlayer()
        val initial = InitialPlaybackPositionOwner(null)
        val controller = Media3PracticePlayerController("lesson-a", player.player, {}, {}, initial::supersede)
        controller.seekBy(5_000L)
        player.durationMs = 90_000L
        initial.takeOnReady(25_000L, player.durationMs)?.let(player.player::seekTo)
        assertEquals(5_000L, player.positionMs)
    }

    @Test
    fun startingAManualLoopBeforeReadySupersedesTheOldResume() {
        val player = DelayedPlayer()
        val initial = InitialPlaybackPositionOwner(40_000L)
        val controller = Media3PracticePlayerController("lesson-a", player.player, {}, {}, initial::supersede)
        controller.setLoopStart(10_000L)
        assertTrue(controller.setLoopEnd(20_000L))
        player.durationMs = 90_000L
        initial.takeOnReady(25_000L, player.durationMs)?.let(player.player::seekTo)
        assertEquals(10_000L, player.positionMs)
        assertEquals(PracticeLoop(10_000L, 20_000L), controller.state.value.loop)
    }

    @Test
    fun initialPositionStillAppliesOnceWhenNoNewerActionSupersedesIt() {
        val explicit = InitialPlaybackPositionOwner(42_000L)
        assertNull(explicit.takeOnReady(15_000L, C.TIME_UNSET))
        assertEquals(42_000L, explicit.takeOnReady(15_000L, 60_000L))
        assertNull(explicit.takeOnReady(15_000L, 60_000L))
        assertEquals(15_000L, InitialPlaybackPositionOwner(null).takeOnReady(15_000L, 60_000L))
    }

    @Test
    fun cancelingOneSourceDoesNotCancelANewLessonsInitialPosition() {
        val oldSource = InitialPlaybackPositionOwner(10_000L)
        oldSource.supersede()
        val newSource = InitialPlaybackPositionOwner(30_000L)
        assertNull(oldSource.takeOnReady(20_000L, 60_000L))
        assertEquals(30_000L, newSource.takeOnReady(20_000L, 60_000L))
    }

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
        assertEquals(0.25f, normalizedPracticeSpeed(0.25f))
        assertEquals(0.25f, normalizedPracticeSpeed(0.1f))
        assertEquals(0.75f, normalizedPracticeSpeed(0.75f))
        assertEquals(2f, normalizedPracticeSpeed(3f))
        assertNull(normalizedPracticeSpeed(Float.NaN))
        assertNull(normalizedPracticeSpeed(Float.POSITIVE_INFINITY))
        assertEquals(
            listOf(0.25f, 0.5f, 0.75f, 1f, 1.25f, 1.5f, 1.75f, 2f),
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
    fun savedSegmentsRetainTheirShortRangeAtMillisecondPrecision() {
        val saved = PracticeLoop(startMs = 3_000L, endMs = 3_100L)
        assertEquals(saved, normalizedPracticeLoop(3_000L, 3_100L, 10_000L, minimumLoopMs = 1L))
        assertEquals(saved, normalizedPracticeLoop(saved.startMs, saved.endMs!!, 10_000L, minimumLoopMs = 1L))
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

/** Media3 Player interface fixture: timeline readiness is controlled by the test. */
private class DelayedPlayer {
    var durationMs = C.TIME_UNSET
    var positionMs = 0L
    private var playing = false
    val player: Player = Proxy.newProxyInstance(Player::class.java.classLoader, arrayOf(Player::class.java)) { _, method, args ->
        when (method.name) {
            "getPlaybackParameters" -> PlaybackParameters.DEFAULT
            "getDuration" -> durationMs
            "getCurrentPosition", "getBufferedPosition" -> positionMs
            "getPlaybackState" -> if (durationMs == C.TIME_UNSET) Player.STATE_BUFFERING else Player.STATE_READY
            "getPlayWhenReady", "isPlaying" -> playing
            "seekTo" -> { positionMs = args!!.last() as Long; null }
            "play" -> { playing = true; null }
            "pause" -> { playing = false; null }
            "toString" -> "DelayedPlayer"
            else -> throw UnsupportedOperationException("Unexpected Player call: ${method.name}")
        }
    } as Player
}
