@file:androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)

package com.deadlywolf.dancelibrary.ui

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
import kotlinx.coroutines.isActive

@Composable
fun HlsVideoPlayer(
    lesson: Lesson,
    pullZone: String,
    resumePositionMs: Long,
    playWhenReady: Boolean,
    onProgress: (lessonId: String, positionMs: Long, durationMs: Long) -> Unit,
    onPlaybackIntentChanged: (lessonId: String, playWhenReady: Boolean) -> Unit,
    onPlayerChanged: (Player?) -> Unit,
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
    val progressOwnerId = lesson.id
    val progressCallback = onProgress
    val playbackIntentCallback = onPlaybackIntentChanged
    val playerChangedCallback = onPlayerChanged
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
            validatedResumePositionMs(latestResumePositionMs, player.duration)?.let(player::seekTo)
        }

        val listener = object : Player.Listener {
            override fun onPlaybackStateChanged(state: Int) {
                playbackState = state
                if (state == Player.STATE_READY) {
                    playerError = null
                    applyInitialResume()
                }
                if (state == Player.STATE_ENDED) {
                    reportSessionProgress()
                    playbackIntentCallback(progressOwnerId, false)
                }
            }

            override fun onIsPlayingChanged(playing: Boolean) {
                isPlaying = playing
                if (!playing && player.playbackState == Player.STATE_READY) reportSessionProgress()
            }

            override fun onPlayWhenReadyChanged(ready: Boolean, reason: Int) {
                if (shouldPersistPlaybackIntent(lifecyclePlayback.pausedForLifecycle)) {
                    playbackIntentCallback(progressOwnerId, ready)
                }
            }

            override fun onPlayerError(error: PlaybackException) {
                reportSessionProgress()
                playerError = error
            }
        }
        player.addListener(listener)
        if (player.playbackState == Player.STATE_READY) applyInitialResume()
        playerChangedCallback(player)

        onDispose {
            reportSessionProgress()
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
                    Button(onClick = {
                        playerError = null
                        player.prepare()
                        player.play()
                    }) {
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
private const val MINIMUM_USEFUL_RESUME_MS = 500L
private const val RESUME_END_GUARD_MS = 10_000L
