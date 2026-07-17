@file:androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)

package com.deadlywolf.dancelibrary.ui

import android.view.ViewGroup
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.hls.HlsMediaSource
import androidx.media3.exoplayer.upstream.DefaultLoadErrorHandlingPolicy
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import com.deadlywolf.dancelibrary.model.Lesson
import com.deadlywolf.dancelibrary.model.streamUrl
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive

/** Speeds intentionally match the website's practice-player menu. */
val PRACTICE_PLAYBACK_SPEEDS: List<Float> = listOf(0.5f, 0.75f, 1f, 1.25f, 1.5f, 1.75f, 2f)

const val PRACTICE_SEEK_STEP_MS = 5_000L
const val MINIMUM_PRACTICE_LOOP_MS = 500L

data class PracticeLoop(
    val startMs: Long,
    val endMs: Long? = null,
) {
    val isActive: Boolean get() = endMs != null
}

data class PracticePlayerState(
    val lessonId: String,
    val positionMs: Long = 0L,
    val durationMs: Long? = null,
    val bufferedPositionMs: Long = 0L,
    val playbackState: Int = Player.STATE_IDLE,
    val playWhenReady: Boolean = false,
    val isPlaying: Boolean = false,
    val speed: Float = 1f,
    val mirrored: Boolean = false,
    val loop: PracticeLoop? = null,
    val theaterMode: Boolean = false,
    val errorMessage: String? = null,
) {
    val hasKnownDuration: Boolean get() = durationMs != null
}

/**
 * Compose-friendly practice-player handle. The handle is scoped to one lesson and becomes
 * invalid after HlsVideoPlayer invokes onPracticeControllerChanged(null).
 */
interface PracticePlayerController {
    val state: StateFlow<PracticePlayerState>

    fun play()
    fun pause()
    fun togglePlayPause()
    fun seekTo(positionMs: Long)
    fun seekBy(deltaMs: Long)
    fun setPlaybackSpeed(speed: Float)
    fun setMirrored(mirrored: Boolean)
    fun toggleMirrored()
    fun setLoopStart(positionMs: Long? = null)
    fun setLoopEnd(positionMs: Long? = null, activatePlayback: Boolean = true): Boolean
    fun clearLoop()
    fun setTheaterMode(enabled: Boolean)
    fun toggleTheaterMode()
    fun retry()
}

