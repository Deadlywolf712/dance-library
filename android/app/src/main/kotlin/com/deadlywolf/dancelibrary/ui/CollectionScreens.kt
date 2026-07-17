package com.deadlywolf.dancelibrary.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ContentCopy
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.History
import androidx.compose.material.icons.rounded.NoteAlt
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.deadlywolf.dancelibrary.AppDestination
import com.deadlywolf.dancelibrary.LibraryUiState
import com.deadlywolf.dancelibrary.LibraryViewModel
import com.deadlywolf.dancelibrary.data.MAX_UI_NOTE_LENGTH
import com.deadlywolf.dancelibrary.data.MAX_IMPORTED_NOTE_LENGTH
import com.deadlywolf.dancelibrary.data.PracticeBookmark
import com.deadlywolf.dancelibrary.data.PracticeReset
import com.deadlywolf.dancelibrary.model.Lesson

@Composable
internal fun FavoritesScreen(
    state: LibraryUiState,
    viewModel: LibraryViewModel,
    modifier: Modifier = Modifier,
) {
    var query by rememberSaveable { mutableStateOf("") }
    var removedLessonId by rememberSaveable { mutableStateOf<String?>(null) }
    val lessons = remember(state.catalog, state.practice.favorites, query) {
        state.allLessons.asSequence()
            .filter { it.id in state.practice.favorites }
            .filter { it.matchesCollectionQuery(query) }
            .sortedBy { it.catalogOrdinal }
            .toList()
    }
    CollectionColumn(
        title = "Favorites",
        subtitle = "${lessons.size} saved ${if (lessons.size == 1) "lesson" else "lessons"}",
        query = query,
        onQueryChange = { query = it },
        placeholder = "Search favorites",
        modifier = modifier,
    ) {
        removedLessonId?.let { lessonId ->
            val removed = state.allLessons.firstOrNull { it.id == lessonId }
            if (removed != null) {
                item(key = "favorite-undo") {
                    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer)) {
                        Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 9.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text("Removed ${removed.title}", maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                            TextButton(onClick = {
                                viewModel.toggleFavorite(lessonId)
                                removedLessonId = null
                            }) { Text("Undo") }
                        }
                    }
                }
            }
        }
        if (lessons.isEmpty()) {
            item { EmptyCollection("No favorite lessons", "Tap the heart on any lesson to keep it here.") }
        } else {
            items(lessons, key = Lesson::id) { lesson ->
                LessonRow(
                    lesson = lesson,
                    favorite = true,
                    watched = lesson.id in state.practice.watched,
                    resumePositionMs = state.practice.positionsMs[lesson.id],
                    bookmarkCount = state.practice.bookmarks[lesson.id].orEmpty().size,
                    subtitle = lesson.fullFolderLabel(),
                    onClick = {
                        viewModel.setDestination(AppDestination.LIBRARY)
                        viewModel.selectLesson(lesson.id)
                    },
                    onToggleFavorite = {
                        removedLessonId = lesson.id
                        viewModel.toggleFavorite(lesson.id)
                    },
                )
            }
        }
    }
}

