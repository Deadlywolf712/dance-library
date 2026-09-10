package com.deadlywolf.dancelibrary.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.ChevronRight
import androidx.compose.material.icons.rounded.ExpandLess
import androidx.compose.material.icons.rounded.ExpandMore
import androidx.compose.material.icons.rounded.Favorite
import androidx.compose.material.icons.rounded.Folder
import androidx.compose.material.icons.rounded.History
import androidx.compose.material.icons.rounded.Home
import androidx.compose.material.icons.rounded.LibraryMusic
import androidx.compose.material.icons.rounded.NoteAlt
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.SearchOff
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import com.deadlywolf.dancelibrary.AppDestination
import com.deadlywolf.dancelibrary.LibraryUiState
import com.deadlywolf.dancelibrary.LibraryViewModel
import com.deadlywolf.dancelibrary.model.BrowseLocation
import com.deadlywolf.dancelibrary.model.BrowseNode
import com.deadlywolf.dancelibrary.model.CatalogFolder
import com.deadlywolf.dancelibrary.model.FolderPresentation
import com.deadlywolf.dancelibrary.model.Lesson

@Composable
internal fun LibraryScreen(
    state: LibraryUiState,
    viewModel: LibraryViewModel,
    modifier: Modifier = Modifier,
) {
    val root = state.browseLocation == BrowseLocation.Root && state.query.isBlank()
    val title = browseTitle(state)
    val displayNodes = remember(state.browseNodes, state.browseLocation, state.query) {
        if (state.browseLocation is BrowseLocation.Category && state.query.isBlank()) {
            state.browseNodes.map { it to courseDisplay(it.title, title) }
                .sortedWith { left, right -> courseDisplayOrder.compare(left.second, right.second) }
                .map { it.first }
        } else state.browseNodes
    }
    Column(modifier.fillMaxSize()) {
        LibraryHeader(state, title, root, viewModel)
        SearchField(
            value = state.query,
            onValueChange = viewModel::setQuery,
            placeholder = "Search all ${state.allLessons.size} ${if (state.allLessons.size == 1) "lesson" else "lessons"}",
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp),
        )
        if (!root && state.query.isBlank()) BrowseBreadcrumbs(state, viewModel)
        LazyColumn(
            verticalArrangement = Arrangement.spacedBy(10.dp),
            contentPadding = PaddingValues(start = 14.dp, top = 10.dp, end = 14.dp, bottom = 28.dp),
            modifier = Modifier.weight(1f),
        ) {
            if (root) {
                item { PracticeStats(state) }
                homeSections(state, viewModel)
                item { Text("Dance styles", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 4.dp)) }
            } else if (state.query.isBlank()) {
                val tree = state.tree
                val folder = (state.browseLocation as? BrowseLocation.Folder)?.folderId
                    ?.let { folderId -> tree?.folderById?.get(folderId) }
                val course = folder?.courseId?.let { courseId -> tree?.courseById?.get(courseId) }
                course?.presentation?.takeIf { course.rootFolderId == folder?.id }?.let { presentation ->
                    item {
                        PresentationCard(
                            title = presentation.title,
                            subtitle = presentation.subtitle,
                            description = presentation.intro,
                        )
                    }
                }
                folder?.presentation?.let { presentation ->
                    item { FolderPresentationCard(presentation) }
                }
            }

            if (displayNodes.isEmpty()) {
                item { EmptyBrowse(state.query.isNotBlank()) }
            } else {
                items(displayNodes, key = { node -> "${node::class.simpleName}-${node.id}" }) { node ->
                    when (node) {
                        is BrowseNode.Category -> CategoryCard(node, state, viewModel)
                        is BrowseNode.Folder -> FolderCard(node.folder, state, viewModel)
                        is BrowseNode.Lesson -> {
                            val lesson = node.lesson
                            LessonRow(
                                lesson = lesson,
                                favorite = lesson.id in state.practice.favorites,
                                watched = lesson.id in state.practice.watched,
                                completed = lesson.legacyPath in state.practice.workspace.completed,
                                resumePositionMs = state.practice.positionsMs[lesson.id],
                                bookmarkCount = state.practice.bookmarks[lesson.id].orEmpty().size,
                                subtitle = if (state.query.isNotBlank()) lesson.fullFolderLabel() else "",
                                selected = lesson.id == state.selectedLesson?.id,
                                onClick = { viewModel.selectLesson(lesson.id) },
                                onToggleFavorite = { viewModel.toggleFavorite(lesson.id) },
                            )
                        }
                    }
                }
            }
        }
    }
}

