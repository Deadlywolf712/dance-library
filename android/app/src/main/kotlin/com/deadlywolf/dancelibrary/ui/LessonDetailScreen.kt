package com.deadlywolf.dancelibrary.ui

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.view.KeyEvent as AndroidKeyEvent
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.focusable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.BookmarkAdd
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.Favorite
import androidx.compose.material.icons.rounded.FavoriteBorder
import androidx.compose.material.icons.rounded.Flip
import androidx.compose.material.icons.rounded.Forward5
import androidx.compose.material.icons.rounded.Fullscreen
import androidx.compose.material.icons.rounded.Pause
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Repeat
import androidx.compose.material.icons.rounded.Replay5
import androidx.compose.material.icons.rounded.Share
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material.icons.rounded.SkipNext
import androidx.compose.material.icons.rounded.SkipPrevious
import androidx.compose.material.icons.rounded.Speed
import androidx.compose.material.icons.rounded.WarningAmber
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.deadlywolf.dancelibrary.AppDestination
import com.deadlywolf.dancelibrary.LibraryUiState
import com.deadlywolf.dancelibrary.LibraryViewModel
import com.deadlywolf.dancelibrary.data.PracticeBookmark
import com.deadlywolf.dancelibrary.data.MAX_IMPORTED_NOTE_LENGTH
import com.deadlywolf.dancelibrary.model.FolderPresentation
import com.deadlywolf.dancelibrary.model.Lesson
import com.deadlywolf.dancelibrary.model.LessonChapter
import com.deadlywolf.dancelibrary.model.isAvailable
import kotlin.math.min
import kotlin.math.roundToLong

