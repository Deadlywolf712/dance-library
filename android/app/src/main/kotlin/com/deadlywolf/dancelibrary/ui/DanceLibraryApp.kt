package com.deadlywolf.dancelibrary.ui

import android.view.KeyEvent as AndroidKeyEvent
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
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
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Favorite
import androidx.compose.material.icons.rounded.History
import androidx.compose.material.icons.rounded.Home
import androidx.compose.material.icons.rounded.MenuBook
import androidx.compose.material.icons.rounded.NoteAlt
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material3.Button
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationRail
import androidx.compose.material3.NavigationRailItem
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.movableContentOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.core.view.WindowInsetsControllerCompat
import com.deadlywolf.dancelibrary.AppDestination
import com.deadlywolf.dancelibrary.LibraryUiState
import com.deadlywolf.dancelibrary.LibraryViewModel
import com.deadlywolf.dancelibrary.filterLessons
import com.deadlywolf.dancelibrary.model.BrowseLocation
import com.deadlywolf.dancelibrary.ui.theme.DanceLibraryTheme

@Composable
fun DanceLibraryApp(viewModel: LibraryViewModel) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    DanceLibraryTheme(state.currentTheme) {
        SystemBarAppearance()
        Surface(color = androidx.compose.material3.MaterialTheme.colorScheme.background, modifier = Modifier.fillMaxSize()) {
            when {
                state.loading -> LoadingState()
                state.errorMessage != null -> CatalogErrorState(state.errorMessage.orEmpty(), viewModel::retryCatalog)
                else -> AdaptiveLibraryShell(state, viewModel)
            }
        }
    }
}

@Composable
private fun SystemBarAppearance() {
    val activity = LocalContext.current.findActivity() ?: return
    val useDarkIcons = androidx.compose.material3.MaterialTheme.colorScheme.background.luminance() > 0.5f
    DisposableEffect(activity, useDarkIcons) {
        val controller = WindowInsetsControllerCompat(activity.window, activity.window.decorView)
        controller.isAppearanceLightStatusBars = useDarkIcons
        controller.isAppearanceLightNavigationBars = useDarkIcons
        onDispose { }
    }
}

