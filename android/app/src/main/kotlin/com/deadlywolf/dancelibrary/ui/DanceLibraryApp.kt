package com.deadlywolf.dancelibrary.ui

import android.content.Intent
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ArrowBack
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Favorite
import androidx.compose.material.icons.rounded.FavoriteBorder
import androidx.compose.material.icons.rounded.History
import androidx.compose.material.icons.rounded.MenuBook
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Share
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.media3.common.Player
import com.deadlywolf.dancelibrary.ALL_CATEGORIES
import com.deadlywolf.dancelibrary.LibraryUiState
import com.deadlywolf.dancelibrary.LibraryViewModel
import com.deadlywolf.dancelibrary.model.Lesson
import com.deadlywolf.dancelibrary.model.LessonChapter
import com.deadlywolf.dancelibrary.model.category
import com.deadlywolf.dancelibrary.model.streamUrl
import com.deadlywolf.dancelibrary.ui.theme.ArcticBlue
import com.deadlywolf.dancelibrary.ui.theme.ArcticOrange
import java.util.Locale
import kotlin.math.min

@Composable
fun DanceLibraryApp(viewModel: LibraryViewModel) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()

    Surface(
        color = MaterialTheme.colorScheme.background,
        modifier = Modifier.fillMaxSize(),
    ) {
        BoxWithConstraints(
            modifier = Modifier
                .fillMaxSize()
                .windowInsetsPadding(WindowInsets.safeDrawing),
        ) {
            val wideLayout = maxWidth >= 840.dp
            BackHandler(enabled = !wideLayout && state.selectedLesson != null) {
                viewModel.selectLesson(null)
            }

            when {
                state.loading -> LoadingState()
                state.errorMessage != null -> CatalogErrorState(state.errorMessage.orEmpty(), viewModel::retryCatalog)
                wideLayout -> Row(Modifier.fillMaxSize()) {
                    LibraryPane(
                        state = state,
                        onQueryChange = viewModel::setQuery,
                        onCategoryChange = viewModel::setCategory,
                        onFavoritesOnlyChange = viewModel::setFavoritesOnly,
                        onSelectLesson = viewModel::selectLesson,
                        onToggleFavorite = viewModel::toggleFavorite,
                        modifier = Modifier
                            .widthIn(min = 360.dp, max = 430.dp)
                            .fillMaxHeight(),
                    )
                    Box(
                        Modifier
                            .width(1.dp)
                            .fillMaxHeight()
                            .background(MaterialTheme.colorScheme.outlineVariant),
                    )
                    state.selectedLesson?.let { lesson ->
                        LessonDetail(
                            lesson = lesson,
                            state = state,
                            compact = false,
                            onBack = { viewModel.selectLesson(null) },
                            onToggleFavorite = { viewModel.toggleFavorite(lesson.id) },
                            onToggleWatched = { watched -> viewModel.setWatched(lesson.id, watched) },
                            onProgress = { position, duration ->
                                viewModel.savePlayback(lesson.id, position, duration)
                            },
                            modifier = Modifier.weight(1f),
                        )
                    } ?: WelcomePanel(
                        state = state,
                        onResume = { state.lastLesson?.id?.let(viewModel::selectLesson) },
                        modifier = Modifier.weight(1f),
                    )
                }

                state.selectedLesson != null -> {
                    val selectedLesson = requireNotNull(state.selectedLesson)
                    LessonDetail(
                        lesson = selectedLesson,
                        state = state,
                        compact = true,
                        onBack = { viewModel.selectLesson(null) },
                        onToggleFavorite = { viewModel.toggleFavorite(selectedLesson.id) },
                        onToggleWatched = { watched -> viewModel.setWatched(selectedLesson.id, watched) },
                        onProgress = { position, duration ->
                            viewModel.savePlayback(selectedLesson.id, position, duration)
                        },
                        modifier = Modifier.fillMaxSize(),
                    )
                }

                else -> LibraryPane(
                    state = state,
                    onQueryChange = viewModel::setQuery,
                    onCategoryChange = viewModel::setCategory,
                    onFavoritesOnlyChange = viewModel::setFavoritesOnly,
                    onSelectLesson = viewModel::selectLesson,
                    onToggleFavorite = viewModel::toggleFavorite,
                    modifier = Modifier.fillMaxSize(),
                )
            }
        }
    }
}

@Composable
private fun LoadingState() {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically),
        modifier = Modifier.fillMaxSize(),
    ) {
        CircularProgressIndicator()
        Text("Opening your dance library…", style = MaterialTheme.typography.titleMedium)
    }
}