@Composable
internal fun HistoryScreen(
    state: LibraryUiState,
    viewModel: LibraryViewModel,
    modifier: Modifier = Modifier,
) {
    var query by rememberSaveable { mutableStateOf("") }
    var confirmClear by remember { mutableStateOf(false) }
    val history = remember(state.catalog, state.practice.lastWatchedAtMs, state.practice.watched, query) {
        state.allLessons.asSequence()
            .filter { it.id in state.practice.watched }
            .filter { it.matchesCollectionQuery(query) }
            .sortedByDescending { state.practice.lastWatchedAtMs[it.id] ?: 0L }
            .toList()
    }
    Column(modifier.fillMaxSize()) {
        CollectionHeader(
            title = "History",
            subtitle = "${history.size} opened ${if (history.size == 1) "lesson" else "lessons"}",
            trailing = if (history.isNotEmpty()) {
                { TextButton(onClick = { confirmClear = true }) { Text("Clear") } }
            } else null,
        )
        SearchField(query, { query = it }, "Search history", Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
        LazyColumn(
            verticalArrangement = Arrangement.spacedBy(10.dp),
            contentPadding = PaddingValues(14.dp),
            modifier = Modifier.weight(1f),
        ) {
            if (history.isEmpty()) {
                item { EmptyCollection("No watch history", "Lessons appear here as soon as you open them.") }
            } else {
                items(history, key = Lesson::id) { lesson ->
                    val openedAt = state.practice.lastWatchedAtMs[lesson.id]
                    LessonRow(
                        lesson = lesson,
                        favorite = lesson.id in state.practice.favorites,
                        watched = true,
                        resumePositionMs = state.practice.positionsMs[lesson.id],
                        bookmarkCount = state.practice.bookmarks[lesson.id].orEmpty().size,
                        subtitle = buildString {
                            append(lesson.fullFolderLabel())
                            openedAt?.let { append(" · Opened ").append(formatRelativeTime(it)) }
                        },
                        onClick = {
                            viewModel.setDestination(AppDestination.LIBRARY)
                            viewModel.selectLesson(lesson.id)
                        },
                        onToggleFavorite = { viewModel.toggleFavorite(lesson.id) },
                    )
                }
            }
        }
    }
    if (confirmClear) {
        AlertDialog(
            onDismissRequest = { confirmClear = false },
            title = { Text("Clear history and resume positions?") },
            text = { Text("This removes opened-lesson history and saved playback positions. Favorites and notes stay safe.") },
            confirmButton = {
                TextButton(onClick = {
                    viewModel.reset(PracticeReset.WATCH_HISTORY)
                    confirmClear = false
                }) { Text("Clear") }
            },
            dismissButton = { TextButton(onClick = { confirmClear = false }) { Text("Cancel") } },
        )
    }
}

@Composable
internal fun NotesScreen(
    state: LibraryUiState,
    viewModel: LibraryViewModel,
    modifier: Modifier = Modifier,
) {
    var query by rememberSaveable { mutableStateOf("") }
    var notesOnly by rememberSaveable { mutableStateOf(false) }
    var confirmClearNotes by remember { mutableStateOf(false) }
    var editingLessonId by rememberSaveable { mutableStateOf<String?>(null) }
    var editingBookmarkId by rememberSaveable { mutableStateOf<String?>(null) }
    val context = LocalContext.current
    val lessonById = remember(state.catalog) { state.allLessons.associateBy(Lesson::id) }
    val groups = remember(state.practice.bookmarks, query, notesOnly, state.catalog) {
        state.practice.bookmarks.mapNotNull { (lessonId, bookmarks) ->
            val lesson = lessonById[lessonId] ?: return@mapNotNull null
            val filtered = bookmarks.filter { bookmark ->
                (!notesOnly || bookmark.note.isNotBlank()) && (
                    query.isBlank() || lesson.matchesCollectionQuery(query) || bookmark.note.contains(query, ignoreCase = true)
                )
            }.sortedBy(PracticeBookmark::positionMs)
            if (filtered.isEmpty()) null else NoteGroup(lesson, filtered)
        }.sortedWith(compareByDescending<NoteGroup> { it.bookmarks.size }.thenBy { it.lesson.title })
    }

    LaunchedEffect(Unit) { viewModel.markNotesSeen() }

    Column(modifier.fillMaxSize()) {
        CollectionHeader(
            title = "Bookmarks & notes",
            subtitle = "${state.practice.bookmarkCount} bookmarks across ${state.practice.bookmarks.count { it.value.isNotEmpty() }} lessons",
            trailing = if (state.practice.bookmarkCount > 0) {
                { TextButton(onClick = { confirmClearNotes = true }) { Text("Clear") } }
            } else null,
        )
        SearchField(query, { query = it }, "Search lessons and notes", Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
        Row(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.padding(horizontal = 16.dp),
        ) {
            FilterChip(selected = !notesOnly, onClick = { notesOnly = false }, label = { Text("All") })
            FilterChip(selected = notesOnly, onClick = { notesOnly = true }, label = { Text("With notes") })
        }
        LazyColumn(
            verticalArrangement = Arrangement.spacedBy(12.dp),
            contentPadding = PaddingValues(14.dp),
            modifier = Modifier.weight(1f),
        ) {
            if (groups.isEmpty()) {
                item { EmptyCollection("No matching notes", "Add a timestamp bookmark while practicing, with or without a note.") }
            } else {
                items(groups, key = { it.lesson.id }) { group ->
                    NoteGroupCard(
                        group = group,
                        onOpen = { bookmark ->
                            viewModel.setDestination(AppDestination.LIBRARY)
                            viewModel.selectLesson(group.lesson.id, bookmark.positionMs)
                        },
                        onCopy = { bookmark -> copyNote(context, group.lesson, bookmark) },
                        onEdit = { bookmark ->
                            editingLessonId = group.lesson.id
                            editingBookmarkId = bookmark.id
                        },
                        onDelete = { bookmark -> viewModel.deleteBookmark(group.lesson.id, bookmark.id) },
                    )
                }
            }
        }
    }

    if (confirmClearNotes) {
        AlertDialog(
            onDismissRequest = { confirmClearNotes = false },
            title = { Text("Clear all bookmarks and notes?") },
            text = { Text("This removes every saved timestamp and note. History and favorites stay safe.") },
            confirmButton = {
                TextButton(onClick = {
                    viewModel.reset(PracticeReset.BOOKMARKS_AND_NOTES)
                    confirmClearNotes = false
                }) { Text("Clear") }
            },
            dismissButton = { TextButton(onClick = { confirmClearNotes = false }) { Text("Cancel") } },
        )
    }

    val editingLesson = editingLessonId?.let(lessonById::get)
    val editingBookmark = editingLessonId?.let(state.practice.bookmarks::get)
        ?.firstOrNull { it.id == editingBookmarkId }
    if (editingLesson != null && editingBookmark != null) {
        NoteEditorDialog(
            title = "Edit note at ${formatPlaybackTime(editingBookmark.positionMs)}",
            initialValue = editingBookmark.note,
            maxLength = MAX_IMPORTED_NOTE_LENGTH,
            onDismiss = {
                editingLessonId = null
                editingBookmarkId = null
            },
            onSave = { note ->
                viewModel.updateBookmarkNote(editingLesson.id, editingBookmark.id, note)
                editingLessonId = null
                editingBookmarkId = null
            },
        )
    }
}

private data class NoteGroup(val lesson: Lesson, val bookmarks: List<PracticeBookmark>)

@Composable
private fun NoteGroupCard(
    group: NoteGroup,
    onOpen: (PracticeBookmark) -> Unit,
    onCopy: (PracticeBookmark) -> Unit,
    onEdit: (PracticeBookmark) -> Unit,
    onDelete: (PracticeBookmark) -> Unit,
) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
            Text(group.lesson.title, style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(group.lesson.fullFolderLabel(), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            group.bookmarks.forEach { bookmark ->
                Card(
                    onClick = { onOpen(bookmark) },
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Column(Modifier.padding(start = 12.dp, top = 8.dp, end = 4.dp, bottom = 8.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            AssistChip(onClick = { onOpen(bookmark) }, label = { Text(formatPlaybackTime(bookmark.positionMs)) })
                            Spacer(Modifier.width(8.dp))
                            Column(Modifier.weight(1f)) {
                                Text(bookmark.note.ifBlank { "Timestamp bookmark" }, style = MaterialTheme.typography.bodyMedium)
                                Text(formatRelativeTime(bookmark.updatedAtMs), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            IconButton(onClick = { onCopy(bookmark) }) {
                                Icon(Icons.Rounded.ContentCopy, contentDescription = "Copy note")
                            }
                            IconButton(onClick = { onEdit(bookmark) }) {
                                Icon(Icons.Rounded.Edit, contentDescription = "Edit note")
                            }
                            IconButton(onClick = { onDelete(bookmark) }) {
                                Icon(Icons.Rounded.Delete, contentDescription = "Delete bookmark")
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
internal fun NoteEditorDialog(
    title: String,
    initialValue: String,
    maxLength: Int = MAX_UI_NOTE_LENGTH,
    onDismiss: () -> Unit,
    onSave: (String) -> Unit,
) {
    var value by rememberSaveable(initialValue, maxLength) { mutableStateOf(initialValue.take(maxLength)) }
    AlertDialog(
        onDismissRequest = onDismiss,
        icon = { Icon(Icons.Rounded.NoteAlt, contentDescription = null) },
        title = { Text(title) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                OutlinedTextField(
                    value = value,
                    onValueChange = { value = it.take(maxLength) },
                    label = { Text("Optional note") },
                    supportingText = { Text("${value.length}/$maxLength") },
                    minLines = 2,
                    maxLines = 4,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = { TextButton(onClick = { onSave(value.trim()) }) { Text("Save") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
private fun CollectionColumn(
    title: String,
    subtitle: String,
    query: String,
    onQueryChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier,
    content: androidx.compose.foundation.lazy.LazyListScope.() -> Unit,
) {
    Column(modifier.fillMaxSize()) {
        CollectionHeader(title, subtitle)
        SearchField(query, onQueryChange, placeholder, Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
        LazyColumn(
            verticalArrangement = Arrangement.spacedBy(10.dp),
            contentPadding = PaddingValues(14.dp),
            modifier = Modifier.weight(1f),
            content = content,
        )
    }
}

@Composable
internal fun CollectionHeader(
    title: String,
    subtitle: String,
    trailing: (@Composable () -> Unit)? = null,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 18.dp, vertical = 14.dp),
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.headlineSmall)
            Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        trailing?.invoke()
    }
}

@Composable
internal fun SearchField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        singleLine = true,
        leadingIcon = { Icon(Icons.Rounded.Search, contentDescription = null) },
        placeholder = { Text(placeholder) },
        shape = RoundedCornerShape(16.dp),
        modifier = modifier.fillMaxWidth(),
    )
}

@Composable
private fun EmptyCollection(title: String, subtitle: String) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 28.dp, vertical = 54.dp),
    ) {
        Icon(Icons.Rounded.History, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(title, style = MaterialTheme.typography.titleMedium)
        Text(subtitle, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

private fun Lesson.matchesCollectionQuery(query: String): Boolean {
    if (query.isBlank()) return true
    val haystack = listOf(title, course, breadcrumbs.joinToString(" "), legacyPath).joinToString(" ")
    return query.trim().split(Regex("\\s+")).all { term -> haystack.contains(term, ignoreCase = true) }
}

internal fun Lesson.fullFolderLabel(): String = (listOf(course) + breadcrumbs)
    .filter(String::isNotBlank)
    .joinToString(" › ")

private fun copyNote(context: Context, lesson: Lesson, bookmark: PracticeBookmark) {
    val text = buildString {
        append(lesson.title).append(" [").append(formatPlaybackTime(bookmark.positionMs)).append(']')
        if (bookmark.note.isNotBlank()) append("\n").append(bookmark.note)
    }
    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    clipboard.setPrimaryClip(ClipData.newPlainText("Dance Library note", text))
}