@Composable
fun HlsVideoPlayer(
    lesson: Lesson,
    pullZone: String,
    resumePositionMs: Long,
    initialSeekPositionMs: Long? = null,
    playWhenReady: Boolean,
    onProgress: (lessonId: String, positionMs: Long, durationMs: Long) -> Unit,
    onPlaybackIntentChanged: (lessonId: String, playWhenReady: Boolean) -> Unit,
    onPlayerChanged: (Player?) -> Unit,
    onPracticeControllerChanged: (PracticePlayerController?) -> Unit = {},
    onTheaterModeChanged: (Boolean) -> Unit = {},
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current.applicationContext
    val lifecycleOwner = LocalLifecycleOwner.current
    val latestResumePositionMs by rememberUpdatedState(resumePositionMs)
    var playbackState by remember(lesson.id) { mutableIntStateOf(Player.STATE_IDLE) }
    var playerError by remember(lesson.id) { mutableStateOf<PlaybackException?>(null) }
    var isPlaying by remember(lesson.id) { mutableStateOf(false) }

    val player = remember(lesson.id, pullZone) {
        val httpDataSource = DefaultHttpDataSource.Factory()
            .setUserAgent("DanceLibraryAndroid/1.0")
            .setConnectTimeoutMs(15_000)
            .setReadTimeoutMs(30_000)
            .setAllowCrossProtocolRedirects(true)

        val mediaItem = MediaItem.Builder()
            .setMediaId(lesson.id)
            .setUri(lesson.streamUrl(pullZone))
            .setMimeType(MimeTypes.APPLICATION_M3U8)
            .build()

        val mediaSource = HlsMediaSource.Factory(httpDataSource)
            .setAllowChunklessPreparation(true)
            .setLoadErrorHandlingPolicy(DefaultLoadErrorHandlingPolicy(6))
            .createMediaSource(mediaItem)

        val loadControl = DefaultLoadControl.Builder()
            .setBufferDurationsMs(
                15_000,
                60_000,
                1_000,
                2_500,
            )
            .build()

        ExoPlayer.Builder(context)
            .setLoadControl(loadControl)
            .build()
            .apply {
                setAudioAttributes(AudioAttributes.DEFAULT, true)
                setHandleAudioBecomingNoisy(true)
                setWakeMode(C.WAKE_MODE_NETWORK)
                setMediaSource(mediaSource)
                prepare()
                this.playWhenReady = playWhenReady
            }
    }

    val lifecyclePlayback = remember(player) { LifecyclePlaybackState() }
    val latestTheaterModeCallback by rememberUpdatedState(onTheaterModeChanged)
    val practiceController = remember(player, lesson.id) {
        Media3PracticePlayerController(
            lessonId = lesson.id,
            player = player,
            onTheaterModeChanged = { enabled -> latestTheaterModeCallback(enabled) },
            onRetryRequested = { playerError = null },
        )
    }
    val mirrored by remember(practiceController) {
        practiceController.state
            .map { state: PracticePlayerState -> state.mirrored }
            .distinctUntilChanged()
    }.collectAsState(initial = false)
    val progressOwnerId = lesson.id
    val requestedInitialSeekMs = remember(player) { initialSeekPositionMs }
    val progressCallback = onProgress
    val playbackIntentCallback = onPlaybackIntentChanged
    val playerChangedCallback = onPlayerChanged
    val practiceControllerChangedCallback = onPracticeControllerChanged
    fun reportSessionProgress() {
        reportKnownProgress(player) { positionMs, durationMs ->
            progressCallback(progressOwnerId, positionMs, durationMs)
        }
    }

    DisposableEffect(player) {
        var initialResumeHandled = false
        fun applyInitialResume() {
            if (initialResumeHandled) return
            initialResumeHandled = true
            initialPlaybackPositionMs(
                requestedPositionMs = requestedInitialSeekMs,
                resumePositionMs = latestResumePositionMs,
                durationMs = player.duration,
            )?.let(player::seekTo)
        }

        val listener = object : Player.Listener {
            override fun onPlaybackStateChanged(state: Int) {
                playbackState = state
                if (state == Player.STATE_READY) {
                    playerError = null
                    practiceController.clearError()
                    applyInitialResume()
                }
                if (state == Player.STATE_ENDED) {
                    if (practiceController.enforceLoop()) return
                    reportSessionProgress()
                    playbackIntentCallback(progressOwnerId, false)
                }
                practiceController.refresh()
            }

            override fun onIsPlayingChanged(playing: Boolean) {
                isPlaying = playing
                if (!playing && player.playbackState == Player.STATE_READY) reportSessionProgress()
                practiceController.refresh()
            }

            override fun onPlayWhenReadyChanged(ready: Boolean, reason: Int) {
                if (shouldPersistPlaybackIntent(lifecyclePlayback.pausedForLifecycle)) {
                    playbackIntentCallback(progressOwnerId, ready)
                }
                practiceController.refresh()
            }

            override fun onPlayerError(error: PlaybackException) {
                reportSessionProgress()
                playerError = error
                practiceController.setError(friendlyPlaybackError(error))
            }

            override fun onEvents(player: Player, events: Player.Events) {
                practiceController.refresh()
            }
        }
        player.addListener(listener)
        if (player.playbackState == Player.STATE_READY) applyInitialResume()
        practiceController.refresh()
        playerChangedCallback(player)
        practiceControllerChangedCallback(practiceController)

        onDispose {
            reportSessionProgress()
            practiceController.close()
            practiceControllerChangedCallback(null)
            playerChangedCallback(null)
            player.removeListener(listener)
            player.release()
        }
    }

    DisposableEffect(lifecycleOwner, player) {
        var resumeAfterForeground = false
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_STOP -> {
                    lifecyclePlayback.pausedForLifecycle = true
                    resumeAfterForeground = player.playWhenReady
                    reportSessionProgress()
                    player.pause()
                }

                Lifecycle.Event.ON_START -> {
                    if (resumeAfterForeground) player.play()
                    resumeAfterForeground = false
                    lifecyclePlayback.pausedForLifecycle = false
                }

                else -> Unit
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    LaunchedEffect(player, playWhenReady) {
        if (!lifecyclePlayback.pausedForLifecycle && player.playWhenReady != playWhenReady) {
            player.playWhenReady = playWhenReady
        }
    }

    LaunchedEffect(practiceController) {
        while (isActive) {
            practiceController.enforceLoop()
            practiceController.refresh()
            val loopIsPlaying = practiceController.state.value.loop?.isActive == true && player.isPlaying
            delay(if (loopIsPlaying) ACTIVE_LOOP_POLL_INTERVAL_MS else PLAYER_STATE_POLL_INTERVAL_MS)
        }
    }

    LaunchedEffect(player) {
        while (isActive) {
            delay(PROGRESS_SAVE_INTERVAL_MS)
            if (player.isPlaying) reportSessionProgress()
        }
    }

    Box(modifier.background(Color.Black)) {
        AndroidView(
            factory = { viewContext ->
                PlayerView(viewContext).apply {
                    this.player = player
                    isFocusable = false
                    isFocusableInTouchMode = false
                    descendantFocusability = ViewGroup.FOCUS_BLOCK_DESCENDANTS
                    resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
                    controllerAutoShow = true
                    controllerShowTimeoutMs = 3_500
                    setShowBuffering(PlayerView.SHOW_BUFFERING_WHEN_PLAYING)
                    keepScreenOn = false
                    contentDescription = "${lesson.title} video player"
                }
            },
            update = { view ->
                view.player = player
                view.keepScreenOn = isPlaying
                view.videoSurfaceView?.scaleX = if (mirrored) -1f else 1f
            },
            modifier = Modifier.fillMaxSize(),
        )

        if (playbackState == Player.STATE_BUFFERING && playerError == null) {
            CircularProgressIndicator(
                color = Color.White,
                modifier = Modifier.align(Alignment.Center),
            )
        }

        playerError?.let { error ->
            Surface(
                color = Color(0xE62C3E50),
                contentColor = Color.White,
                shape = MaterialTheme.shapes.large,
                modifier = Modifier
                    .align(Alignment.Center)
                    .padding(20.dp),
            ) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                    modifier = Modifier.padding(18.dp),
                ) {
                    Text("Playback was interrupted", style = MaterialTheme.typography.titleMedium)
                    Text(
                        friendlyPlaybackError(error),
                        style = MaterialTheme.typography.bodyMedium,
                        color = Color(0xFFDDE7EF),
                    )
                    Button(onClick = practiceController::retry) {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Icon(Icons.Rounded.Refresh, contentDescription = null)
                            Text("Retry video")
                        }
                    }
                }
            }
        }
    }
}

