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
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
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
import com.deadlywolf.dancelibrary.data.PracticeReflection
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
                    completed = lesson.legacyPath in state.practice.workspace.completed,
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
                        completed = lesson.legacyPath in state.practice.workspace.completed,
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
    var recentlyEdited by rememberSaveable { mutableStateOf(true) }
    var confirmClearNotes by remember { mutableStateOf(false) }
    var editingLessonId by rememberSaveable { mutableStateOf<String?>(null) }
    var editingBookmarkId by rememberSaveable { mutableStateOf<String?>(null) }
    var editingPositionMs by rememberSaveable { mutableStateOf<Long?>(null) }
    val context = LocalContext.current
    val lessonById = remember(state.catalog) { state.allLessons.associateBy(Lesson::id) }
    val groups = remember(state.practice.bookmarks, state.practice.workspace.reflections, query, notesOnly, recentlyEdited, state.catalog) {
        state.allLessons.mapNotNull { lesson ->
            val bookmarks = state.practice.bookmarks[lesson.id].orEmpty()
            val filtered = bookmarks.filter { bookmark ->
                (!notesOnly || bookmark.note.isNotBlank()) && lesson.matchesNotebookQuery(query, bookmark.note)
            }.sortedBy(PracticeBookmark::positionMs)
            val reflection = state.practice.workspace.reflections[lesson.legacyPath]
                ?.takeIf { it.text.isNotBlank() && lesson.matchesNotebookQuery(query, it.text) }
            if (filtered.isEmpty() && reflection == null) null else NoteGroup(lesson, filtered, reflection)
        }.let { groups ->
            if (recentlyEdited) groups.sortedWith(compareByDescending<NoteGroup> { group ->
                maxOf(group.bookmarks.maxOfOrNull { it.updatedAtMs } ?: 0L, group.reflection?.updatedAt ?: 0L)
            }.thenBy { it.lesson.title }) else groups.sortedBy { it.lesson.title.lowercase() }
        }
    }

    LaunchedEffect(Unit) { viewModel.markNotesSeen() }
    val reflectionCount = state.practice.workspace.reflections.count { it.value.text.isNotBlank() }

    Column(modifier.fillMaxSize()) {
        CollectionHeader(
            title = "Notebook",
            subtitle = "${state.practice.bookmarkCount} ${if (state.practice.bookmarkCount == 1) "bookmark" else "bookmarks"} · $reflectionCount ${if (reflectionCount == 1) "reflection" else "reflections"}",
            trailing = if (state.practice.bookmarkCount > 0) {
                { TextButton(onClick = { confirmClearNotes = true }) { Text("Clear bookmarks") } }
            } else null,
        )
        SearchField(query, { query = it }, "Search lessons and notes", Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
        Row(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp),
        ) {
            FilterChip(selected = !notesOnly, onClick = { notesOnly = false }, label = { Text("All") })
            FilterChip(selected = notesOnly, onClick = { notesOnly = true }, label = { Text("With notes") })
            FilterChip(selected = recentlyEdited, onClick = { recentlyEdited = !recentlyEdited }, label = { Text(if (recentlyEdited) "Recently edited" else "Lesson title") })
        }
        LazyColumn(
            verticalArrangement = Arrangement.spacedBy(12.dp),
            contentPadding = PaddingValues(14.dp),
            modifier = Modifier.weight(1f),
        ) {
            state.practice.deletedBookmark?.let {
                item(key = "notebook-undo") { TextButton(onClick = viewModel::undoDeleteBookmark) { Text("Undo deleted bookmark") } }
            }
            val drafts = state.practice.noteDrafts.values.filter { it.lessonId in lessonById }
            if (drafts.isNotEmpty()) item(key = "notebook-drafts") {
                Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer)) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text("Unfinished notes", style = MaterialTheme.typography.titleMedium)
                        drafts.sortedByDescending { it.updatedAt }.forEach { draft ->
                            TextButton(onClick = {
                                editingLessonId = draft.lessonId
                                editingBookmarkId = draft.expected?.id
                                editingPositionMs = draft.expected?.positionMs ?: draft.bookmarkId.substringAfterLast(':').toLongOrNull()
                            }) {
                                Column(Modifier.fillMaxWidth()) {
                                    Text(lessonById[draft.lessonId]?.title.orEmpty(), maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    Text(draft.text.ifBlank { "Resume draft" }, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                }
                            }
                        }
                    }
                }
            }
            val reflectionDrafts = state.practice.reflectionDrafts.entries.mapNotNull { (path, draft) ->
                state.allLessons.firstOrNull { it.legacyPath == path }?.let { it to draft }
            }
            if (reflectionDrafts.isNotEmpty()) item(key = "notebook-reflection-drafts") {
                Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer)) {
                    Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text("Unfinished reflections", style = MaterialTheme.typography.titleMedium)
                        reflectionDrafts.forEach { (lesson, draft) ->
                            TextButton(onClick = { viewModel.setDestination(AppDestination.LIBRARY); viewModel.selectLesson(lesson.id) }) {
                                Column(Modifier.fillMaxWidth()) {
                                    Text(lesson.title, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    Text(draft.text.ifBlank { "Resume reflection draft" }, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                }
                            }
                        }
                    }
                }
            }
            if (groups.isEmpty()) {
                item { EmptyCollection("No matching notes", "Add a timestamp note or lesson reflection while practicing.") }
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
                            editingPositionMs = bookmark.positionMs
                        },
                        onDelete = { bookmark -> viewModel.deleteBookmark(group.lesson.id, bookmark.id) },
                        onOpenReflection = {
                            viewModel.setDestination(AppDestination.LIBRARY)
                            viewModel.selectLesson(group.lesson.id)
                        },
                    )
                }
            }
        }
    }

    if (confirmClearNotes) {
        AlertDialog(
            onDismissRequest = { confirmClearNotes = false },
            title = { Text("Clear all timestamp bookmarks?") },
            text = { Text("This removes saved timestamps and their notes. Lesson reflections are managed separately in practice data.") },
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
    val editingBookmark = remember(editingLessonId, editingBookmarkId) {
        editingBookmarkId?.let { state.practice.noteDrafts[it]?.expected }
            ?: editingLessonId?.let(state.practice.bookmarks::get)?.firstOrNull { it.id == editingBookmarkId }
    }
    if (editingLesson != null && editingPositionMs != null) {
        PracticeNoteEditor(
            state = state, viewModel = viewModel, lesson = editingLesson, bookmark = editingBookmark, positionMs = editingPositionMs!!,
            onDismiss = {
                editingLessonId = null
                editingBookmarkId = null
                editingPositionMs = null
            },
        )
    }
}

private class NoteGroup(lesson: Lesson, bookmarks: List<PracticeBookmark>, reflection: PracticeReflection?) {
    val lesson: Lesson = lesson
    val bookmarks: List<PracticeBookmark> = bookmarks
    val reflection: PracticeReflection? = reflection
}

@Composable
private fun NoteGroupCard(
    group: NoteGroup,
    onOpen: (PracticeBookmark) -> Unit,
    onCopy: (PracticeBookmark) -> Unit,
    onEdit: (PracticeBookmark) -> Unit,
    onDelete: (PracticeBookmark) -> Unit,
    onOpenReflection: () -> Unit,
) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
            Text(group.lesson.title, style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(group.lesson.fullFolderLabel(), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            group.reflection?.let { reflection ->
                Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer)) {
                    Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("Lesson reflection", style = MaterialTheme.typography.labelLarge)
                        Text(reflection.text, maxLines = 10, overflow = TextOverflow.Ellipsis)
                        Text(formatRelativeTime(reflection.updatedAt), style = MaterialTheme.typography.bodySmall)
                        TextButton(onClick = onOpenReflection) { Text("Open reflection") }
                    }
                }
            }
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
                            Text(formatRelativeTime(bookmark.updatedAtMs), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Text(bookmark.note.ifBlank { "Timestamp bookmark" }, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(end = 10.dp), maxLines = 10, overflow = TextOverflow.Ellipsis)
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
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
    editorKey: String = title,
    saving: Boolean = false,
    status: String? = null,
    savedDraftValue: String? = null,
    tracksDraft: Boolean = false,
    onDraftChange: (String) -> Unit = {},
    onDiscardDraft: (() -> Unit)? = null,
    onDismiss: () -> Unit,
    onSave: (String) -> Unit,
) {
    var value by rememberSaveable(editorKey) { mutableStateOf(initialValue) }
    val context = LocalContext.current
    EditorDialog(
        onDismissRequest = { if (!saving) onDismiss() },
        icon = { Icon(Icons.Rounded.NoteAlt, contentDescription = null) },
        title = title,
        content = { compact ->
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                OutlinedTextField(
                    value = value,
                    enabled = !saving,
                    onValueChange = { updated ->
                        if (updated.length <= maxLength || updated.length < value.length) {
                            value = updated
                            onDraftChange(updated)
                        }
                    },
                    label = { Text("Optional note") },
                    supportingText = { Text("${value.length}/$maxLength") },
                    minLines = if (compact) 1 else 4,
                    maxLines = 8,
                    modifier = Modifier.fillMaxWidth(),
                )
                status?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                if (tracksDraft && status == null) Text(
                    if (savedDraftValue == value) "Draft saved on this device. Save adds it to your notebook."
                    else if (value == initialValue) "Save adds this note to your notebook."
                    else "Saving draft… Keep this editor open until the draft is saved on this device.",
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                TextButton(onClick = { copyPracticeText(context, "Dance Library note draft", value) }) { Text("Copy text") }
                onDiscardDraft?.let { discard -> TextButton(enabled = !saving, onClick = discard) { Text("Discard draft") } }
            }
        },
        confirmButton = { TextButton(enabled = !saving && value.length <= maxLength, onClick = { onSave(value) }) { Text(if (saving) "Saving…" else "Save") } },
        dismissButton = { TextButton(enabled = !saving, onClick = onDismiss) { Text("Close") } },
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
    return matchesNotebookQuery(query, "")
}

private fun Lesson.matchesNotebookQuery(query: String, note: String): Boolean {
    if (query.isBlank()) return true
    fun normalized(value: String) = java.text.Normalizer.normalize(value, java.text.Normalizer.Form.NFD)
        .replace(Regex("\\p{M}+"), "").lowercase(java.util.Locale.ROOT)
    val haystack = normalized(listOf(title, course, courseDisplayName.orEmpty(), breadcrumbs.joinToString(" "), legacyPath, note).joinToString(" "))
    return normalized(query).trim().split(Regex("\\s+")).all(haystack::contains)
}

internal fun Lesson.fullFolderLabel(): String {
    val display = courseDisplay(courseDisplayName.ifBlank { course }, categoryTitle)
    val courseLabel = listOf(display.heading, display.teacher).filter(String::isNotBlank).joinToString(" · ")
    return (listOf(courseLabel) + breadcrumbs).filter(String::isNotBlank).joinToString(" › ")
}

private fun copyNote(context: Context, lesson: Lesson, bookmark: PracticeBookmark) {
    val text = buildString {
        append(lesson.title).append(" [").append(formatPlaybackTime(bookmark.positionMs)).append(']')
        if (bookmark.note.isNotBlank()) append("\n").append(bookmark.note)
    }
    copyPracticeText(context, "Dance Library note", text)
}

internal fun copyPracticeText(context: Context, label: String, text: String) {
    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    clipboard.setPrimaryClip(ClipData.newPlainText(label, text))
}
