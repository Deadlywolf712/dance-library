package com.deadlywolf.dancelibrary.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ArrowDownward
import androidx.compose.material.icons.rounded.ArrowUpward
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
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
import com.deadlywolf.dancelibrary.data.MAX_IMPORTED_NOTE_LENGTH
import com.deadlywolf.dancelibrary.data.MAX_REFLECTION_LENGTH
import com.deadlywolf.dancelibrary.data.PracticeBookmark
import com.deadlywolf.dancelibrary.data.PracticeReflection
import com.deadlywolf.dancelibrary.data.PracticeSegment
import com.deadlywolf.dancelibrary.model.Lesson
import com.google.gson.Gson
import kotlin.math.roundToLong

private val practiceEditorGson = Gson()

@Composable
internal fun PracticeWorkspaceScreen(state: LibraryUiState, viewModel: LibraryViewModel, modifier: Modifier = Modifier) {
    val queue = state.practice.workspace.queue
    val byPath = remember(state.catalog) { state.allLessons.associateBy(Lesson::legacyPath) }
    Column(modifier.fillMaxSize()) {
        CollectionHeader("Practice queue", "${queue.size} ${if (queue.size == 1) "lesson" else "lessons"} in your chosen order")
        LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item {
                Text("Choose a lesson, practice its difficult parts, and mark it complete when you are ready.", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (queue.isEmpty()) item {
                Card {
                    Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text("Build your next practice session", style = MaterialTheme.typography.titleLarge)
                        Text("Open a lesson and choose Add to queue. Your queue stays on this device and is included in backups.")
                        Button(onClick = { viewModel.selectLesson(null); viewModel.setDestination(AppDestination.LIBRARY) }) { Text("Explore the library") }
                    }
                }
            }
            itemsIndexed(queue, key = { _, path -> path }) { index, path ->
                val lesson = byPath[path]
                QueueLessonCard(
                    title = lesson?.title ?: path.substringAfterLast('/'),
                    subtitle = lesson?.fullFolderLabel() ?: "This lesson is not in the current catalog. Its queue entry is preserved.",
                    index = index,
                    count = queue.size,
                    completed = path in state.practice.workspace.completed,
                    onPlay = lesson?.let { { viewModel.setDestination(AppDestination.LIBRARY); viewModel.selectLesson(it.id) } },
                    onMove = { viewModel.moveQueued(path, it) },
                    onRemove = { viewModel.removeQueued(path) },
                )
            }
        }
    }
}