private class Media3PracticePlayerController(
    lessonId: String,
    private val player: Player,
    private val onTheaterModeChanged: (Boolean) -> Unit,
    private val onRetryRequested: () -> Unit,
) : PracticePlayerController {
    private val mutableState = MutableStateFlow(
        PracticePlayerState(
            lessonId = lessonId,
            speed = normalizedPracticeSpeed(player.playbackParameters.speed) ?: 1f,
        ),
    )
    override val state: StateFlow<PracticePlayerState> = mutableState.asStateFlow()
    private var closed = false

    override fun play() {
        if (closed) return
        if (player.playbackState == Player.STATE_ENDED) player.seekTo(0L)
        player.play()
        refresh()
    }

    override fun pause() {
        if (closed) return
        player.pause()
        refresh()
    }

    override fun togglePlayPause() {
        if (closed) return
        if (player.playWhenReady) pause() else play()
    }

    override fun seekTo(positionMs: Long) {
        if (closed) return
        player.seekTo(clampPracticeSeekPosition(positionMs, knownDurationMs(player.duration)))
        refresh()
    }

    override fun seekBy(deltaMs: Long) {
        if (closed) return
        seekTo(saturatingAdd(player.currentPosition.coerceAtLeast(0L), deltaMs))
    }

    override fun setPlaybackSpeed(speed: Float) {
        if (closed) return
        val normalized = normalizedPracticeSpeed(speed) ?: return
        player.setPlaybackSpeed(normalized)
        refresh()
    }

    override fun setMirrored(mirrored: Boolean) {
        if (closed || mutableState.value.mirrored == mirrored) return
        mutableState.update { it.copy(mirrored = mirrored) }
    }

    override fun toggleMirrored() {
        setMirrored(!mutableState.value.mirrored)
    }

    override fun setLoopStart(positionMs: Long?) {
        if (closed) return
        val start = clampPracticeSeekPosition(
            requestedPositionMs = positionMs ?: player.currentPosition,
            durationMs = knownDurationMs(player.duration),
        )
        mutableState.update { it.copy(loop = PracticeLoop(startMs = start)) }
    }

    override fun setLoopEnd(positionMs: Long?, activatePlayback: Boolean): Boolean {
        if (closed) return false
        val start = mutableState.value.loop?.startMs ?: return false
        val loop = normalizedPracticeLoop(
            firstPositionMs = start,
            secondPositionMs = positionMs ?: player.currentPosition,
            durationMs = knownDurationMs(player.duration),
        ) ?: return false

        mutableState.update { it.copy(loop = loop) }
        if (activatePlayback) {
            player.seekTo(loop.startMs)
            player.play()
            refresh()
        }
        return true
    }

    override fun clearLoop() {
        if (closed || mutableState.value.loop == null) return
        mutableState.update { it.copy(loop = null) }
    }

    override fun setTheaterMode(enabled: Boolean) {
        if (closed || mutableState.value.theaterMode == enabled) return
        mutableState.update { it.copy(theaterMode = enabled) }
        onTheaterModeChanged(enabled)
    }

    override fun toggleTheaterMode() {
        setTheaterMode(!mutableState.value.theaterMode)
    }

    override fun retry() {
        if (closed) return
        val retryPosition = clampPracticeSeekPosition(player.currentPosition, knownDurationMs(player.duration))
        onRetryRequested()
        clearError()
        player.prepare()
        if (retryPosition > 0L) player.seekTo(retryPosition)
        play()
    }

    fun setError(message: String) {
        if (closed) return
        mutableState.update { it.copy(errorMessage = message) }
        refresh()
    }

    fun clearError() {
        if (closed || mutableState.value.errorMessage == null) return
        mutableState.update { it.copy(errorMessage = null) }
    }

    fun enforceLoop(): Boolean {
        if (closed) return false
        val loop = mutableState.value.loop ?: return false
        if (shouldWrapPracticeLoop(player.currentPosition, loop, player.playWhenReady)) {
            player.seekTo(loop.startMs)
            if (player.playbackState == Player.STATE_ENDED) player.play()
            refresh()
            return true
        }
        return false
    }

    fun refresh() {
        if (closed) return
        val duration = knownDurationMs(player.duration)
        val position = clampPracticeSeekPosition(player.currentPosition, duration)
        val buffered = clampPracticeSeekPosition(player.bufferedPosition, duration)
        mutableState.update { previous ->
            val normalizedLoop = previous.loop?.let { loop ->
                val end = loop.endMs
                if (end == null) {
                    loop.copy(startMs = clampPracticeSeekPosition(loop.startMs, duration))
                } else {
                    normalizedPracticeLoop(loop.startMs, end, duration)
                }
            }
            previous.copy(
                positionMs = position,
                durationMs = duration,
                bufferedPositionMs = buffered,
                playbackState = player.playbackState,
                playWhenReady = player.playWhenReady,
                isPlaying = player.isPlaying,
                speed = normalizedPracticeSpeed(player.playbackParameters.speed) ?: previous.speed,
                loop = normalizedLoop,
            )
        }
    }

    fun close() {
        if (closed) return
        if (mutableState.value.theaterMode) {
            mutableState.update { it.copy(theaterMode = false) }
            onTheaterModeChanged(false)
        }
        closed = true
    }
}