private fun androidx.compose.foundation.lazy.LazyListScope.homeSections(
    state: LibraryUiState,
    viewModel: LibraryViewModel,
) {
    val continuing = state.lastLesson
    val nextPath = state.practice.workspace.queue.firstOrNull { it !in state.practice.workspace.completed }
        ?: state.practice.workspace.queue.firstOrNull()
    val nextQueued = state.allLessons.firstOrNull { it.legacyPath == nextPath }
    if (continuing != null) {
        item(key = "continue-heading") { Text("Continue your practice", style = MaterialTheme.typography.titleLarge) }
        item(key = "continue-lesson") { CompactHomeLesson(continuing, state, viewModel) }
    }
    if (nextQueued != null) {
        item(key = "queue-preview") {
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer)) {
                Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("Next in your queue", style = MaterialTheme.typography.labelLarge)
                    Text(nextQueued.title, style = MaterialTheme.typography.titleMedium)
                    Row {
                        TextButton(onClick = { viewModel.selectLesson(nextQueued.id) }) { Text("Practice now") }
                        TextButton(onClick = { viewModel.setDestination(AppDestination.QUEUE) }) { Text("View queue (${state.practice.workspace.queue.size})") }
                    }
                }
            }
        }
    } else item(key = "queue-intro") {
        TextButton(onClick = { viewModel.setDestination(AppDestination.QUEUE) }) { Text("Plan your next practice session") }
    }
    item(key = "home-collections") {
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            TextButton(onClick = { viewModel.setDestination(AppDestination.HISTORY) }) { Text("Viewing history") }
            TextButton(onClick = { viewModel.setDestination(AppDestination.NOTES) }) { Text("Open notebook") }
        }
    }
    val recentNotes = state.allLessons.mapNotNull { lesson ->
        val bookmark = state.practice.bookmarks[lesson.id].orEmpty().filter { it.note.isNotBlank() }.maxByOrNull { it.updatedAtMs }
        val reflection = state.practice.workspace.reflections[lesson.legacyPath]?.takeIf { it.text.isNotBlank() }
        val text = if ((reflection?.updatedAt ?: 0) > (bookmark?.updatedAtMs ?: 0)) reflection?.text else bookmark?.note
        text?.let { Triple(lesson, it, maxOf(reflection?.updatedAt ?: 0L, bookmark?.updatedAtMs ?: 0L)) }
    }.sortedByDescending { it.third }.take(3)
    if (recentNotes.isNotEmpty()) {
        val collapsed = state.practice.collapsedSections[HOME_NOTES] != false
        item { HomeSectionHeader("Recent notes", recentNotes.size, collapsed) { viewModel.setSectionCollapsed(HOME_NOTES, !collapsed) } }
        if (!collapsed) items(recentNotes, key = { "recent-note-${it.first.id}" }) { (lesson, text) ->
            Card(onClick = { viewModel.setDestination(AppDestination.NOTES) }, colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(lesson.title, style = MaterialTheme.typography.titleMedium)
                    Text(text, maxLines = 2, overflow = TextOverflow.Ellipsis, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}

@Composable
private fun LibraryHeader(
    state: LibraryUiState,
    title: String,
    root: Boolean,
    viewModel: LibraryViewModel,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 10.dp, top = 10.dp, end = 14.dp, bottom = 2.dp),
    ) {
        if (!root && state.query.isBlank()) {
            IconButton(onClick = viewModel::navigateBack) {
                Icon(Icons.AutoMirrored.Rounded.ArrowBack, contentDescription = "Back one folder")
            }
        } else {
            Surface(
                color = MaterialTheme.colorScheme.primary,
                contentColor = MaterialTheme.colorScheme.onPrimary,
                shape = RoundedCornerShape(14.dp),
                modifier = Modifier.size(44.dp),
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                    Text("D", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Black)
                }
            }
            Spacer(Modifier.width(10.dp))
        }
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                browseSubtitle(state),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        FilledTonalIconButton(onClick = { viewModel.setDestination(AppDestination.NOTES) }) {
            Icon(Icons.Rounded.NoteAlt, contentDescription = "Open notes")
        }
    }
}

@Composable
private fun PracticeStats(state: LibraryUiState) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
        StatPill("Completed", state.allLessons.count { it.legacyPath in state.practice.workspace.completed }.toString(), Modifier.weight(1f))
        StatPill("Favorites", state.favoriteCount.toString(), Modifier.weight(1f))
        StatPill("Queued", state.practice.workspace.queue.size.toString(), Modifier.weight(1f))
    }
}