@Composable
private fun QueueLessonCard(title: String, subtitle: String, index: Int, count: Int, completed: Boolean, onPlay: (() -> Unit)?, onMove: (Int) -> Unit, onRemove: () -> Unit) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("${index + 1} of $count${if (completed) " · Completed" else " · Ready to practice"}", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
            Text(title, style = MaterialTheme.typography.titleMedium)
            Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = { onPlay?.invoke() }, enabled = onPlay != null, modifier = Modifier.weight(1f)) {
                    Icon(Icons.Rounded.PlayArrow, contentDescription = null)
                    Text("Play lesson")
                }
                IconButton(onClick = { onMove(-1) }, enabled = index > 0) { Icon(Icons.Rounded.ArrowUpward, contentDescription = "Move $title up") }
                IconButton(onClick = { onMove(1) }, enabled = index < count - 1) { Icon(Icons.Rounded.ArrowDownward, contentDescription = "Move $title down") }
                IconButton(onClick = onRemove) { Icon(Icons.Rounded.Delete, contentDescription = "Remove $title from queue") }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun LessonPracticeActions(lesson: Lesson, state: LibraryUiState, viewModel: LibraryViewModel) {
    val queued = lesson.legacyPath in state.practice.workspace.queue
    val completed = lesson.legacyPath in state.practice.workspace.completed
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        FilterChip(selected = queued, onClick = { viewModel.toggleQueued(lesson) }, label = { Text(if (queued) "In practice queue" else "Add to queue") })
        FilterChip(selected = completed, onClick = { viewModel.toggleCompleted(lesson) }, label = { Text(if (completed) "Completed" else "Mark complete") })
        TextButton(onClick = { viewModel.setDestination(AppDestination.QUEUE) }) { Text("Open queue") }
    }
    Text(if (lesson.id in state.practice.watched) "Viewed · Completion is your choice." else "Completion is separate from viewing history.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

@Composable
internal fun LessonReflectionCard(lesson: Lesson, state: LibraryUiState, onEdit: () -> Unit) {
    val draft = state.practice.reflectionDrafts[lesson.legacyPath]
    val saved = state.practice.workspace.reflections[lesson.legacyPath]
    val preview = draft?.text ?: saved?.text.orEmpty()
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Lesson reflection", style = MaterialTheme.typography.titleMedium)
            Text(preview.ifBlank { "Capture your goal, a correction, or what to practice next." }, maxLines = 4, overflow = TextOverflow.Ellipsis)
            if (draft != null) Text("Draft saved on this device", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            else if (saved != null) Text("Saved in your notebook", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Button(onClick = onEdit) { Text("Edit reflection") }
        }
    }
}

@Composable
internal fun LessonReflectionDialog(lesson: Lesson, state: LibraryUiState, viewModel: LibraryViewModel, onDismiss: () -> Unit) {
    val path = lesson.legacyPath
    val context = LocalContext.current
    val saved = state.practice.workspace.reflections[path]
    val draft = state.practice.reflectionDrafts[path]
    // Keep the comparison baseline with the text across rotation/process state
    // restoration; a newer import must not become an old draft's new baseline.
    var expectedJson by rememberSaveable(path) { mutableStateOf(practiceEditorGson.toJson(if (draft != null) draft.expected else saved)) }
    val expected = remember(expectedJson) { practiceEditorGson.fromJson(expectedJson, PracticeReflection::class.java) }
    var text by rememberSaveable(path) { mutableStateOf(draft?.text ?: saved?.text.orEmpty()) }
    var saving by remember(path) { mutableStateOf(false) }
    var pendingSavedText by rememberSaveable(path) { mutableStateOf<String?>(null) }
    var resultMessage by remember(path) { mutableStateOf<String?>(null) }
    var confirmDiscard by remember(path) { mutableStateOf(false) }
    val dirty = text != expected?.text.orEmpty() || (draft != null && saved != expected)
    // Apply updates only while this editor is clean. A conflicting import or
    // another editor must never replace text that is still being written.
    LaunchedEffect(saved, pendingSavedText) {
        if (pendingSavedText != null && saved?.text.orEmpty() == pendingSavedText) {
            expectedJson = practiceEditorGson.toJson(saved)
            pendingSavedText = null
        } else if (!dirty && !saving) { expectedJson = practiceEditorGson.toJson(saved); text = saved?.text.orEmpty() }
    }
    EditorDialog(
        title = "Lesson reflection",
        onDismissRequest = { if (!saving && pendingSavedText == null) onDismiss() },
        content = { compact ->
        Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            OutlinedTextField(
                value = text,
                enabled = !saving && pendingSavedText == null,
                onValueChange = { updated ->
                    if (updated.length <= MAX_REFLECTION_LENGTH || updated.length < text.length) {
                        text = updated
                        resultMessage = null
                        viewModel.saveReflectionDraft(path, updated, expected)
                    }
                },
                label = { Text("Your reflection") },
                supportingText = { Text("${text.length}/$MAX_REFLECTION_LENGTH") },
                minLines = if (compact) 1 else 3,
                maxLines = 8,
                modifier = Modifier.fillMaxWidth(),
            )
            if (saved != expected && dirty) {
                Text("The saved reflection changed while this draft was open.", color = MaterialTheme.colorScheme.error)
                Text(saved?.text ?: "The saved reflection was removed.", maxLines = 5, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall)
            }
            Text(
                resultMessage ?: when {
                    dirty && draft?.text == text -> "Draft saved on this device. Save to add it to your notebook."
                    dirty -> "Saving draft… Keep this editor open until the draft is saved on this device."
                    saved != null -> "Saved in your notebook."
                    else -> "Reflections are saved only when you choose Save."
                },
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            TextButton(onClick = { copyPracticeText(context, "Dance Library reflection", text) }) { Text("Copy reflection") }
            if (draft != null || dirty) TextButton(enabled = !saving, onClick = { confirmDiscard = true }) { Text("Discard draft and use saved version") }
        }
        },
        confirmButton = {
            TextButton(enabled = dirty && !saving && pendingSavedText == null, onClick = {
                saving = true
                val submitted = text
                viewModel.saveReflection(lesson, submitted, expected) { success ->
                    saving = false
                    if (success) {
                        pendingSavedText = submitted
                        resultMessage = "Reflection saved."
                        onDismiss()
                    } else resultMessage = "Could not save. Your text is still in this editor. Copy it before closing if draft storage also failed."
                }
            }) { Text(if (saving) "Saving…" else "Save reflection") }
        },
        dismissButton = { TextButton(enabled = !saving && pendingSavedText == null, onClick = onDismiss) { Text("Close") } },
    )
    if (confirmDiscard) AlertDialog(
        onDismissRequest = { if (!saving) confirmDiscard = false },
        title = { Text("Discard this reflection draft?") },
        text = { Text("This removes the unsaved reflection on this device and loads the current saved version.") },
        confirmButton = { TextButton(enabled = !saving, onClick = {
            saving = true
            viewModel.clearReflectionDraft(path) { success ->
                saving = false
                if (success) { expectedJson = practiceEditorGson.toJson(saved); text = saved?.text.orEmpty(); confirmDiscard = false; resultMessage = "Saved version loaded." }
                else resultMessage = "The draft could not be removed. Your text is still here."
            }
        }) { Text("Discard draft") } },
        dismissButton = { TextButton(enabled = !saving, onClick = { confirmDiscard = false }) { Text("Keep draft") } },
    )
}

@Composable
internal fun PracticeNoteEditor(state: LibraryUiState, viewModel: LibraryViewModel, lesson: Lesson, bookmark: PracticeBookmark?, positionMs: Long, onDismiss: () -> Unit) {
    val draftKey = bookmark?.id ?: "new:${lesson.id}:$positionMs"
    val draft = state.practice.noteDrafts[draftKey]
    val expectedJson = rememberSaveable(draftKey) { practiceEditorGson.toJson(if (draft != null) draft.expected else bookmark) }
    val expected = remember(expectedJson) { practiceEditorGson.fromJson(expectedJson, PracticeBookmark::class.java) }
    val initial = remember(draftKey) { draft?.text ?: bookmark?.note.orEmpty() }
    var saving by remember(draftKey) { mutableStateOf(false) }
    var failure by remember(draftKey) { mutableStateOf<String?>(null) }
    var confirmDiscard by remember(draftKey) { mutableStateOf(false) }
    NoteEditorDialog(
        title = if (bookmark == null) "Note at ${formatPlaybackTime(positionMs)}" else "Edit note at ${formatPlaybackTime(positionMs)}",
        initialValue = initial,
        editorKey = draftKey,
        maxLength = MAX_IMPORTED_NOTE_LENGTH,
        saving = saving,
        status = failure,
        savedDraftValue = draft?.text,
        tracksDraft = true,
        onDraftChange = { value -> failure = null; viewModel.saveNoteDraft(lesson.id, draftKey, value, expected) },
        onDiscardDraft = { confirmDiscard = true },
        onDismiss = onDismiss,
        onSave = { value ->
            saving = true
            val complete: (Boolean) -> Unit = { success ->
                saving = false
                if (success) onDismiss() else failure = "Could not save. Your text is still here. Copy it before closing if draft storage also failed."
            }
            if (bookmark == null) viewModel.addBookmark(lesson.id, positionMs, value, complete)
            else viewModel.updateBookmarkNote(lesson.id, bookmark.id, value, expected ?: bookmark, complete)
        },
    )
    if (confirmDiscard) AlertDialog(
        onDismissRequest = { if (!saving) confirmDiscard = false },
        title = { Text("Discard this note draft?") },
        text = { Text("The saved bookmark stays in your notebook. Only this unsaved draft will be removed.") },
        confirmButton = { TextButton(enabled = !saving, onClick = {
            saving = true
            viewModel.clearNoteDraft(draftKey) { success ->
                saving = false
                if (success) { confirmDiscard = false; onDismiss() }
                else failure = "The draft could not be removed. Your text is still here."
            }
        }) { Text("Discard draft") } },
        dismissButton = { TextButton(enabled = !saving, onClick = { confirmDiscard = false }) { Text("Keep draft") } },
    )
}

@Composable
internal fun SavedSegmentCard(segment: PracticeSegment, canPlay: Boolean = true, onPlay: () -> Unit, onDelete: () -> Unit) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(segment.title, style = MaterialTheme.typography.titleMedium)
            Text("${formatPlaybackTime((segment.start * 1_000).roundToLong())} → ${formatPlaybackTime((segment.end * 1_000).roundToLong())} · ${segment.speed}×", color = MaterialTheme.colorScheme.onSurfaceVariant)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                TextButton(enabled = canPlay, onClick = onPlay) { Icon(Icons.Rounded.PlayArrow, contentDescription = null); Text("Practice segment") }
                IconButton(onClick = onDelete) { Icon(Icons.Rounded.Delete, contentDescription = "Delete ${segment.title}") }
            }
        }
    }
}