@Composable
private fun AdaptiveLibraryShell(state: LibraryUiState, viewModel: LibraryViewModel) {
    val snackbarHost = remember { SnackbarHostState() }
    val shellFocusRequester = remember { FocusRequester() }
    var showSpotlight by rememberSaveable { mutableStateOf(false) }
    var showKeyboardShortcuts by rememberSaveable { mutableStateOf(false) }
    var detailFocusNonce by rememberSaveable { mutableStateOf(0) }
    val latestState = rememberUpdatedState(state)
    val latestDetailFocusNonce = rememberUpdatedState(detailFocusNonce)
    val detailContent = remember(viewModel) {
        movableContentOf { compact: Boolean, contentModifier: Modifier ->
            LessonDetailScreen(
                state = latestState.value,
                viewModel = viewModel,
                compact = compact,
                keyboardFocusNonce = latestDetailFocusNonce.value,
                modifier = contentModifier,
            )
        }
    }
    LaunchedEffect(state.feedback) {
        val message = state.feedback ?: return@LaunchedEffect
        snackbarHost.showSnackbar(message)
        viewModel.dismissFeedback()
    }
    LaunchedEffect(showSpotlight, showKeyboardShortcuts, state.selectedLesson?.id) {
        if (!showSpotlight && !showKeyboardShortcuts && state.selectedLesson == null) {
            shellFocusRequester.requestFocus()
        }
    }

    BoxWithConstraints(
        modifier = Modifier
            .fillMaxSize()
            .windowInsetsPadding(WindowInsets.safeDrawing)
            .onPreviewKeyEvent { keyEvent ->
                val event = keyEvent.nativeKeyEvent
                val opensSearch = event.action == AndroidKeyEvent.ACTION_DOWN &&
                    event.repeatCount == 0 &&
                    (event.isCtrlPressed || event.isMetaPressed) &&
                    event.keyCode == AndroidKeyEvent.KEYCODE_K
                if (opensSearch) {
                    viewModel.pausePlayback()
                    showKeyboardShortcuts = false
                    showSpotlight = !showSpotlight
                }
                opensSearch
            }
            .onKeyEvent { keyEvent ->
                val event = keyEvent.nativeKeyEvent
                val opensGuide = event.action == AndroidKeyEvent.ACTION_DOWN &&
                    event.repeatCount == 0 &&
                    event.isShiftPressed &&
                    event.keyCode == AndroidKeyEvent.KEYCODE_SLASH
                if (opensGuide) {
                    viewModel.pausePlayback()
                    showSpotlight = false
                    showKeyboardShortcuts = !showKeyboardShortcuts
                }
                opensGuide
            }
            .focusRequester(shellFocusRequester)
            .focusable(),
    ) {
        val wide = maxWidth >= 840.dp
        val compactDetail = !wide && state.destination == AppDestination.LIBRARY && state.selectedLesson != null
        val handlesBack = state.selectedLesson != null ||
            state.query.isNotBlank() ||
            state.browseLocation != BrowseLocation.Root ||
            state.destination != AppDestination.LIBRARY
        BackHandler(enabled = handlesBack) {
            when {
                state.destination != AppDestination.LIBRARY -> viewModel.setDestination(AppDestination.LIBRARY)
                state.selectedLesson != null -> viewModel.selectLesson(null)
                state.query.isNotBlank() -> viewModel.setQuery("")
                state.browseLocation != BrowseLocation.Root -> viewModel.navigateBack()
            }
        }

        Scaffold(
            snackbarHost = { SnackbarHost(snackbarHost) },
            bottomBar = {
                if (!wide && !compactDetail) {
                    DestinationBottomBar(state, viewModel)
                }
            },
        ) { padding ->
            if (wide) {
                Row(Modifier.fillMaxSize().padding(padding)) {
                    DestinationRail(state, viewModel)
                    Box(Modifier.width(1.dp).fillMaxHeight().background(androidx.compose.material3.MaterialTheme.colorScheme.outlineVariant))
                    if (state.destination == AppDestination.LIBRARY && state.selectedLesson != null) {
                        LibraryScreen(
                            state = state,
                            viewModel = viewModel,
                            modifier = Modifier.widthIn(min = 350.dp, max = 440.dp).fillMaxHeight(),
                        )
                        Box(Modifier.width(1.dp).fillMaxHeight().background(androidx.compose.material3.MaterialTheme.colorScheme.outlineVariant))
                        detailContent(false, Modifier.weight(1f))
                    } else {
                        DestinationContent(state, viewModel, Modifier.weight(1f))
                    }
                }
            } else if (compactDetail) {
                detailContent(true, Modifier.fillMaxSize().padding(padding))
            } else {
                DestinationContent(state, viewModel, Modifier.fillMaxSize().padding(padding))
            }
        }
    }

    if (showSpotlight) {
        SpotlightSearchDialog(
            state = state,
            onDismiss = {
                showSpotlight = false
                detailFocusNonce += 1
            },
            onSelect = { lessonId ->
                showSpotlight = false
                detailFocusNonce += 1
                viewModel.setDestination(AppDestination.LIBRARY)
                viewModel.selectLesson(lessonId)
            },
        )
    }
    if (showKeyboardShortcuts) {
        KeyboardShortcutsDialog(
            onDismiss = {
                showKeyboardShortcuts = false
                detailFocusNonce += 1
            },
        )
    }
}

@Composable
private fun SpotlightSearchDialog(
    state: LibraryUiState,
    onDismiss: () -> Unit,
    onSelect: (String) -> Unit,
) {
    var query by rememberSaveable { mutableStateOf("") }
    val focusRequester = remember { FocusRequester() }
    val results = remember(query, state.allLessons) { filterLessons(state.allLessons, query) }
    LaunchedEffect(Unit) { focusRequester.requestFocus() }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Search all lessons") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = query,
                    onValueChange = { query = it },
                    singleLine = true,
                    placeholder = { Text("Title, course, or dance style") },
                    modifier = Modifier.fillMaxWidth().focusRequester(focusRequester),
                )
                Text("${results.size} ${if (results.size == 1) "lesson" else "lessons"}")
                LazyColumn(Modifier.fillMaxWidth().heightIn(max = 380.dp)) {
                    items(results, key = { it.id }) { lesson ->
                        TextButton(onClick = { onSelect(lesson.id) }, modifier = Modifier.fillMaxWidth()) {
                            Column(Modifier.fillMaxWidth()) {
                                Text(lesson.title, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Text(
                                    lesson.fullFolderLabel(),
                                    style = androidx.compose.material3.MaterialTheme.typography.bodySmall,
                                    color = androidx.compose.material3.MaterialTheme.colorScheme.onSurfaceVariant,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                        }
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Close") } },
    )
}

@Composable
private fun KeyboardShortcutsDialog(onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Keyboard shortcuts") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
                ShortcutLine("Space", "Play / pause")
                ShortcutLine("← / →", "Skip back / forward 5 seconds")
                ShortcutLine("M", "Mirror video")
                ShortcutLine("B", "Add timestamp bookmark")
                ShortcutLine("[ / ]", "Set loop start / end")
                ShortcutLine("Esc", "Exit theater or clear A–B")
                ShortcutLine("T", "Toggle theater mode")
                ShortcutLine("Ctrl/Cmd+K", "Search all lessons")
                ShortcutLine("?", "Show this guide")
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Close") } },
    )
}

@Composable
private fun ShortcutLine(keys: String, action: String) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(keys, style = androidx.compose.material3.MaterialTheme.typography.labelLarge, modifier = Modifier.width(96.dp))
        Text(action, modifier = Modifier.weight(1f))
    }
}

