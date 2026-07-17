package com.deadlywolf.dancelibrary.ui

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
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
    var currentLessonOnly by rememberSaveable { mutableStateOf(false) }
    var resetConfirmation by remember { mutableStateOf<PracticeReset?>(null) }
    var pendingImportJson by remember { mutableStateOf<String?>(null) }
    val exportOptions = PracticeExportOptions(
        includeBookmarks = includeBookmarks,
        includeSummaries = includeSummaries,
        includeFavorites = includeFavorites,
        includeWatchHistory = includeHistory,
        includeSettings = includeSettings,
        lessonIds = if (currentLessonOnly) state.selectedLesson?.let { setOf(it.id) } else null,
    )
    val hasWebsiteImportData = includeBookmarks || includeFavorites || includeHistory

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
        item { CollectionHeader("Settings", "Themes, streaming, backups, and maintenance") }
        item {
            SettingsCard(Icons.Rounded.Palette, "Appearance") {
                ThemeChooser(state, viewModel)
            }
        }
        item {
            SettingsCard(Icons.Rounded.Cloud, "Bunny streaming server") {
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
            SettingsCard(Icons.Rounded.Download, "Export & import") {
                Text(
                    "JSON backups are compatible with the website. Practice data merges safely; any included app settings update their matching settings.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                SettingsCheck("Bookmarks and notes", includeBookmarks) { includeBookmarks = it }
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
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(
                        enabled = hasWebsiteImportData,
                        onClick = { createJson.launch("dance-library-backup.json") },
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Icon(Icons.Rounded.Download, contentDescription = null)
                        Spacer(Modifier.width(7.dp))
                        Text("JSON")
                    }
                    OutlinedButton(
                        onClick = { createMarkdown.launch("dance-library-notes.md") },
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text("Markdown") }
                    OutlinedButton(
                        onClick = { importJson.launch(arrayOf("application/json", "text/json", "text/plain")) },
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Icon(Icons.Rounded.Upload, contentDescription = null)
                        Spacer(Modifier.width(7.dp))
                        Text("Import")
                    }
                }
                if (!hasWebsiteImportData) {
                    Text(
                        "Select bookmarks, favorites, or history to create a website-importable JSON backup. Summary-only Markdown is still available.",
                        color = MaterialTheme.colorScheme.error,
                    )
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    TextButton(onClick = { scope.launch {
                        withContext(Dispatchers.Default) { viewModel.exportMarkdown(exportOptions) }
                            ?.let { shareByEmail(context, it) }
                    } }) {
                        Icon(Icons.Rounded.Email, contentDescription = null)
                        Spacer(Modifier.width(6.dp))
                        Text("Email")
                    }
                    TextButton(onClick = { scope.launch {
                        withContext(Dispatchers.Default) { viewModel.exportMarkdown(exportOptions) }
                            ?.let { printNotes(context, it) }
                    } }) {
                        Icon(Icons.Rounded.Print, contentDescription = null)
                        Spacer(Modifier.width(6.dp))
                        Text("Print")
                    }
                }
            }
        }
        item {
            SettingsCard(Icons.Rounded.DeleteSweep, "Reset saved data") {
                ResetButton("Watch history", PracticeReset.WATCH_HISTORY) { resetConfirmation = it }
                ResetButton("Bookmarks and notes", PracticeReset.BOOKMARKS_AND_NOTES) { resetConfirmation = it }
                ResetButton("Favorites", PracticeReset.FAVORITES) { resetConfirmation = it }
                ResetButton("Resume positions", PracticeReset.RESUME_POSITIONS) { resetConfirmation = it }
                ResetButton("Everything", PracticeReset.EVERYTHING) { resetConfirmation = it }
            }
        }
        item {
            SettingsCard(Icons.Rounded.Help, "Quick guide") {
                Text("Practice player", fontWeight = FontWeight.Bold)
                Text("Use −5/+5 to repeat a move, choose 0.5×–2× speed, mirror the video, or set A and B for a repeating section.")
                Text("Bookmarks & notes", fontWeight = FontWeight.Bold)
                Text("While a lesson is open, add a bookmark at the exact timestamp. Notes can be searched, edited, copied, deleted, and reopened from the Notes tab.")
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
    content: @Composable ColumnScope.() -> Unit,
) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(11.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                Spacer(Modifier.width(9.dp))
                Text(title, style = MaterialTheme.typography.titleLarge)
            }
            content()
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
    PracticeReset.BOOKMARKS_AND_NOTES -> "bookmarks and notes"
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