@Composable
internal fun SegmentEditorDialog(lesson: Lesson, initialStartMs: Long, initialEndMs: Long?, durationMs: Long, speed: Float, onDismiss: () -> Unit, onSave: (String, Long, Long, Float, (Boolean) -> Unit) -> Unit) {
    var title by rememberSaveable(lesson.id) { mutableStateOf("") }
    var start by rememberSaveable(lesson.id) { mutableStateOf(formatPracticeInput(initialStartMs)) }
    var end by rememberSaveable(lesson.id) { mutableStateOf(initialEndMs?.let(::formatPracticeInput).orEmpty()) }
    var saving by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<String?>(null) }
    val startMs = parsePracticeTime(start)
    val endMs = parsePracticeTime(end)
    val error = when {
        startMs == null || endMs == null -> "Enter seconds, M:SS, or H:MM:SS (for example 12.5 or 1:30)."
        endMs <= startMs -> "The end must be after the start."
        durationMs > 0 && endMs > durationMs -> "Keep the segment within this ${formatPlaybackTime(durationMs)} lesson."
        else -> null
    }
    EditorDialog(
        onDismissRequest = { if (!saving) onDismiss() },
        title = "Save a practice segment",
        content = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(title, { if (it.length <= 120) title = it }, enabled = !saving, label = { Text("Segment name") }, supportingText = { Text("${title.length}/120") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(start, { start = it }, enabled = !saving, label = { Text("Start time") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(end, { end = it }, enabled = !saving, label = { Text("End time") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Text(error ?: "Replays at ${speed}× with A–B looping.", color = if (error == null) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.error)
                failure?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            }
        },
        confirmButton = { TextButton(enabled = !saving && title.isNotBlank() && error == null, onClick = {
            saving = true
            onSave(title.trim(), startMs!!, endMs!!, speed) { success -> saving = false; if (!success) failure = "Could not save. Your segment details are still here." }
        }) { Text(if (saving) "Saving…" else "Save segment") } },
        dismissButton = { TextButton(enabled = !saving, onClick = onDismiss) { Text("Cancel") } },
    )
}

/** Strict timestamp parser. Keep fractional seconds through the milliseconds boundary. */
internal fun formatPracticeInput(positionMs: Long): String {
    val safe = positionMs.coerceAtLeast(0)
    val fraction = safe % 1_000
    return formatPlaybackTime(safe) + if (fraction == 0L) "" else ".${fraction.toString().padStart(3, '0').trimEnd('0')}"
}

internal fun parsePracticeTime(value: String): Long? {
    val parts = value.trim().split(':')
    if (parts.size !in 1..3 || parts.any { !it.matches(Regex("\\d+(?:\\.\\d{1,3})?")) }) return null
    if (parts.dropLast(1).any { '.' in it }) return null
    val numbers = parts.map { it.toDoubleOrNull() ?: return null }
    if (numbers.any { !it.isFinite() || it < 0 }) return null
    if ((numbers.size > 1 && numbers.last() >= 60) || (numbers.size == 3 && numbers[1] >= 60)) return null
    val seconds = numbers.fold(0.0) { total, part -> total * 60 + part }
    return (seconds * 1_000).takeIf { it.isFinite() && it <= Long.MAX_VALUE.toDouble() }?.roundToLong()
}