@Composable
private fun DestinationContent(state: LibraryUiState, viewModel: LibraryViewModel, modifier: Modifier) {
    when (state.destination) {
        AppDestination.LIBRARY -> LibraryScreen(state, viewModel, modifier)
        AppDestination.NOTES -> NotesScreen(state, viewModel, modifier)
        AppDestination.FAVORITES -> FavoritesScreen(state, viewModel, modifier)
        AppDestination.HISTORY -> HistoryScreen(state, viewModel, modifier)
        AppDestination.SETTINGS -> SettingsScreen(state, viewModel, modifier)
    }
}

@Composable
private fun DestinationBottomBar(state: LibraryUiState, viewModel: LibraryViewModel) {
    NavigationBar {
        AppDestination.entries.forEach { destination ->
            NavigationBarItem(
                selected = state.destination == destination,
                onClick = { selectDestination(destination, state, viewModel) },
                icon = {
                    Box {
                        Icon(destination.icon(), contentDescription = destination.label)
                        if (destination == AppDestination.NOTES && state.practice.unseenBookmarkCount > 0) {
                            Surface(
                                color = androidx.compose.material3.MaterialTheme.colorScheme.error,
                                contentColor = androidx.compose.material3.MaterialTheme.colorScheme.onError,
                                shape = androidx.compose.foundation.shape.CircleShape,
                                modifier = Modifier.align(Alignment.TopEnd),
                            ) {
                                Text(
                                    state.practice.unseenBookmarkCount.coerceAtMost(99).toString(),
                                    style = androidx.compose.material3.MaterialTheme.typography.labelSmall,
                                    modifier = Modifier.padding(horizontal = 4.dp),
                                )
                            }
                        }
                    }
                },
                label = { Text(destination.label, maxLines = 1, overflow = TextOverflow.Ellipsis) },
            )
        }
    }
}

@Composable
private fun DestinationRail(state: LibraryUiState, viewModel: LibraryViewModel) {
    NavigationRail(modifier = Modifier.fillMaxHeight()) {
        Spacer(Modifier.height(10.dp))
        Surface(
            color = androidx.compose.material3.MaterialTheme.colorScheme.primary,
            contentColor = androidx.compose.material3.MaterialTheme.colorScheme.onPrimary,
            shape = androidx.compose.foundation.shape.RoundedCornerShape(14.dp),
            modifier = Modifier.size(44.dp),
        ) {
            Box(contentAlignment = Alignment.Center) { Text("D", style = androidx.compose.material3.MaterialTheme.typography.titleLarge) }
        }
        Spacer(Modifier.height(16.dp))
        AppDestination.entries.forEach { destination ->
            NavigationRailItem(
                selected = state.destination == destination,
                onClick = { selectDestination(destination, state, viewModel) },
                icon = { Icon(destination.icon(), contentDescription = destination.label) },
                label = { Text(destination.label) },
            )
        }
    }
}

private fun selectDestination(destination: AppDestination, state: LibraryUiState, viewModel: LibraryViewModel) {
    if (destination == AppDestination.LIBRARY && state.destination != AppDestination.LIBRARY) {
        viewModel.selectLesson(null)
    }
    viewModel.setDestination(destination)
}

private fun AppDestination.icon(): ImageVector = when (this) {
    AppDestination.LIBRARY -> Icons.Rounded.Home
    AppDestination.NOTES -> Icons.Rounded.NoteAlt
    AppDestination.FAVORITES -> Icons.Rounded.Favorite
    AppDestination.HISTORY -> Icons.Rounded.History
    AppDestination.SETTINGS -> Icons.Rounded.Settings
}

@Composable
private fun LoadingState() {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically),
        modifier = Modifier.fillMaxSize(),
    ) {
        CircularProgressIndicator()
        Text("Opening your dance library…", style = androidx.compose.material3.MaterialTheme.typography.titleMedium)
    }
}

@Composable
private fun CatalogErrorState(message: String, onRetry: () -> Unit) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(14.dp, Alignment.CenterVertically),
        modifier = Modifier.fillMaxSize().padding(28.dp),
    ) {
        Icon(
            Icons.Rounded.MenuBook,
            contentDescription = null,
            tint = androidx.compose.material3.MaterialTheme.colorScheme.error,
            modifier = Modifier.size(42.dp),
        )
        Text("The library could not open", style = androidx.compose.material3.MaterialTheme.typography.headlineSmall)
        Text(message, color = androidx.compose.material3.MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
        Button(onClick = onRetry) {
            Icon(Icons.Rounded.Refresh, contentDescription = null)
            Spacer(Modifier.width(8.dp))
            Text("Try again")
        }
    }
}