@Composable
private fun CatalogErrorState(message: String, onRetry: () -> Unit) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(14.dp, Alignment.CenterVertically),
        modifier = Modifier
            .fillMaxSize()
            .padding(28.dp),
    ) {
        Icon(Icons.Rounded.MenuBook, contentDescription = null, tint = MaterialTheme.colorScheme.error, modifier = Modifier.size(42.dp))
        Text("The library could not open", style = MaterialTheme.typography.headlineSmall)
        Text(message, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Button(onClick = onRetry) {
            Icon(Icons.Rounded.Refresh, contentDescription = null)
            Spacer(Modifier.width(8.dp))
            Text("Try again")
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun LibraryPane(
    state: LibraryUiState,
    onQueryChange: (String) -> Unit,
    onCategoryChange: (String) -> Unit,
    onFavoritesOnlyChange: (Boolean) -> Unit,
    onSelectLesson: (String) -> Unit,
    onToggleFavorite: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier.background(MaterialTheme.colorScheme.background)) {
        Column(
            verticalArrangement = Arrangement.spacedBy(14.dp),
            modifier = Modifier.padding(start = 18.dp, top = 16.dp, end = 18.dp, bottom = 12.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Surface(
                    color = MaterialTheme.colorScheme.primary,
                    contentColor = MaterialTheme.colorScheme.onPrimary,
                    shape = RoundedCornerShape(15.dp),
                    modifier = Modifier.size(48.dp),
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Text("D", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Black)
                    }
                }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text("Dance Library", style = MaterialTheme.typography.titleLarge)
                    Text(
                        "${state.allLessons.size} lessons · streamed from Bunny",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                IconButton(onClick = { onFavoritesOnlyChange(!state.filter.favoritesOnly) }) {
                    Icon(
                        if (state.filter.favoritesOnly) Icons.Rounded.Favorite else Icons.Rounded.FavoriteBorder,
                        contentDescription = if (state.filter.favoritesOnly) "Show all lessons" else "Show favorites only",
                        tint = if (state.filter.favoritesOnly) ArcticOrange else MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            PracticeStats(state)

            OutlinedTextField(
                value = state.filter.query,
                onValueChange = onQueryChange,
                singleLine = true,
                leadingIcon = { Icon(Icons.Rounded.Search, contentDescription = null) },
                placeholder = { Text("Search lessons, instructors, or styles") },
                shape = RoundedCornerShape(16.dp),
                modifier = Modifier.fillMaxWidth(),
            )
        }

        LazyRow(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.fillMaxWidth(),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 18.dp),
        ) {
            item {
                FilterChip(
                    selected = state.filter.category == ALL_CATEGORIES,
                    onClick = { onCategoryChange(ALL_CATEGORIES) },
                    label = { Text("All") },
                )
            }
            items(state.categories) { category ->
                FilterChip(
                    selected = state.filter.category == category,
                    onClick = { onCategoryChange(category) },
                    label = { Text(category) },
                )
            }
        }

        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.padding(horizontal = 18.dp, vertical = 10.dp),
        ) {
            Text(
                "${state.visibleLessons.size} ${if (state.visibleLessons.size == 1) "lesson" else "lessons"}",
                style = MaterialTheme.typography.labelLarge,
                modifier = Modifier.weight(1f),
            )
            if (state.filter.favoritesOnly) {
                TextButton(onClick = { onFavoritesOnlyChange(false) }) { Text("Clear favorites filter") }
            }
        }

        if (state.visibleLessons.isEmpty()) {
            EmptyResults(modifier = Modifier.weight(1f))
        } else {
            LazyColumn(
                verticalArrangement = Arrangement.spacedBy(10.dp),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(start = 14.dp, end = 14.dp, bottom = 24.dp),
                modifier = Modifier.weight(1f),
            ) {
                items(state.visibleLessons, key = Lesson::id) { lesson ->
                    LessonCard(
                        lesson = lesson,
                        favorite = lesson.id in state.practice.favorites,
                        watched = lesson.id in state.practice.watched,
                        resumePositionMs = state.practice.positionsMs[lesson.id],
                        selected = lesson.id == state.selectedLesson?.id,
                        onClick = { onSelectLesson(lesson.id) },
                        onToggleFavorite = { onToggleFavorite(lesson.id) },
                    )
                }
            }
        }
    }
}

@Composable
private fun PracticeStats(state: LibraryUiState) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
        StatPill("Watched", state.watchedCount.toString(), Icons.Rounded.CheckCircle, Modifier.weight(1f))
        StatPill("Favorites", state.favoriteCount.toString(), Icons.Rounded.Favorite, Modifier.weight(1f))
        StatPill("In progress", state.practice.positionsMs.size.toString(), Icons.Rounded.History, Modifier.weight(1f))
    }
}

@Composable
private fun StatPill(label: String, value: String, icon: androidx.compose.ui.graphics.vector.ImageVector, modifier: Modifier) {
    Surface(
        color = MaterialTheme.colorScheme.surfaceVariant,
        shape = RoundedCornerShape(14.dp),
        modifier = modifier,
    ) {
        Column(Modifier.padding(horizontal = 10.dp, vertical = 9.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(icon, contentDescription = null, tint = ArcticBlue, modifier = Modifier.size(16.dp))
                Spacer(Modifier.width(5.dp))
                Text(value, style = MaterialTheme.typography.titleMedium)
            }
            Text(label, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
        }
    }
}

@Composable
private fun LessonCard(
    lesson: Lesson,
    favorite: Boolean,
    watched: Boolean,
    resumePositionMs: Long?,
    selected: Boolean,
    onClick: () -> Unit,
    onToggleFavorite: () -> Unit,
) {
    Card(
        onClick = onClick,
        colors = CardDefaults.cardColors(
            containerColor = if (selected) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surface,
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = if (selected) 0.dp else 1.dp),
        modifier = Modifier
            .fillMaxWidth()
            .then(
                if (selected) Modifier.border(1.dp, MaterialTheme.colorScheme.primary, MaterialTheme.shapes.medium)
                else Modifier,
            ),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.padding(start = 15.dp, top = 12.dp, end = 6.dp, bottom = 12.dp),
        ) {
            Box(
                contentAlignment = Alignment.Center,
                modifier = Modifier
                    .size(42.dp)
                    .clip(RoundedCornerShape(13.dp))
                    .background(if (watched) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surfaceVariant),
            ) {
                Icon(
                    if (watched) Icons.Rounded.CheckCircle else Icons.Rounded.PlayArrow,
                    contentDescription = null,
                    tint = if (watched) ArcticOrange else ArcticBlue,
                )
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(lesson.title, style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text(
                    lesson.course,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(lesson.category, style = MaterialTheme.typography.labelLarge, color = ArcticBlue)
                    resumePositionMs?.let {
                        Text("Resume ${formatTime(it)}", style = MaterialTheme.typography.bodyMedium, color = ArcticOrange)
                    }
                }
            }
            IconButton(onClick = onToggleFavorite) {
                Icon(
                    if (favorite) Icons.Rounded.Favorite else Icons.Rounded.FavoriteBorder,
                    contentDescription = if (favorite) "Remove from favorites" else "Add to favorites",
                    tint = if (favorite) ArcticOrange else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun EmptyResults(modifier: Modifier = Modifier) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterVertically),
        modifier = modifier
            .fillMaxWidth()
            .padding(32.dp),
    ) {
        Icon(Icons.Rounded.Search, contentDescription = null, modifier = Modifier.size(38.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Text("No lessons match", style = MaterialTheme.typography.titleMedium)
        Text("Try a shorter search or another style.", color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun WelcomePanel(state: LibraryUiState, onResume: () -> Unit, modifier: Modifier = Modifier) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically),
        modifier = modifier.padding(48.dp),
    ) {
        Surface(color = MaterialTheme.colorScheme.primaryContainer, shape = RoundedCornerShape(28.dp)) {
            Icon(Icons.Rounded.PlayArrow, contentDescription = null, tint = ArcticBlue, modifier = Modifier.padding(24.dp).size(56.dp))
        }
        Text("Ready when you are", style = MaterialTheme.typography.headlineSmall)
        Text(
            "Choose a lesson to stream it directly from Bunny. Your favorites and place are saved on this device.",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        state.lastLesson?.let {
            FilledTonalButton(onClick = onResume) {
                Icon(Icons.Rounded.History, contentDescription = null)
                Spacer(Modifier.width(8.dp))
                Text("Resume ${it.title}", maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

@Composable
private fun LessonDetail(
    lesson: Lesson,
    state: LibraryUiState,
    compact: Boolean,
    onBack: () -> Unit,
    onToggleFavorite: () -> Unit,
    onToggleWatched: (Boolean) -> Unit,
    onProgress: (Long, Long) -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val favorite = lesson.id in state.practice.favorites
    val watched = lesson.id in state.practice.watched
    var player by remember(lesson.id) { mutableStateOf<Player?>(null) }

    BoxWithConstraints(modifier.background(MaterialTheme.colorScheme.background)) {
        val idealVideoHeight = maxWidth * 9f / 16f
        val constrainedVideoHeight = min(idealVideoHeight.value, maxHeight.value * 0.55f).dp.coerceAtLeast(140.dp)

        Column(Modifier.fillMaxSize()) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(60.dp)
                    .padding(horizontal = 8.dp),
            ) {
                if (compact) {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Rounded.ArrowBack, contentDescription = "Back to library")
                    }
                }
                Column(Modifier.weight(1f)) {
                    Text(lesson.category, style = MaterialTheme.typography.labelLarge, color = ArcticBlue)
                    Text(lesson.title, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                IconButton(onClick = {
                    val share = Intent(Intent.ACTION_SEND).apply {
                        type = "text/plain"
                        putExtra(Intent.EXTRA_SUBJECT, lesson.title)
                        putExtra(Intent.EXTRA_TEXT, "${lesson.title}\n${lesson.streamUrl(state.pullZone)}")
                    }
                    context.startActivity(Intent.createChooser(share, "Share lesson stream"))
                }) {
                    Icon(Icons.Rounded.Share, contentDescription = "Share lesson stream")
                }
                IconButton(onClick = onToggleFavorite) {
                    Icon(
                        if (favorite) Icons.Rounded.Favorite else Icons.Rounded.FavoriteBorder,
                        contentDescription = if (favorite) "Remove from favorites" else "Add to favorites",
                        tint = if (favorite) ArcticOrange else MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            HlsVideoPlayer(
                lesson = lesson,
                pullZone = state.pullZone,
                resumePositionMs = state.practice.positionsMs[lesson.id] ?: 0L,
                onProgress = onProgress,
                onPlayerChanged = { player = it },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(constrainedVideoHeight),
            )

            LazyColumn(
                contentPadding = androidx.compose.foundation.layout.PaddingValues(18.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
                modifier = Modifier.weight(1f),
            ) {
                item {
                    Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
                        Text(lesson.title, style = MaterialTheme.typography.headlineSmall)
                        Text(
                            listOf(lesson.course, lesson.breadcrumbs.joinToString(" › "))
                                .filter(String::isNotBlank)
                                .joinToString("  ·  "),
                            style = MaterialTheme.typography.bodyLarge,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                            AssistChip(onClick = {}, enabled = false, label = { Text("${lesson.chapters.size} chapters") })
                            FilledTonalButton(onClick = { onToggleWatched(!watched) }) {
                                Icon(if (watched) Icons.Rounded.CheckCircle else Icons.Rounded.MenuBook, contentDescription = null)
                                Spacer(Modifier.width(7.dp))
                                Text(if (watched) "Watched" else "Mark watched")
                            }
                        }
                    }
                }

                if (lesson.introParagraphs.isNotEmpty()) {
                    item {
                        Surface(color = MaterialTheme.colorScheme.surfaceVariant, shape = RoundedCornerShape(16.dp)) {
                            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                                lesson.introParagraphs.forEach { paragraph ->
                                    Text(paragraph, style = MaterialTheme.typography.bodyLarge)
                                }
                            }
                        }
                    }
                }

                item {
                    Text("Lesson chapters", style = MaterialTheme.typography.titleLarge)
                }

                if (lesson.chapters.isEmpty()) {
                    item {
                        Text(
                            cleanMarkdown(lesson.rawSummary).ifBlank { "No chapter notes are available for this lesson yet." },
                            style = MaterialTheme.typography.bodyLarge,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                } else {
                    itemsIndexed(lesson.chapters, key = { index, chapter -> "${chapter.seconds}-$index" }) { _, chapter ->
                        ChapterCard(chapter = chapter) {
                            player?.seekTo(chapter.seconds * 1_000L)
                            player?.play()
                        }
                    }
                }

                item { Spacer(Modifier.height(12.dp)) }
            }
        }
    }
}

@Composable
private fun ChapterCard(chapter: LessonChapter, onClick: () -> Unit) {
    Card(
        onClick = onClick,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(modifier = Modifier.padding(15.dp), verticalAlignment = Alignment.Top) {
            Surface(color = MaterialTheme.colorScheme.primaryContainer, shape = RoundedCornerShape(10.dp)) {
                Text(
                    chapter.label,
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.onPrimaryContainer,
                    modifier = Modifier.padding(horizontal = 9.dp, vertical = 7.dp),
                )
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                Text(chapter.title.ifBlank { "Chapter ${chapter.label}" }, style = MaterialTheme.typography.titleMedium)
                if (chapter.description.isNotBlank()) {
                    Text(chapter.description, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            Icon(Icons.Rounded.PlayArrow, contentDescription = "Play from ${chapter.label}", tint = ArcticBlue)
        }
    }
}

private fun formatTime(milliseconds: Long): String {
    val totalSeconds = (milliseconds / 1_000L).coerceAtLeast(0)
    val hours = totalSeconds / 3_600
    val minutes = (totalSeconds % 3_600) / 60
    val seconds = totalSeconds % 60
    return if (hours > 0) String.format(Locale.US, "%d:%02d:%02d", hours, minutes, seconds)
    else String.format(Locale.US, "%d:%02d", minutes, seconds)
}

private fun cleanMarkdown(value: String): String = value
    .replace("**", "")
    .replace(Regex("(?m)^\\s*[-*]\\s*"), "")
    .trim()