@Composable
private fun BrowseBreadcrumbs(state: LibraryUiState, viewModel: LibraryViewModel) {
    val tree = state.tree ?: return
    val crumbs: List<Pair<String, BrowseLocation>> = when (val location = state.browseLocation) {
        BrowseLocation.Root -> emptyList()
        is BrowseLocation.Category -> listOf(
            "Library" to BrowseLocation.Root,
            (tree.categoryById[location.categoryId]?.title ?: "Style") to location,
        )
        is BrowseLocation.Folder -> buildList {
            add("Library" to BrowseLocation.Root)
            tree.categoryForFolder(location.folderId)?.let { add(it.title to BrowseLocation.Category(it.id)) }
            tree.folderBreadcrumb(location.folderId).forEach { folder ->
                add((if (folder.parentId == null) courseDisplay(folder.displayName, tree.categoryById[folder.categoryId]?.title.orEmpty()).heading else folder.displayName) to BrowseLocation.Folder(folder.id))
            }
        }
    }
    LazyRow(
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        contentPadding = PaddingValues(horizontal = 14.dp, vertical = 5.dp),
    ) {
        items(crumbs) { (label, destination) ->
            TextButton(onClick = { viewModel.navigate(destination) }) {
                Text(label, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            if (destination != crumbs.lastOrNull()?.second) {
                Icon(Icons.Rounded.ChevronRight, contentDescription = null, modifier = Modifier.padding(top = 12.dp))
            }
        }
    }
}

@Composable
private fun CategoryCard(node: BrowseNode.Category, state: LibraryUiState, viewModel: LibraryViewModel) {
    val lessons = remember(state.catalog, node.id) { state.allLessons.filter { it.categoryId == node.id } }
    val completed = lessons.count { it.legacyPath in state.practice.workspace.completed }
    FolderLikeCard(
        title = node.title,
        subtitle = "${node.category.courseCount} ${if (node.category.courseCount == 1) "course" else "courses"} · ${node.lessonCount} ${if (node.lessonCount == 1) "lesson" else "lessons"}",
        completed = completed,
        total = node.lessonCount,
        icon = Icons.Rounded.LibraryMusic,
        onClick = { viewModel.navigate(BrowseLocation.Category(node.id)) },
    )
}

@Composable
private fun FolderCard(folder: CatalogFolder, state: LibraryUiState, viewModel: LibraryViewModel) {
    val lessons = remember(state.tree, folder.id, state.practice.watched) { state.tree?.lessonsUnder(folder.id).orEmpty() }
    val completed = lessons.count { it.legacyPath in state.practice.workspace.completed }
    val display = if (folder.parentId == null) courseDisplay(folder.displayName, state.tree?.categoryById?.get(folder.categoryId)?.title.orEmpty()) else CourseDisplay(folder.displayName)
    FolderLikeCard(
        title = display.heading,
        subtitle = buildString {
            if (display.teacher.isNotBlank()) append(display.teacher).append("\n")
            folder.presentation?.title?.takeIf { it.isNotBlank() && it != folder.name }?.let {
                append(it).append(" · ")
            }
            folder.presentation?.description?.takeIf(String::isNotBlank)?.let {
                append(it.take(100)).append(if (it.length > 100) "… · " else " · ")
            }
            append(folder.lessonCount).append(if (folder.lessonCount == 1) " lesson" else " lessons")
        },
        completed = completed,
        total = folder.lessonCount,
        icon = Icons.Rounded.Folder,
        accessibilityLabel = folder.displayName,
        onClick = { viewModel.navigate(BrowseLocation.Folder(folder.id)) },
    )
}

@Composable
private fun FolderLikeCard(
    title: String,
    subtitle: String,
    completed: Int,
    total: Int,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    accessibilityLabel: String? = null,
    onClick: () -> Unit,
) {
    Card(
        onClick = onClick,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        modifier = Modifier.fillMaxWidth().semantics { accessibilityLabel?.let { contentDescription = it } },
    ) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Surface(color = MaterialTheme.colorScheme.primaryContainer, shape = RoundedCornerShape(13.dp)) {
                Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(11.dp))
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                Text(title, style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 3)
                LinearProgressIndicator(
                    progress = { if (total == 0) 0f else completed.toFloat() / total },
                    modifier = Modifier.fillMaxWidth(),
                )
                Text("$completed of $total completed", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Icon(Icons.Rounded.ChevronRight, contentDescription = null)
        }
    }
}

@Composable
private fun CompactHomeLesson(lesson: Lesson, state: LibraryUiState, viewModel: LibraryViewModel) {
    LessonRow(
        lesson = lesson,
        favorite = lesson.id in state.practice.favorites,
        watched = lesson.id in state.practice.watched,
                                completed = lesson.legacyPath in state.practice.workspace.completed,
        resumePositionMs = state.practice.positionsMs[lesson.id],
        bookmarkCount = state.practice.bookmarks[lesson.id].orEmpty().size,
        subtitle = lesson.fullFolderLabel(),
        onClick = { viewModel.selectLesson(lesson.id) },
        onToggleFavorite = { viewModel.toggleFavorite(lesson.id) },
    )
}

@Composable
private fun HomeSectionHeader(title: String, count: Int, collapsed: Boolean, onToggle: () -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .semantics {
                role = Role.Button
                stateDescription = if (collapsed) "Collapsed" else "Expanded"
            }
            .clickable(onClick = onToggle)
            .padding(top = 8.dp, bottom = 2.dp),
    ) {
        Text(title, style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
        Text(count.toString(), color = MaterialTheme.colorScheme.onSurfaceVariant)
        Icon(
            if (collapsed) Icons.Rounded.ExpandMore else Icons.Rounded.ExpandLess,
            contentDescription = if (collapsed) "Expand $title" else "Collapse $title",
        )
    }
}

@Composable
private fun PresentationCard(title: String, subtitle: String, description: String) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(title, style = MaterialTheme.typography.titleLarge)
            if (subtitle.isNotBlank()) Text(subtitle, color = MaterialTheme.colorScheme.onPrimaryContainer)
            if (description.isNotBlank()) Text(description, color = MaterialTheme.colorScheme.onPrimaryContainer)
        }
    }
}