internal fun knownDurationMs(durationMs: Long): Long? =
    durationMs.takeIf { it != C.TIME_UNSET && it > 0L }

internal fun clampPracticeSeekPosition(requestedPositionMs: Long, durationMs: Long?): Long {
    val nonNegative = requestedPositionMs.coerceAtLeast(0L)
    return durationMs?.takeIf { it > 0L }?.let(nonNegative::coerceAtMost) ?: nonNegative
}

internal fun normalizedPracticeSpeed(requestedSpeed: Float): Float? =
    requestedSpeed.takeIf(Float::isFinite)?.coerceIn(MINIMUM_PLAYBACK_SPEED, MAXIMUM_PLAYBACK_SPEED)

internal fun normalizedPracticeLoop(
    firstPositionMs: Long,
    secondPositionMs: Long,
    durationMs: Long?,
    minimumLoopMs: Long = MINIMUM_PRACTICE_LOOP_MS,
): PracticeLoop? {
    if (minimumLoopMs <= 0L) return null
    val knownDuration = durationMs?.takeIf { it > 0L }
    if (knownDuration != null && knownDuration < minimumLoopMs) return null

    val first = clampPracticeSeekPosition(firstPositionMs, knownDuration)
    val second = clampPracticeSeekPosition(secondPositionMs, knownDuration)
    var start = minOf(first, second)
    var end = maxOf(first, second)

    if (end - start < minimumLoopMs) {
        end = knownDuration?.let { minOf(it, saturatingAdd(start, minimumLoopMs)) }
            ?: saturatingAdd(start, minimumLoopMs)
        if (end - start < minimumLoopMs) start = (end - minimumLoopMs).coerceAtLeast(0L)
    }

    return PracticeLoop(startMs = start, endMs = end)
        .takeIf { loop -> loop.endMs != null && loop.endMs - loop.startMs >= minimumLoopMs }
}