@Composable
internal fun LessonDetailScreen(
    state: LibraryUiState,
    viewModel: LibraryViewModel,
    compact: Boolean,
    keyboardFocusNonce: Int,
    modifier: Modifier = Modifier,
) {
    val lesson = state.selectedLesson ?: return
    val context = LocalContext.current
    var controller by remember(lesson.id) { mutableStateOf<PracticePlayerController?>(null) }
    var restoredController by remember(lesson.id) { mutableStateOf<PracticePlayerController?>(null) }
    val keyboardFocusRequester = remember(lesson.id) { FocusRequester() }
    val playerState = controller?.state?.collectAsStateWithLifecycle()?.value ?: PracticePlayerState(lesson.id)
    val latestPlaybackIntent by rememberUpdatedState(state.playWhenReady)
    var bookmarkPositionMs by rememberSaveable(lesson.id) { mutableStateOf<Long?>(null) }
    var editingBookmarkId by rememberSaveable(lesson.id) { mutableStateOf<String?>(null) }
    var workspaceTab by rememberSaveable(lesson.id) { mutableStateOf(0) }
    var showReflectionEditor by rememberSaveable(lesson.id) { mutableStateOf(false) }
    var showSegmentEditor by rememberSaveable(lesson.id) { mutableStateOf(false) }
    var segmentError by remember(lesson.id) { mutableStateOf<String?>(null) }
    val favorite = lesson.id in state.practice.favorites
    val watched = lesson.id in state.practice.watched
    val bookmarks = state.practice.bookmarks[lesson.id].orEmpty().sortedBy(PracticeBookmark::positionMs)
    val folderPresentation = state.tree?.folderById?.get(lesson.folderId)?.presentation

    LaunchedEffect(controller, lesson.id, state.playerSession) {
        val activeController = controller ?: run {
            restoredController = null
            return@LaunchedEffect
        }
        val session = state.playerSession.takeIf { it.lessonId == lesson.id } ?: run {
            restoredController = null
            return@LaunchedEffect
        }
        if (restoredController === activeController) return@LaunchedEffect
        activeController.setPlaybackSpeed(session.speed)
        activeController.setMirrored(session.mirrored)
        activeController.clearLoop()
        session.loopStartMs?.let(activeController::setLoopStart)
        session.loopEndMs?.let { activeController.setLoopEnd(it, activatePlayback = false, minimumLoopMs = 1) }
        activeController.setTheaterMode(session.theaterMode)
        restoredController = activeController
    }
    LaunchedEffect(lesson.id, keyboardFocusNonce) { keyboardFocusRequester.requestFocus() }
    LaunchedEffect(
        restoredController,
        playerState.speed,
        playerState.mirrored,
        playerState.loop,
        playerState.theaterMode,
    ) {
        if (controller != null && restoredController === controller) {
            viewModel.updatePlayerSession(
                lessonId = lesson.id,
                speed = playerState.speed,
                mirrored = playerState.mirrored,
                loopStartMs = playerState.loop?.startMs,
                loopEndMs = playerState.loop?.endMs,
                theaterMode = playerState.theaterMode,
            )
        }
    }

    LaunchedEffect(controller, state.seekRequest?.nonce, playerState.durationMs) {
        val request = state.seekRequest ?: return@LaunchedEffect
        val activeController = controller ?: return@LaunchedEffect
        val segment = request.segment
        if (segment != null) {
            if (segment.path != lesson.legacyPath) return@LaunchedEffect
            val duration = playerState.durationMs ?: return@LaunchedEffect
            val start = (segment.start * 1_000).roundToLong()
            val end = (segment.end * 1_000).roundToLong()
            activeController.clearLoop()
            if (start >= duration || end > duration || end <= start) {
                segmentError = "This saved segment is outside the current video. Choose an end within ${formatPlaybackTime(duration)}."
                viewModel.clearSeekRequest()
                return@LaunchedEffect
            }
            activeController.setPlaybackSpeed(segment.speed.toFloat())
            activeController.setLoopStart(start)
            activeController.setLoopEnd(end, activatePlayback = false, minimumLoopMs = 1)
        } else activeController.clearLoop()
        activeController.seekTo(request.positionMs)
        if (latestPlaybackIntent) activeController.play() else activeController.pause()
        viewModel.clearSeekRequest()
    }
    ImmersiveSystemBars(playerState.theaterMode)
    BackHandler(enabled = playerState.theaterMode) { controller?.setTheaterMode(false) }

    BoxWithConstraints(
        modifier
            .onKeyEvent { keyEvent ->
                val event = keyEvent.nativeKeyEvent
                if (event.action != AndroidKeyEvent.ACTION_DOWN) return@onKeyEvent false
                val firstPress = event.repeatCount == 0
                when (event.keyCode) {
                    AndroidKeyEvent.KEYCODE_ESCAPE -> if (!firstPress) {
                        false
                    } else when {
                        playerState.theaterMode -> controller?.let { it.setTheaterMode(false); true } ?: false
                        playerState.loop != null || state.seekRequest?.segment != null -> {
                            viewModel.clearSeekRequest()
                            controller?.clearLoop()
                            true
                        }
                        else -> false
                    }

                    AndroidKeyEvent.KEYCODE_SPACE -> if (firstPress) {
                        controller?.let { it.togglePlayPause(); true } ?: false
                    } else false

                    AndroidKeyEvent.KEYCODE_DPAD_LEFT ->
                        controller?.let { viewModel.clearSeekRequest(); it.seekBy(-PRACTICE_SEEK_STEP_MS); true } ?: false

                    AndroidKeyEvent.KEYCODE_DPAD_RIGHT ->
                        controller?.let { viewModel.clearSeekRequest(); it.seekBy(PRACTICE_SEEK_STEP_MS); true } ?: false

                    AndroidKeyEvent.KEYCODE_LEFT_BRACKET -> if (firstPress) {
                        controller?.let { activeController ->
                            viewModel.clearSeekRequest()
                            when {
                                playerState.loop == null -> {
                                    activeController.setLoopStart()
                                    true
                                }
                                playerState.loop.endMs != null -> {
                                    activeController.clearLoop()
                                    activeController.setLoopStart()
                                    true
                                }
                                else -> false
                            }
                        } ?: false
                    } else false

                    AndroidKeyEvent.KEYCODE_RIGHT_BRACKET -> if (
                        firstPress && playerState.loop?.endMs == null && playerState.loop?.startMs != null
                    ) {
                        viewModel.clearSeekRequest()
                        controller?.setLoopEnd() == true
                    } else false

                    AndroidKeyEvent.KEYCODE_M -> if (firstPress) {
                        controller?.let { it.toggleMirrored(); true } ?: false
                    } else false

                    AndroidKeyEvent.KEYCODE_T -> if (firstPress) {
                        controller?.let { it.toggleTheaterMode(); true } ?: false
                    } else false

                    AndroidKeyEvent.KEYCODE_B -> if (firstPress && controller != null) {
                        bookmarkPositionMs = playerState.positionMs
                        true
                    } else false

                    else -> false
                }
            }
            .focusRequester(keyboardFocusRequester)
            .focusable()
            .background(if (playerState.theaterMode) Color.Black else MaterialTheme.colorScheme.background),
    ) {
        val videoHeight = min((maxWidth * 9f / 16f).value, (maxHeight * 0.48f).value).dp.coerceAtLeast(96.dp)
        val useSingleLineControls = maxHeight < 520.dp
        val useCompactTools = maxWidth < 400.dp
        val useShortTabLabels = maxWidth < 360.dp
        Column(Modifier.fillMaxSize()) {
            if (!playerState.theaterMode) {
                LessonTopBar(lesson, favorite, compact, context, viewModel)
            }
            if (lesson.isAvailable) {
            HlsVideoPlayer(
                lesson = lesson,
                pullZone = state.pullZone,
                resumePositionMs = state.practice.positionsMs[lesson.id] ?: 0L,
                initialSeekPositionMs = state.seekRequest?.positionMs,
                playWhenReady = state.playWhenReady,
                onProgress = viewModel::savePlayback,
                onPlaybackIntentChanged = viewModel::setPlaybackIntent,
                onPlayerChanged = {},
                onPracticeControllerChanged = { controller = it },
                modifier = if (playerState.theaterMode) {
                    Modifier.fillMaxWidth().weight(1f)
                } else {
                    Modifier.fillMaxWidth().height(videoHeight)
                },
            )
            PracticeToolbar(
                playerState = playerState,
                controller = controller,
                onTimelineInteraction = viewModel::clearSeekRequest,
                onBookmark = { bookmarkPositionMs = playerState.positionMs },
                previousEnabled = state.previousLesson != null,
                nextEnabled = state.nextLesson != null,
                onPrevious = viewModel::selectPreviousLesson,
                onNext = viewModel::selectNextLesson,
                singleLine = useSingleLineControls,
                compactTools = useCompactTools,
                modifier = Modifier
                    .fillMaxWidth()
                    .then(
                        if (playerState.theaterMode) Modifier.background(Color.Black.copy(alpha = 0.72f))
                        else Modifier,
                    ),
            )
            } else UnavailableLessonMedia(lesson, Modifier.fillMaxWidth().heightIn(min = 120.dp, max = videoHeight.coerceAtLeast(180.dp)))
            if (!playerState.theaterMode) {
                TabRow(selectedTabIndex = workspaceTab) {
                    listOf("My notes", "Lesson guide", "Saved segments").forEachIndexed { index, title ->
                        val label = if (useShortTabLabels) listOf("Notes", "Guide", "Segments")[index] else title
                        Tab(selected = workspaceTab == index, onClick = { workspaceTab = index }, modifier = Modifier.semantics { contentDescription = title }, text = { Text(label, maxLines = 1, overflow = TextOverflow.Ellipsis) })
                    }
                }
                LazyColumn(
                    contentPadding = PaddingValues(start = 16.dp, top = 12.dp, end = 16.dp, bottom = 28.dp),
                    verticalArrangement = Arrangement.spacedBy(13.dp),
                    modifier = Modifier.weight(1f),
                ) {
                    item {
                        LessonOverview(
                            lesson = lesson,
                            watched = watched,
                            chapterCount = if (lesson.isAvailable) lesson.chapters.size else 0,
                            bookmarkCount = bookmarks.size,
                        )
                        LessonPracticeActions(lesson, state, viewModel)
                    }
                    if (workspaceTab == 0) {
                    item { LessonReflectionCard(lesson, state, onEdit = { showReflectionEditor = true }) }
                    val lessonDrafts = state.practice.noteDrafts.values.filter { it.lessonId == lesson.id }
                    if (lessonDrafts.isNotEmpty()) item {
                        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text("Unfinished notes", style = MaterialTheme.typography.titleMedium)
                            lessonDrafts.forEach { draft ->
                                TextButton(onClick = {
                                    if (draft.expected != null) editingBookmarkId = draft.bookmarkId
                                    else bookmarkPositionMs = draft.bookmarkId.substringAfterLast(':').toLongOrNull()
                                }) { Text(draft.text.ifBlank { "Resume note draft" }, maxLines = 2, overflow = TextOverflow.Ellipsis) }
                            }
                        }
                    }
                    state.practice.deletedBookmark?.let {
                        item { TextButton(onClick = viewModel::undoDeleteBookmark) { Text("Undo deleted bookmark") } }
                    }
                    item {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text("Timestamp notes", style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
                            FilledTonalButton(onClick = { bookmarkPositionMs = playerState.positionMs }, enabled = controller != null) {
                                Icon(Icons.Rounded.BookmarkAdd, contentDescription = null)
                                Text("Add note")
                            }
                        }
                    }
                    if (bookmarks.isEmpty()) {
                        item { Text("Pause at a move and add a note to keep the cue beside its timestamp.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    } else {
                        items(bookmarks, key = PracticeBookmark::id) { bookmark ->
                            BookmarkCard(
                                bookmark = bookmark,
                                onOpen = {
                                    controller?.clearLoop()
                                    viewModel.selectLesson(lesson.id, bookmark.positionMs)
                                },
                                onEdit = { editingBookmarkId = bookmark.id },
                                onDelete = { viewModel.deleteBookmark(lesson.id, bookmark.id) },
                            )
                        }
                    }
                    }
                    if (workspaceTab == 1 && !lesson.isAvailable) item { Text(lesson.availabilityReason ?: "The correct source video has not been recovered.", color = MaterialTheme.colorScheme.error) }
                    if (workspaceTab == 1 && lesson.isAvailable) {
                    folderPresentation?.let { presentation -> item { LessonFolderPresentation(presentation) } }
                    if (lesson.introParagraphs.isNotEmpty()) {
                        item {
                            Surface(color = MaterialTheme.colorScheme.surfaceVariant, shape = RoundedCornerShape(16.dp)) {
                                Column(Modifier.padding(15.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
                                    lesson.introParagraphs.forEach { Text(it, style = MaterialTheme.typography.bodyLarge) }
                                }
                            }
                        }
                    }
                    item { Text("Lesson chapters", style = MaterialTheme.typography.titleLarge) }
                    if (lesson.chapters.isEmpty()) {
                        item {
                            Text(
                                cleanMarkdown(lesson.rawSummary).ifBlank { "No chapter notes are available for this lesson yet." },
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    } else {
                        itemsIndexed(lesson.chapters, key = { index, chapter -> "${chapter.seconds}-$index" }) { _, chapter ->
                            ChapterCard(chapter) {
                                controller?.clearLoop()
                                viewModel.selectLesson(lesson.id, chapter.seconds * 1_000L)
                            }
                        }
                    }
                    }
                    if (workspaceTab == 2) {
                        item {
                            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                Text("Repeat the part that needs attention", style = MaterialTheme.typography.titleLarge)
                                Text("Save a named section with its playback speed. An active A–B loop supplies the start and end.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                                Button(onClick = { showSegmentEditor = true }, enabled = lesson.isAvailable) { Text("Save a segment") }
                            }
                        }
                        val segments = state.practice.workspace.segments.filter { it.path == lesson.legacyPath }
                        if (segments.isEmpty()) item { Text("No saved segments yet.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
                        items(segments, key = { it.id }) { segment ->
                            SavedSegmentCard(segment, canPlay = lesson.isAvailable, onPlay = { viewModel.playPracticeSegment(segment) }, onDelete = { viewModel.deletePracticeSegment(segment.id) })
                        }
                    }
                    item {
                        PreviousNextRow(
                            previous = state.previousLesson,
                            next = state.nextLesson,
                            onPrevious = viewModel::selectPreviousLesson,
                            onNext = viewModel::selectNextLesson,
                        )
                    }
                }
            }
        }
    }

    if (showReflectionEditor) LessonReflectionDialog(lesson, state, viewModel, onDismiss = { showReflectionEditor = false })
    bookmarkPositionMs?.let { capturedPositionMs ->
        PracticeNoteEditor(state, viewModel, lesson, null, capturedPositionMs, onDismiss = { bookmarkPositionMs = null })
    }
    val editingBookmark = remember(lesson.id, editingBookmarkId) {
        editingBookmarkId?.let { state.practice.noteDrafts[it]?.expected } ?: bookmarks.firstOrNull { it.id == editingBookmarkId }
    }
    editingBookmark?.let { bookmark -> PracticeNoteEditor(state, viewModel, lesson, bookmark, bookmark.positionMs, onDismiss = { editingBookmarkId = null }) }
    if (showSegmentEditor) SegmentEditorDialog(
        lesson = lesson, initialStartMs = playerState.loop?.startMs ?: playerState.positionMs,
        initialEndMs = playerState.loop?.endMs, durationMs = playerState.durationMs ?: 0L, speed = playerState.speed,
        onDismiss = { showSegmentEditor = false },
        onSave = { title, start, end, speed, complete -> viewModel.savePracticeSegment(lesson, title, start, end, speed) { saved -> complete(saved); if (saved) showSegmentEditor = false } },
    )
    segmentError?.let { message -> AlertDialog(onDismissRequest = { segmentError = null }, title = { Text("Segment cannot play") }, text = { Text(message) }, confirmButton = { TextButton(onClick = { segmentError = null }) { Text("Close") } }) }
}

@Composable
private fun UnavailableLessonMedia(lesson: Lesson, modifier: Modifier = Modifier) {
    Surface(color = MaterialTheme.colorScheme.errorContainer, contentColor = MaterialTheme.colorScheme.onErrorContainer, modifier = modifier) {
        Column(Modifier.padding(18.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(Icons.Rounded.WarningAmber, contentDescription = null)
            Text("Correct source unavailable", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Text(lesson.availabilityReason ?: "This lesson will return when its correct source video is recovered.", style = MaterialTheme.typography.bodyMedium)
        }
    }
}

@Composable
private fun LessonTopBar(
    lesson: Lesson,
    favorite: Boolean,
    compact: Boolean,
    context: Context,
    viewModel: LibraryViewModel,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .height(58.dp)
            .padding(horizontal = 7.dp),
    ) {
        if (compact) {
            IconButton(onClick = { viewModel.selectLesson(null) }) {
                Icon(Icons.AutoMirrored.Rounded.ArrowBack, contentDescription = "Back to library")
            }
        }
        Column(Modifier.weight(1f)) {
            Text((listOf(courseDisplay(lesson.courseDisplayName.ifBlank { lesson.course }, lesson.categoryTitle).heading) + lesson.breadcrumbs).joinToString(" › "), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(lesson.title, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        IconButton(onClick = { shareLesson(context, lesson) }) {
            Icon(Icons.Rounded.Share, contentDescription = "Share lesson")
        }
        IconButton(onClick = { viewModel.setDestination(AppDestination.SETTINGS) }) {
            Icon(Icons.Rounded.Settings, contentDescription = "Open settings")
        }
        IconButton(onClick = { viewModel.toggleFavorite(lesson.id) }) {
            Icon(
                if (favorite) Icons.Rounded.Favorite else Icons.Rounded.FavoriteBorder,
                contentDescription = if (favorite) "Remove from favorites" else "Add to favorites",
                tint = if (favorite) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun PracticeToolbar(
    playerState: PracticePlayerState,
    controller: PracticePlayerController?,
    onTimelineInteraction: () -> Unit,
    onBookmark: () -> Unit,
    previousEnabled: Boolean,
    nextEnabled: Boolean,
    onPrevious: () -> Unit,
    onNext: () -> Unit,
    singleLine: Boolean,
    compactTools: Boolean,
    modifier: Modifier = Modifier,
) {
    var speedMenu by remember { mutableStateOf(false) }
    val foreground = if (playerState.theaterMode) Color.White else MaterialTheme.colorScheme.onSurface
    val transportControls: @Composable () -> Unit = {
        IconButton(onClick = onPrevious, enabled = previousEnabled) {
            Icon(Icons.Rounded.SkipPrevious, contentDescription = "Previous lesson", tint = foreground)
        }
        IconButton(onClick = { onTimelineInteraction(); controller?.seekBy(-PRACTICE_SEEK_STEP_MS) }, enabled = controller != null) {
            Icon(Icons.Rounded.Replay5, contentDescription = "Back 5 seconds", tint = foreground)
        }
        IconButton(onClick = { controller?.togglePlayPause() }, enabled = controller != null) {
            Icon(
                if (playerState.isPlaying) Icons.Rounded.Pause else Icons.Rounded.PlayArrow,
                contentDescription = if (playerState.playWhenReady) "Pause video" else "Play video",
                tint = foreground,
            )
        }
        IconButton(onClick = { onTimelineInteraction(); controller?.seekBy(PRACTICE_SEEK_STEP_MS) }, enabled = controller != null) {
            Icon(Icons.Rounded.Forward5, contentDescription = "Forward 5 seconds", tint = foreground)
        }
        IconButton(onClick = onNext, enabled = nextEnabled) {
            Icon(Icons.Rounded.SkipNext, contentDescription = "Next lesson", tint = foreground)
        }
    }
    val practiceControls: @Composable () -> Unit = {
        Box {
            FilledTonalButton(
                onClick = { speedMenu = true },
                enabled = controller != null,
                contentPadding = PaddingValues(horizontal = 10.dp, vertical = 0.dp),
            ) {
                if (!compactTools) {
                    Icon(Icons.Rounded.Speed, contentDescription = null)
                    Spacer(Modifier.width(4.dp))
                }
                Text("${playerState.speed}×")
            }
            DropdownMenu(expanded = speedMenu, onDismissRequest = { speedMenu = false }) {
                PRACTICE_PLAYBACK_SPEEDS.forEach { speed ->
                    DropdownMenuItem(
                        text = { Text(speedPresetLabel(speed)) },
                        onClick = {
                            controller?.setPlaybackSpeed(speed)
                            speedMenu = false
                        },
                    )
                }
            }
        }
        if (compactTools) FilledTonalIconButton(
            onClick = { controller?.toggleMirrored() },
            enabled = controller != null,
            modifier = Modifier.size(48.dp).semantics { stateDescription = if (playerState.mirrored) "Mirrored" else "Not mirrored" },
        ) {
            Icon(Icons.Rounded.Flip, contentDescription = if (playerState.mirrored) "Mirrored" else "Mirror")
        } else FilledTonalButton(
            onClick = { controller?.toggleMirrored() },
            enabled = controller != null,
            modifier = Modifier.semantics { contentDescription = if (playerState.mirrored) "Mirrored" else "Mirror" },
            contentPadding = PaddingValues(horizontal = 10.dp, vertical = 0.dp),
        ) {
            Icon(Icons.Rounded.Flip, contentDescription = null)
            Spacer(Modifier.width(4.dp))
            Text(if (playerState.mirrored) "Mirrored" else "Mirror")
        }
        val loopLabel = when {
            playerState.loop == null -> "Set A"
            playerState.loop.endMs == null -> "Set B"
            else -> "Clear A–B"
        }
        val onLoopClick = {
                onTimelineInteraction()
                when {
                    playerState.loop == null -> controller?.setLoopStart()
                    playerState.loop.endMs == null -> controller?.setLoopEnd()
                    else -> controller?.clearLoop()
                }
                Unit
        }
        if (compactTools) FilledTonalIconButton(onClick = onLoopClick, enabled = controller != null, modifier = Modifier.size(48.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Rounded.Repeat, contentDescription = loopLabel, modifier = Modifier.size(20.dp))
                if (playerState.loop?.endMs == null) Text(if (playerState.loop == null) "A" else "B", style = MaterialTheme.typography.labelSmall)
            }
        } else FilledTonalButton(
            onClick = onLoopClick,
            enabled = controller != null,
            modifier = Modifier.semantics { contentDescription = loopLabel },
            contentPadding = PaddingValues(horizontal = 10.dp, vertical = 0.dp),
        ) {
            Icon(Icons.Rounded.Repeat, contentDescription = null)
            Spacer(Modifier.width(4.dp))
            Text(loopLabel)
        }
        IconButton(onClick = onBookmark, enabled = controller != null) {
            Icon(Icons.Rounded.BookmarkAdd, contentDescription = "Add bookmark", tint = foreground)
        }
        IconButton(onClick = { controller?.toggleTheaterMode() }, enabled = controller != null) {
            Icon(
                Icons.Rounded.Fullscreen,
                contentDescription = if (playerState.theaterMode) "Exit theater mode" else "Enter theater mode",
                tint = foreground,
            )
        }
    }
    if (singleLine) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(2.dp),
            modifier = modifier
                .heightIn(min = 54.dp)
                .horizontalScroll(rememberScrollState())
                .padding(horizontal = 7.dp, vertical = 4.dp),
        ) {
            transportControls()
            practiceControls()
        }
    } else {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(2.dp),
            modifier = modifier
                .heightIn(min = 54.dp)
                .padding(horizontal = 7.dp, vertical = 4.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(2.dp)) { transportControls() }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(2.dp), modifier = Modifier.horizontalScroll(rememberScrollState())) { practiceControls() }
        }
    }
}

@Composable
private fun LessonOverview(
    lesson: Lesson,
    watched: Boolean,
    chapterCount: Int,
    bookmarkCount: Int,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(lesson.title, style = MaterialTheme.typography.headlineSmall)
        Text(lesson.fullFolderLabel(), color = MaterialTheme.colorScheme.onSurfaceVariant)
        LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            item { InfoPill("$chapterCount ${if (chapterCount == 1) "chapter" else "chapters"}") }
            item { InfoPill("$bookmarkCount ${if (bookmarkCount == 1) "bookmark" else "bookmarks"}") }
            item {
                InfoPill(if (watched) "Viewed" else "Not viewed")
            }
        }
    }
}

@Composable
private fun InfoPill(label: String) {
    Surface(color = MaterialTheme.colorScheme.surfaceVariant, shape = RoundedCornerShape(50)) {
        Text(label, style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp))
    }
}

@Composable
private fun LessonFolderPresentation(presentation: FolderPresentation) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
        Column(Modifier.padding(15.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
            presentation.title?.let { Text(it, style = MaterialTheme.typography.titleLarge) }
            if (presentation.description.isNotBlank()) Text(presentation.description)
            presentation.prerequisites?.let { requirements ->
                if (requirements.on1.isNotEmpty()) Text("On1 prerequisites: ${requirements.on1.joinToString()}")
                if (requirements.on2.isNotEmpty()) Text("On2 prerequisites: ${requirements.on2.joinToString()}")
            }
            presentation.tips?.takeIf(String::isNotBlank)?.let { Text("Tip: $it", color = MaterialTheme.colorScheme.primary) }
            presentation.song?.takeIf(String::isNotBlank)?.let { Text("Song: $it", color = MaterialTheme.colorScheme.secondary) }
        }
    }
}

@Composable
private fun BookmarkCard(
    bookmark: PracticeBookmark,
    onOpen: () -> Unit,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
) {
    Card(onClick = onOpen, colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Row(Modifier.padding(start = 13.dp, top = 7.dp, end = 4.dp, bottom = 7.dp), verticalAlignment = Alignment.CenterVertically) {
            AssistChip(onClick = onOpen, label = { Text(formatPlaybackTime(bookmark.positionMs)) })
            Spacer(Modifier.width(9.dp))
            Text(bookmark.note.ifBlank { "Timestamp bookmark" }, modifier = Modifier.weight(1f), maxLines = 3, overflow = TextOverflow.Ellipsis)
            IconButton(onClick = onEdit) { Icon(Icons.Rounded.Edit, contentDescription = "Edit note") }
            IconButton(onClick = onDelete) { Icon(Icons.Rounded.Delete, contentDescription = "Delete bookmark") }
        }
    }
}

@Composable
private fun ChapterCard(chapter: LessonChapter, onClick: () -> Unit) {
    Card(onClick = onClick, colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.Top) {
            Surface(color = MaterialTheme.colorScheme.primaryContainer, shape = RoundedCornerShape(10.dp)) {
                Text(chapter.label, fontWeight = FontWeight.Bold, modifier = Modifier.padding(horizontal = 9.dp, vertical = 7.dp))
            }
            Spacer(Modifier.width(11.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(chapter.title.ifBlank { "Chapter ${chapter.label}" }, style = MaterialTheme.typography.titleMedium)
                if (chapter.description.isNotBlank()) Text(chapter.description, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Icon(Icons.Rounded.PlayArrow, contentDescription = "Play from ${chapter.label}", tint = MaterialTheme.colorScheme.primary)
        }
    }
}

@Composable
private fun PreviousNextRow(
    previous: Lesson?,
    next: Lesson?,
    onPrevious: () -> Unit,
    onNext: () -> Unit,
) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
        Button(onClick = onPrevious, enabled = previous != null, modifier = Modifier.weight(1f)) {
            Icon(Icons.Rounded.SkipPrevious, contentDescription = null)
            Spacer(Modifier.width(5.dp))
            Text(previous?.title ?: "Previous", maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Button(onClick = onNext, enabled = next != null, modifier = Modifier.weight(1f)) {
            Text(next?.title ?: "Next", maxLines = 1, overflow = TextOverflow.Ellipsis)
            Spacer(Modifier.width(5.dp))
            Icon(Icons.Rounded.SkipNext, contentDescription = null)
        }
    }
}

@Composable
private fun ImmersiveSystemBars(enabled: Boolean) {
    val activity = LocalContext.current.findActivity() ?: return
    DisposableEffect(activity, enabled) {
        val controller = WindowInsetsControllerCompat(activity.window, activity.window.decorView)
        if (enabled) {
            controller.hide(WindowInsetsCompat.Type.systemBars())
            controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        } else {
            controller.show(WindowInsetsCompat.Type.systemBars())
        }
        onDispose { controller.show(WindowInsetsCompat.Type.systemBars()) }
    }
}

private fun speedPresetLabel(speed: Float): String = when (speed) {
    0.5f -> "Learn · 0.5×"
    0.75f -> "Practice · 0.75×"
    1f -> "Full · 1×"
    else -> "$speed×"
}

private fun shareLesson(context: Context, lesson: Lesson) {
    val url = "https://deadlywolf712.github.io/dance-library/#video=${Uri.encode(lesson.legacyPath)}"
    val intent = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_SUBJECT, lesson.title)
        putExtra(Intent.EXTRA_TEXT, "${lesson.title}\n$url")
    }
    context.startActivity(Intent.createChooser(intent, "Share lesson"))
}