@Composable
private fun FolderPresentationCard(presentation: FolderPresentation) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            presentation.title?.let { Text(it, style = MaterialTheme.typography.titleLarge) }
            if (presentation.description.isNotBlank()) Text(presentation.description)
            presentation.prerequisites?.let { prerequisites ->
                if (prerequisites.on1.isNotEmpty()) Text("Prerequisites (On1): ${prerequisites.on1.joinToString()}")
                if (prerequisites.on2.isNotEmpty()) Text("Prerequisites (On2): ${prerequisites.on2.joinToString()}")
            }
            presentation.tips?.takeIf(String::isNotBlank)?.let { Text("Tip: $it", color = MaterialTheme.colorScheme.primary) }
            presentation.song?.takeIf(String::isNotBlank)?.let { Text("Practice song: $it", color = MaterialTheme.colorScheme.secondary) }
        }
    }
}

@Composable
private fun EmptyBrowse(searching: Boolean) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
        modifier = Modifier
            .fillMaxWidth()
            .padding(48.dp),
    ) {
        Icon(if (searching) Icons.Rounded.SearchOff else Icons.Rounded.Folder, contentDescription = null, modifier = Modifier.size(38.dp))
        Text(if (searching) "No lessons match" else "This folder is empty", style = MaterialTheme.typography.titleMedium)
        Text(if (searching) "Try fewer search words." else "Choose another folder.", color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

private fun browseTitle(state: LibraryUiState): String = when (val location = state.browseLocation) {
    BrowseLocation.Root -> "Dance Library"
    is BrowseLocation.Category -> state.tree?.categoryById?.get(location.categoryId)?.title ?: "Dance style"
    is BrowseLocation.Folder -> state.tree?.folderById?.get(location.folderId)?.let { folder ->
        if (folder.parentId == null) courseDisplay(folder.displayName, state.tree?.categoryById?.get(folder.categoryId)?.title.orEmpty()).heading else folder.displayName
    } ?: "Folder"
}

internal fun browseSubtitle(state: LibraryUiState): String {
    if (state.query.isNotBlank()) {
        val count = state.browseNodes.size
        return "$count ${if (count == 1) "search result" else "search results"}"
    }
    val count = state.browseNodes.sumOf(BrowseNode::lessonCount)
    return "$count ${if (count == 1) "lesson" else "lessons"}"
}

private const val HOME_FAVORITES = "favorites"
private const val HOME_CONTINUE = "continue-watching"
private const val HOME_NOTES = "recent-notes"
