package com.deadlywolf.dancelibrary.ui

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.automirrored.rounded.ArrowForward
import androidx.compose.material.icons.rounded.Cloud
import androidx.compose.material.icons.rounded.DeleteSweep
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.Email
import androidx.compose.material.icons.rounded.ExpandLess
import androidx.compose.material.icons.rounded.ExpandMore
import androidx.compose.material.icons.rounded.Favorite
import androidx.compose.material.icons.rounded.FavoriteBorder
import androidx.compose.material.icons.rounded.Help
import androidx.compose.material.icons.rounded.Palette
import androidx.compose.material.icons.rounded.Print
import androidx.compose.material.icons.rounded.Restore
import androidx.compose.material.icons.rounded.Upload
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.deadlywolf.dancelibrary.BuildConfig
import com.deadlywolf.dancelibrary.MainActivity
import com.deadlywolf.dancelibrary.LibraryUiState
import com.deadlywolf.dancelibrary.LibraryViewModel
import com.deadlywolf.dancelibrary.data.MAX_BACKUP_BYTES
import com.deadlywolf.dancelibrary.data.PracticeExportOptions
import com.deadlywolf.dancelibrary.data.PracticeReset
import com.deadlywolf.dancelibrary.model.ThemeSpec
import com.deadlywolf.dancelibrary.ui.theme.toComposeColor
import java.io.ByteArrayOutputStream
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
internal fun SettingsScreen(
    state: LibraryUiState,
    viewModel: LibraryViewModel,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var pullZone by remember(state.practice.pullZoneOverride, state.catalog?.pullZoneHost) {
        mutableStateOf(state.practice.pullZoneOverride ?: state.catalog?.pullZoneHost.orEmpty())
    }
    var includeBookmarks by rememberSaveable { mutableStateOf(true) }
    var includeSummaries by rememberSaveable { mutableStateOf(false) }
    var includeFavorites by rememberSaveable { mutableStateOf(true) }
    var includeHistory by rememberSaveable { mutableStateOf(true) }
    var includeSettings by rememberSaveable { mutableStateOf(true) }
    var includeWorkspace by rememberSaveable { mutableStateOf(true) }
    var currentLessonOnly by rememberSaveable { mutableStateOf(false) }
    var customizeBackup by rememberSaveable { mutableStateOf(false) }
    var resetConfirmation by remember { mutableStateOf<PracticeReset?>(null) }
    var pendingImportJson by remember { mutableStateOf<String?>(null) }
    val exportOptions = PracticeExportOptions(
        includeBookmarks = includeBookmarks,
        includeSummaries = includeSummaries,
        includeFavorites = includeFavorites,
        includeWatchHistory = includeHistory,
        includeSettings = includeSettings,
        includeWorkspace = includeWorkspace,
        lessonIds = if (currentLessonOnly) state.selectedLesson?.let { setOf(it.id) } else null,
    )
    val hasWebsiteImportData = includeBookmarks || includeFavorites || includeHistory || includeWorkspace

    val createJson = rememberLauncherForActivityResult(
        ActivityResultContracts.CreateDocument("application/json"),
    ) { uri ->
        if (uri != null) scope.launch {
            runCatching {
                val content = withContext(Dispatchers.Default) {
                    viewModel.exportJson(exportOptions) ?: error("The backup could not be generated.")
                }
                withContext(Dispatchers.IO) { writeDocument(context, uri, content) }
            }.onSuccess {
                Toast.makeText(context, "Export saved.", Toast.LENGTH_SHORT).show()
            }.onFailure {
                Toast.makeText(context, it.message ?: "Export failed.", Toast.LENGTH_LONG).show()
            }
        }
    }
    val createMarkdown = rememberLauncherForActivityResult(
        ActivityResultContracts.CreateDocument("text/markdown"),
    ) { uri ->
        if (uri != null) scope.launch {
            runCatching {
                val content = withContext(Dispatchers.Default) {
                    viewModel.exportMarkdown(exportOptions) ?: error("The export could not be generated.")
                }
                withContext(Dispatchers.IO) { writeDocument(context, uri, content) }
            }.onSuccess {
                Toast.makeText(context, "Export saved.", Toast.LENGTH_SHORT).show()
            }.onFailure {
                Toast.makeText(context, it.message ?: "Export failed.", Toast.LENGTH_LONG).show()
            }
        }
    }
    val importJson = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) {
            scope.launch {
                runCatching { withContext(Dispatchers.IO) { readDocumentLimited(context, uri, MAX_BACKUP_BYTES) } }
                    .onSuccess { pendingImportJson = it }
                    .onFailure { Toast.makeText(context, it.message ?: "Could not read that backup.", Toast.LENGTH_LONG).show() }
            }
        }
    }

    LazyColumn(
        verticalArrangement = Arrangement.spacedBy(14.dp),
        contentPadding = PaddingValues(start = 14.dp, top = 14.dp, end = 14.dp, bottom = 32.dp),
        modifier = modifier.fillMaxSize(),
    ) {
        item { CollectionHeader("Settings", "Your saved practice and preferences") }
        state.practice.storageReadError?.let { message ->
            item { Text(message, color = MaterialTheme.colorScheme.error) }
        }
        item {
            SettingsCard(Icons.Rounded.Download, "Export & import") {
                Text(
                    "Back up your notes, queue, segments, and progress. Import the JSON file on the website or another device to continue your practice.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                TextButton(onClick = { customizeBackup = !customizeBackup }) {
                    Text(if (customizeBackup) "Hide export options" else "Choose what to export")
                    Icon(if (customizeBackup) Icons.Rounded.ExpandLess else Icons.Rounded.ExpandMore, contentDescription = null)
                }
                if (customizeBackup) {
                SettingsCheck("Bookmarks and notes", includeBookmarks) { includeBookmarks = it }
                SettingsCheck("Queue, segments, completion, and reflections", includeWorkspace) { includeWorkspace = it }
                SettingsCheck("Video summaries and analysis", includeSummaries) { includeSummaries = it }
                SettingsCheck("Favorites", includeFavorites) { includeFavorites = it }
                SettingsCheck("History and resume positions", includeHistory) { includeHistory = it }
                SettingsCheck("Theme and app settings", includeSettings) { includeSettings = it }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    FilterChip(selected = !currentLessonOnly, onClick = { currentLessonOnly = false }, label = { Text("Whole library") })
                    FilterChip(
                        selected = currentLessonOnly,
                        onClick = { currentLessonOnly = true },
                        enabled = state.selectedLesson != null,
                        label = { Text("Current lesson") },
                    )
                }
                }
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(
                        enabled = hasWebsiteImportData,
                        onClick = { createJson.launch("dance-library-backup.json") },
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Icon(Icons.Rounded.Download, contentDescription = null)
                        Spacer(Modifier.width(7.dp))
                        Text("Save JSON backup")
                    }
                    OutlinedButton(
                        onClick = { createMarkdown.launch("dance-library-notes.md") },
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text("Export notes as Markdown") }
                    OutlinedButton(
                        onClick = { importJson.launch(arrayOf("application/json", "text/json", "text/plain")) },
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Icon(Icons.Rounded.Upload, contentDescription = null)
                        Spacer(Modifier.width(7.dp))
                        Text("Import backup")
                    }
                }
                if (!hasWebsiteImportData) {
                    Text(
                        "Select some saved practice data for a JSON backup. Summary-only Markdown is still available.",
                        color = MaterialTheme.colorScheme.error,
                    )
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    TextButton(onClick = { scope.launch {
                        runCatching {
                            withContext(Dispatchers.Default) { viewModel.exportMarkdown(exportOptions) }
                                ?.let { shareByEmail(context, it) }
                        }.onFailure { Toast.makeText(context, it.message ?: "Could not prepare your notes.", Toast.LENGTH_LONG).show() }
                    } }) {
                        Icon(Icons.Rounded.Email, contentDescription = null)
                        Spacer(Modifier.width(6.dp))
                        Text("Email")
                    }
                    TextButton(onClick = { scope.launch {
                        runCatching {
                            withContext(Dispatchers.Default) { viewModel.exportMarkdown(exportOptions) }
                                ?.let { printNotes(context, it) }
                        }.onFailure { Toast.makeText(context, it.message ?: "Could not prepare your notes.", Toast.LENGTH_LONG).show() }
                    } }) {
                        Icon(Icons.Rounded.Print, contentDescription = null)
                        Spacer(Modifier.width(6.dp))
                        Text("Print")
                    }
                }
            }
        }
        item {
            SettingsCard(Icons.Rounded.Palette, "Appearance") {
                ThemeChooser(state, viewModel)
            }
        }
        item {
            SettingsCard(Icons.Rounded.Cloud, "Streaming server", collapsible = true) {
                Text(
                    "Videos stream directly from Bunny. Leave the default unless your pull-zone hostname changes.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                OutlinedTextField(
                    value = pullZone,
                    onValueChange = { pullZone = it },
                    label = { Text("Pull-zone hostname") },
                    supportingText = { Text("Example: vz-xxxx.b-cdn.net") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = { viewModel.setPullZoneOverride(pullZone) }) { Text("Save server") }
                    TextButton(onClick = {
                        pullZone = state.catalog?.pullZoneHost.orEmpty()
                        viewModel.setPullZoneOverride(null)
                    }) { Text("Use catalog default") }
                }
            }
        }
        item {
            SettingsCard(Icons.Rounded.DeleteSweep, "Reset saved data", collapsible = true) {
                ResetButton("Watch history", PracticeReset.WATCH_HISTORY) { resetConfirmation = it }
                ResetButton("Timestamp notes", PracticeReset.BOOKMARKS_AND_NOTES) { resetConfirmation = it }
                ResetButton("Favorites", PracticeReset.FAVORITES) { resetConfirmation = it }
                ResetButton("Resume positions", PracticeReset.RESUME_POSITIONS) { resetConfirmation = it }
                ResetButton("All practice data", PracticeReset.ALL_PRACTICE_DATA) { resetConfirmation = it }
                ResetButton("Everything", PracticeReset.EVERYTHING) { resetConfirmation = it }
            }
        }
        item {
            SettingsCard(Icons.Rounded.Help, "Quick guide", collapsible = true) {
                Text("Practice player", fontWeight = FontWeight.Bold)
                Text("Use −5/+5 to repeat a move, choose a playback speed, mirror the video, or set A and B for a repeating section. Save a named segment to replay that range and speed later.")
                Text("Bookmarks & notes", fontWeight = FontWeight.Bold)
                Text("Save timestamped notes and lesson reflections in your Notebook. Editors retain drafts on this device. Save a draft to include it in a backup; the most recent deleted bookmark can be restored with Undo.")
                Text("Practice queue", fontWeight = FontWeight.Bold)
                Text("Add lessons to your Queue, reorder your session, and mark completion when you are ready. Opening a lesson records a view; completion is your choice.")
                Text("Library organization", fontWeight = FontWeight.Bold)
                Text("Browse style → course → folder exactly like the website. Search is global; Previous and Next stay inside the current lesson folder.")
                Text("Physical keyboard", fontWeight = FontWeight.Bold)
                Text("Space play/pause · ←/→ seek 5s · M mirror · B bookmark · [ / ] set A/B · T theater · Esc exit theater or clear A–B · Ctrl/Cmd+K search · ? shortcuts.")
                Text("Version ${BuildConfig.VERSION_NAME}", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }

    resetConfirmation?.let { reset ->
        AlertDialog(
            onDismissRequest = { resetConfirmation = null },
            icon = { Icon(Icons.Rounded.Restore, contentDescription = null) },
            title = { Text("Clear ${reset.label()}?") },
            text = { Text("This changes only saved app data on this device. Export a JSON backup first if you may want it later.") },
            confirmButton = {
                TextButton(onClick = {
                    viewModel.reset(reset)
                    resetConfirmation = null
                }) { Text("Clear") }
            },
            dismissButton = { TextButton(onClick = { resetConfirmation = null }) { Text("Cancel") } },
        )
    }
    pendingImportJson?.let { json ->
        AlertDialog(
            onDismissRequest = { pendingImportJson = null },
            icon = { Icon(Icons.Rounded.Upload, contentDescription = null) },
            title = { Text("Merge this backup?") },
            text = { Text("Practice collections merge with what is already saved. If the backup includes theme, layout, or Bunny settings, those matching settings will be updated.") },
            confirmButton = {
                TextButton(onClick = {
                    pendingImportJson = null
                    viewModel.importJson(json)
                }) { Text("Merge backup") }
            },
            dismissButton = { TextButton(onClick = { pendingImportJson = null }) { Text("Cancel") } },
        )
    }
}

@Composable
private fun ThemeChooser(state: LibraryUiState, viewModel: LibraryViewModel) {
    val themes = state.catalog?.themes.orEmpty()
    val currentIndex = themes.indexOfFirst { it.id == state.practice.themeId }.coerceAtLeast(0)
    val current = themes.getOrNull(currentIndex)
    if (themes.isEmpty()) {
        Text("Arctic", style = MaterialTheme.typography.titleMedium)
        return
    }
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
        IconButton(onClick = { viewModel.setTheme(themes[(currentIndex - 1).floorMod(themes.size)].id) }) {
            Icon(Icons.AutoMirrored.Rounded.ArrowBack, contentDescription = "Previous theme")
        }
        Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(current?.name.orEmpty(), style = MaterialTheme.typography.titleMedium)
            Text("${currentIndex + 1} of ${themes.size}", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        IconButton(onClick = { current?.id?.let(viewModel::toggleFavoriteTheme) }) {
            Icon(
                if (current?.id in state.practice.favoriteThemes) Icons.Rounded.Favorite else Icons.Rounded.FavoriteBorder,
                contentDescription = if (current?.id in state.practice.favoriteThemes) {
                    "Remove ${current?.name.orEmpty()} from favorite themes"
                } else {
                    "Add ${current?.name.orEmpty()} to favorite themes"
                },
                tint = if (current?.id in state.practice.favoriteThemes) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        IconButton(onClick = { viewModel.setTheme(themes[(currentIndex + 1) % themes.size].id) }) {
            Icon(Icons.AutoMirrored.Rounded.ArrowForward, contentDescription = "Next theme")
        }
    }
    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        val favoriteIds = state.practice.favoriteThemes
        val ordered = themes.sortedWith(compareByDescending<ThemeSpec> { it.id in favoriteIds }.thenBy { it.sortOrdinal })
        items(ordered, key = ThemeSpec::id) { theme ->
            FilterChip(
                selected = theme.id == state.practice.themeId,
                onClick = { viewModel.setTheme(theme.id) },
                leadingIcon = {
                    val accent = theme.cssVariables["--accent"].toComposeColor() ?: MaterialTheme.colorScheme.primary
                    Spacer(Modifier.size(16.dp).clip(CircleShape).background(accent))
                },
                label = { Text(theme.name) },
            )
        }
    }
}

@Composable
private fun SettingsCard(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    title: String,
    collapsible: Boolean = false,
    content: @Composable ColumnScope.() -> Unit,
) {
    var expanded by rememberSaveable(title) { mutableStateOf(!collapsible) }
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(11.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().then(
                if (collapsible) Modifier.semantics { stateDescription = if (expanded) "Expanded" else "Collapsed" }
                    .clickable(role = Role.Button, onClick = { expanded = !expanded }).padding(vertical = 10.dp)
                else Modifier,
            )) {
                Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                Spacer(Modifier.width(9.dp))
                Text(title, style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
                if (collapsible) Icon(if (expanded) Icons.Rounded.ExpandLess else Icons.Rounded.ExpandMore, contentDescription = null)
            }
            if (expanded) content()
        }
    }
}

@Composable
private fun SettingsCheck(label: String, checked: Boolean, onChecked: (Boolean) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
        Checkbox(checked = checked, onCheckedChange = onChecked)
        Text(label)
    }
}