internal fun shouldWrapPracticeLoop(positionMs: Long, loop: PracticeLoop, playbackRequested: Boolean): Boolean =
    playbackRequested && loop.endMs?.let { positionMs >= it } == true

private fun saturatingAdd(value: Long, delta: Long): Long = when {
    delta > 0L && value > Long.MAX_VALUE - delta -> Long.MAX_VALUE
    delta < 0L && value < Long.MIN_VALUE - delta -> Long.MIN_VALUE
    else -> value + delta
}

private fun reportKnownProgress(
    player: Player,
    onProgress: (positionMs: Long, durationMs: Long) -> Unit,
) {
    normalizedPlaybackProgress(player.currentPosition, player.duration)?.let { progress ->
        onProgress(progress.positionMs, progress.durationMs)
    }
}

internal data class PlaybackProgress(val positionMs: Long, val durationMs: Long)

internal fun normalizedPlaybackProgress(positionMs: Long, durationMs: Long): PlaybackProgress? {
    if (durationMs == C.TIME_UNSET || durationMs <= 0 || positionMs < 0) return null
    return PlaybackProgress(positionMs.coerceAtMost(durationMs), durationMs)
}

internal fun validatedResumePositionMs(savedPositionMs: Long, durationMs: Long): Long? {
    if (
        savedPositionMs < MINIMUM_USEFUL_RESUME_MS ||
        durationMs == C.TIME_UNSET ||
        durationMs <= MINIMUM_USEFUL_RESUME_MS
    ) {
        return null
    }

    val endGuardMs = minOf(RESUME_END_GUARD_MS, durationMs / 10)
    return savedPositionMs.takeIf { it < durationMs - endGuardMs }
}

internal fun initialPlaybackPositionMs(
    requestedPositionMs: Long?,
    resumePositionMs: Long,
    durationMs: Long,
): Long? {
    val explicit = requestedPositionMs?.coerceAtLeast(0L)
    if (explicit != null && durationMs > 0L && durationMs != C.TIME_UNSET) {
        return explicit.coerceAtMost(durationMs)
    }
    return validatedResumePositionMs(resumePositionMs, durationMs)
}

private class LifecyclePlaybackState(var pausedForLifecycle: Boolean = false)

internal fun shouldPersistPlaybackIntent(pausedForLifecycle: Boolean): Boolean =
    !pausedForLifecycle

private fun friendlyPlaybackError(error: PlaybackException): String = when (error.errorCode) {
    PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED,
    PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT,
    -> "Check your connection, then retry. Your saved place is safe."

    PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS,
    PlaybackException.ERROR_CODE_IO_FILE_NOT_FOUND,
    -> "The Bunny stream is temporarily unavailable. Retry in a moment."

    PlaybackException.ERROR_CODE_DECODING_FAILED,
    PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED,
    -> "This device could not decode the selected stream."

    else -> "The player hit an unexpected media error (${error.errorCodeName})."
}

private const val PROGRESS_SAVE_INTERVAL_MS = 15_000L
private const val PLAYER_STATE_POLL_INTERVAL_MS = 250L
private const val ACTIVE_LOOP_POLL_INTERVAL_MS = 50L
private const val MINIMUM_USEFUL_RESUME_MS = 500L
private const val RESUME_END_GUARD_MS = 5_000L
private const val MINIMUM_PLAYBACK_SPEED = 0.5f
private const val MAXIMUM_PLAYBACK_SPEED = 2f