@Composable
private fun ResetButton(label: String, reset: PracticeReset, onClick: (PracticeReset) -> Unit) {
    OutlinedButton(onClick = { onClick(reset) }, modifier = Modifier.fillMaxWidth()) { Text("Clear $label") }
}

private fun PracticeReset.label(): String = when (this) {
    PracticeReset.WATCH_HISTORY -> "watch history"
    PracticeReset.BOOKMARKS_AND_NOTES -> "timestamp notes and their drafts"
    PracticeReset.FAVORITES -> "favorites"
    PracticeReset.RESUME_POSITIONS -> "resume positions"
    PracticeReset.ALL_PRACTICE_DATA -> "practice data"
    PracticeReset.SETTINGS -> "settings"
    PracticeReset.EVERYTHING -> "everything"
}

private fun Int.floorMod(size: Int): Int = ((this % size) + size) % size

private fun writeDocument(context: Context, uri: Uri?, content: String) {
    if (uri == null) return
    context.contentResolver.openOutputStream(uri, "wt")?.bufferedWriter()?.use { it.write(content) }
        ?: error("The selected file could not be opened.")
}

private fun readDocumentLimited(context: Context, uri: Uri, maximumBytes: Int): String {
    context.contentResolver.openInputStream(uri)?.use { input ->
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(16 * 1024)
        while (true) {
            val read = input.read(buffer)
            if (read < 0) break
            if (output.size() + read > maximumBytes) error("Backup exceeds the 10 MiB safety limit.")
            output.write(buffer, 0, read)
        }
        return output.toString(Charsets.UTF_8.name())
    }
    error("The selected backup could not be opened.")
}

private fun shareByEmail(context: Context, markdown: String) {
    val email = Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:")).apply {
        putExtra(Intent.EXTRA_SUBJECT, "Dance Library notes")
        putExtra(Intent.EXTRA_TEXT, markdown)
    }
    runCatching { context.startActivity(email) }.onFailure {
        val share = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_SUBJECT, "Dance Library notes")
            putExtra(Intent.EXTRA_TEXT, markdown)
        }
        context.startActivity(Intent.createChooser(share, "Share Dance Library notes"))
    }
}

private fun printNotes(context: Context, markdown: String) {
    (context.findActivity() as? MainActivity)?.printDanceLibraryNotes(markdown)
        ?: Toast.makeText(context, "Printing is unavailable in this window.", Toast.LENGTH_LONG).show()
}
