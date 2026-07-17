package com.deadlywolf.dancelibrary

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.viewModelScope
import com.deadlywolf.dancelibrary.data.BackupImportReport
import com.deadlywolf.dancelibrary.data.BackupLessonReference
import com.deadlywolf.dancelibrary.data.BookmarkAddResult
import com.deadlywolf.dancelibrary.data.BookmarkAddStatus
import com.deadlywolf.dancelibrary.data.PracticeBackupCatalog
import com.deadlywolf.dancelibrary.data.PracticeBackupCodec
import com.deadlywolf.dancelibrary.data.PracticeBookmark
import com.deadlywolf.dancelibrary.data.PracticeExportOptions
import com.deadlywolf.dancelibrary.data.PracticeRepository
import com.deadlywolf.dancelibrary.data.PracticeReset
import com.deadlywolf.dancelibrary.data.PracticeSnapshot
import com.deadlywolf.dancelibrary.data.CatalogRepository
import com.deadlywolf.dancelibrary.model.BrowseLocation
import com.deadlywolf.dancelibrary.model.BrowseNode
import com.deadlywolf.dancelibrary.model.CatalogTree
import com.deadlywolf.dancelibrary.model.DanceCatalog
import com.deadlywolf.dancelibrary.model.Lesson
import com.deadlywolf.dancelibrary.model.ThemeSpec
import com.deadlywolf.dancelibrary.model.matchesSearch
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

enum class AppDestination(val label: String) {
    LIBRARY("Library"),
    NOTES("Notes"),
    FAVORITES("Favorites"),
    HISTORY("History"),
    SETTINGS("Settings"),
}

data class SeekRequest(
    val positionMs: Long,
    val nonce: Long,
)

data class PracticePlayerSession(
    val lessonId: String? = null,
    val speed: Float = 1f,
    val mirrored: Boolean = false,
    val loopStartMs: Long? = null,
    val loopEndMs: Long? = null,
    val theaterMode: Boolean = false,
)

internal fun sessionForLesson(previous: PracticePlayerSession, lessonId: String): PracticePlayerSession =
    previous.copy(lessonId = lessonId, loopStartMs = null, loopEndMs = null)

data class LibraryUiState(
    val loading: Boolean = true,
    val errorMessage: String? = null,
    val catalog: DanceCatalog? = null,
    val tree: CatalogTree? = null,
    val browseLocation: BrowseLocation = BrowseLocation.Root,
    val browseNodes: List<BrowseNode> = emptyList(),
    val query: String = "",
    val destination: AppDestination = AppDestination.LIBRARY,
    val practice: PracticeSnapshot = PracticeSnapshot(),
    val selectedLesson: Lesson? = null,
    val seekRequest: SeekRequest? = null,
    val playWhenReady: Boolean = false,
    val playerSession: PracticePlayerSession = PracticePlayerSession(),
    val feedback: String? = null,
) {
    val allLessons: List<Lesson> get() = catalog?.lessons.orEmpty()
    val pullZone: String get() = practice.pullZoneOverride ?: catalog?.pullZoneHost.orEmpty()
    val currentTheme: ThemeSpec?
        get() = catalog?.themes?.firstOrNull { it.id == practice.themeId }
            ?: catalog?.themes?.firstOrNull { it.id == catalog?.defaultThemeId }
    val watchedCount: Int get() = practice.watched.count { id -> allLessons.any { it.id == id } }
    val favoriteCount: Int get() = practice.favorites.count { id -> allLessons.any { it.id == id } }
    val lastLesson: Lesson?
        get() = allLessons.firstOrNull { it.id == practice.lastLessonId }
            ?: practice.lastWatchedAtMs.maxByOrNull(Map.Entry<String, Long>::value)?.key?.let { id ->
                allLessons.firstOrNull { it.id == id }
            }
    val exactFolderLessons: List<Lesson>
        get() = selectedLesson?.folderId?.let { tree?.directLessons(it) }.orEmpty()
    val previousLesson: Lesson?
        get() = adjacentLesson(-1)
    val nextLesson: Lesson?
        get() = adjacentLesson(1)

    private fun adjacentLesson(offset: Int): Lesson? {
        val lesson = selectedLesson ?: return null
        val index = exactFolderLessons.indexOfFirst { it.id == lesson.id }
        return exactFolderLessons.getOrNull(index + offset)
    }
}

fun filterLessons(
    lessons: List<Lesson>,
    query: String,
    favorites: Set<String>? = null,
): List<Lesson> = lessons.asSequence()
    .filter { favorites == null || it.id in favorites }
    .filter { it.matchesSearch(query) }
    .sortedBy(Lesson::catalogOrdinal)
    .toList()

class LibraryViewModel(
    application: Application,
    private val savedStateHandle: SavedStateHandle,
) : AndroidViewModel(application) {
    private val catalogRepository = CatalogRepository(application)
    private val practiceRepository = PracticeRepository(application)
    private val backupCodec = PracticeBackupCodec()

    private val catalog = MutableStateFlow<DanceCatalog?>(null)
    private val catalogError = MutableStateFlow<String?>(null)
    private val selectedLessonId = savedStateHandle.getStateFlow<String?>(SELECTED_LESSON_KEY, null)
    private val query = savedStateHandle.getStateFlow(QUERY_KEY, "")
    private val locationKey = savedStateHandle.getStateFlow(LOCATION_KEY, ROOT_LOCATION)
    private val destinationKey = savedStateHandle.getStateFlow(DESTINATION_KEY, AppDestination.LIBRARY.name)
    private val playbackIntent = savedStateHandle.getStateFlow(PLAYBACK_INTENT_KEY, false)
    private val seekPositionMs = savedStateHandle.getStateFlow<Long?>(SEEK_POSITION_KEY, null)
    private val seekNonce = savedStateHandle.getStateFlow(SEEK_NONCE_KEY, 0L)
    private val sessionLessonId = savedStateHandle.getStateFlow<String?>(SESSION_LESSON_KEY, null)
    private val sessionSpeed = savedStateHandle.getStateFlow(SESSION_SPEED_KEY, 1f)
    private val sessionMirrored = savedStateHandle.getStateFlow(SESSION_MIRRORED_KEY, false)
    private val sessionLoopStartMs = savedStateHandle.getStateFlow<Long?>(SESSION_LOOP_START_KEY, null)
    private val sessionLoopEndMs = savedStateHandle.getStateFlow<Long?>(SESSION_LOOP_END_KEY, null)
    private val sessionTheaterMode = savedStateHandle.getStateFlow(SESSION_THEATER_KEY, false)
    private val transientPositionsMs = MutableStateFlow<Map<String, Long>>(emptyMap())
    private val suppressedResumeIds = MutableStateFlow<Set<String>>(emptySet())
    private val feedback = MutableStateFlow<String?>(null)

    private val navigationControls = combine(
        query,
        locationKey,
        destinationKey,
        selectedLessonId,
    ) { search, location, destination, selected ->
        NavigationControls(search, location, destination, selected)
    }
    private val playerSessionCore = combine(
        sessionLessonId,
        sessionSpeed,
        sessionMirrored,
        sessionLoopStartMs,
        sessionLoopEndMs,
    ) { lessonId, speed, mirrored, loopStart, loopEnd ->
        PracticePlayerSession(lessonId, speed, mirrored, loopStart, loopEnd)
    }
    private val playerSession = combine(playerSessionCore, sessionTheaterMode) { session, theater ->
        session.copy(theaterMode = theater)
    }
    private val playbackCore = combine(
        playbackIntent,
        seekPositionMs,
        seekNonce,
        transientPositionsMs,
        suppressedResumeIds,
    ) { play, seek, nonce, transient, suppressed ->
        PlaybackControls(play, seek?.let { SeekRequest(it, nonce) }, transient, suppressed)
    }
    private val playbackControls = combine(playbackCore, playerSession) { playback, session ->
        playback.copy(playerSession = session)
    }
    private val controls = combine(navigationControls, playbackControls, feedback, ::UiControls)

    val uiState = combine(
        catalog,
        catalogError,
        practiceRepository.snapshot,
        controls,
    ) { loadedCatalog, error, persistedPractice, controls ->
        val tree = loadedCatalog?.let(::CatalogTree)
        val location = decodeLocation(controls.navigation.locationKey, loadedCatalog)
        val practice = persistedPractice.copy(
            positionsMs = mergePlaybackPositions(
                persisted = persistedPractice.positionsMs,
                transient = controls.playback.transientPositions,
                suppressed = controls.playback.suppressedResumeIds,
            ),
        )
        val browseNodes = when {
            tree == null -> emptyList()
            controls.navigation.query.isBlank() -> tree.nodesAt(location)
            else -> filterLessons(loadedCatalog.lessons, controls.navigation.query)
                .map(BrowseNode::Lesson)
        }

        LibraryUiState(
            loading = loadedCatalog == null && error == null,
            errorMessage = error,
            catalog = loadedCatalog,
            tree = tree,
            browseLocation = location,
            browseNodes = browseNodes,
            query = controls.navigation.query,
            destination = controls.navigation.destinationKey.toDestination(),
            practice = practice,
            selectedLesson = loadedCatalog?.lessons?.firstOrNull { it.id == controls.navigation.selectedLessonId },
            seekRequest = controls.playback.seekRequest,
            playWhenReady = controls.playback.playWhenReady,
            playerSession = controls.playback.playerSession,
            feedback = controls.feedback,
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5_000),
        initialValue = LibraryUiState(),
    )

    init {
        loadCatalog()
    }

    fun retryCatalog() = loadCatalog()

    fun setQuery(value: String) {
        savedStateHandle[QUERY_KEY] = value
    }

    fun setDestination(destination: AppDestination) {
        if (destination != AppDestination.LIBRARY) pausePlayback()
        savedStateHandle[DESTINATION_KEY] = destination.name
    }

    fun pausePlayback() {
        savedStateHandle[PLAYBACK_INTENT_KEY] = false
    }

    fun navigate(location: BrowseLocation) {
        savedStateHandle[LOCATION_KEY] = encodeLocation(location)
        savedStateHandle[QUERY_KEY] = ""
    }

    fun navigateBack() {
        val state = uiState.value
        val catalog = state.catalog ?: return
        navigate(
            when (val location = state.browseLocation) {
                BrowseLocation.Root -> BrowseLocation.Root
                is BrowseLocation.Category -> BrowseLocation.Root
                is BrowseLocation.Folder -> {
                    val folder = catalog.folders.firstOrNull { it.id == location.folderId }
                    folder?.parentId?.let(BrowseLocation::Folder)
                        ?: BrowseLocation.Category(folder?.categoryId.orEmpty())
                }
            },
        )
    }

    fun selectLesson(lessonId: String?, startPositionMs: Long? = null) {
        if (lessonId == null) {
            savedStateHandle[SELECTED_LESSON_KEY] = null
            savedStateHandle[PLAYBACK_INTENT_KEY] = false
            clearSeekRequest()
            return
        }

        savedStateHandle[SELECTED_LESSON_KEY] = lessonId
        savedStateHandle[PLAYBACK_INTENT_KEY] = true
        if (sessionLessonId.value != lessonId) resetPlayerSession(lessonId)
        if (startPositionMs != null) {
            savedStateHandle[SEEK_POSITION_KEY] = startPositionMs.coerceAtLeast(0L)
            savedStateHandle[SEEK_NONCE_KEY] = seekNonce.value + 1L
        } else {
            clearSeekRequest()
        }
        viewModelScope.launch { practiceRepository.markOpened(lessonId) }
    }

    fun selectPreviousLesson() {
        uiState.value.previousLesson?.id?.let(::selectLesson)
    }

    fun selectNextLesson() {
        uiState.value.nextLesson?.id?.let(::selectLesson)
    }

    fun clearSeekRequest() {
        savedStateHandle[SEEK_POSITION_KEY] = null
    }

    fun toggleFavorite(lessonId: String) {
        viewModelScope.launch { practiceRepository.toggleFavorite(lessonId) }
    }

    fun savePlayback(lessonId: String, positionMs: Long, durationMs: Long) {
        if (positionMs < 0L) return
        val completed = isPlaybackComplete(positionMs, durationMs)
        suppressedResumeIds.update { suppressed ->
            when {
                completed || positionMs < MINIMUM_DURABLE_RESUME_MS -> suppressed + lessonId
                else -> suppressed - lessonId
            }
        }
        transientPositionsMs.update { positions ->
            updateTransientPlaybackPosition(positions, lessonId, positionMs, durationMs)
        }
        viewModelScope.launch { practiceRepository.savePlayback(lessonId, positionMs, durationMs) }
    }

    fun setWatched(lessonId: String, watched: Boolean) {
        viewModelScope.launch { practiceRepository.setWatched(lessonId, watched) }
    }

    fun setPlaybackIntent(lessonId: String, playWhenReady: Boolean) {
        if (selectedLessonId.value == lessonId) savedStateHandle[PLAYBACK_INTENT_KEY] = playWhenReady
    }

    fun updatePlayerSession(
        lessonId: String,
        speed: Float,
        mirrored: Boolean,
        loopStartMs: Long?,
        loopEndMs: Long?,
        theaterMode: Boolean,
    ) {
        if (selectedLessonId.value != lessonId) return
        savedStateHandle[SESSION_LESSON_KEY] = lessonId
        savedStateHandle[SESSION_SPEED_KEY] = speed.coerceIn(0.5f, 2f)
        savedStateHandle[SESSION_MIRRORED_KEY] = mirrored
        savedStateHandle[SESSION_LOOP_START_KEY] = loopStartMs
        savedStateHandle[SESSION_LOOP_END_KEY] = loopEndMs
        savedStateHandle[SESSION_THEATER_KEY] = theaterMode
    }

    fun addBookmark(lessonId: String, positionMs: Long, note: String = "") {
        viewModelScope.launch {
            val result = practiceRepository.addBookmark(lessonId, positionMs, note)
            showBookmarkResult(result)
        }
    }

    fun updateBookmarkNote(lessonId: String, bookmarkId: String, note: String) {
        viewModelScope.launch {
            val saved = practiceRepository.updateBookmarkNote(lessonId, bookmarkId, note)
            feedback.value = if (saved) "Note updated." else "The note could not be updated."
        }
    }

    fun deleteBookmark(lessonId: String, bookmarkId: String) {
        viewModelScope.launch {
            val deleted = practiceRepository.deleteBookmark(lessonId, bookmarkId)
            feedback.value = if (deleted) "Bookmark deleted." else "The bookmark could not be deleted."
        }
    }

    fun markNotesSeen() {
        viewModelScope.launch { practiceRepository.markNotesSeen() }
    }

    fun setTheme(themeId: String) {
        if (uiState.value.catalog?.themes?.none { it.id == themeId } != false) return
        viewModelScope.launch { practiceRepository.setTheme(themeId) }
    }

    fun toggleFavoriteTheme(themeId: String) {
        viewModelScope.launch { practiceRepository.toggleFavoriteTheme(themeId) }
    }

    fun setSectionCollapsed(sectionId: String, collapsed: Boolean) {
        viewModelScope.launch { practiceRepository.setSectionCollapsed(sectionId, collapsed) }
    }

    fun setPullZoneOverride(value: String?) {
        viewModelScope.launch {
            val saved = practiceRepository.setPullZoneOverride(value)
            feedback.value = if (saved) "Streaming server updated." else "Enter a valid Bunny pull-zone hostname."
        }
    }

    fun reset(reset: PracticeReset) {
        val clearsResume =
            reset == PracticeReset.WATCH_HISTORY ||
            reset == PracticeReset.RESUME_POSITIONS ||
            reset == PracticeReset.ALL_PRACTICE_DATA ||
            reset == PracticeReset.EVERYTHING
        val activeIds = if (clearsResume) uiState.value.practice.positionsMs.keys else emptySet()
        viewModelScope.launch {
            val saved = practiceRepository.reset(reset)
            if (saved && clearsResume) {
                transientPositionsMs.value = emptyMap()
                suppressedResumeIds.update { it + activeIds }
            }
            feedback.value = if (saved) "Saved data cleared." else "The reset could not be saved."
        }
    }

    fun exportJson(options: PracticeExportOptions = PracticeExportOptions()): String? =
        backupCatalog()?.let { backupCodec.encodeJson(uiState.value.practice, it, options).content }

    fun exportMarkdown(options: PracticeExportOptions = PracticeExportOptions()): String? =
        backupCatalog()?.let { backupCodec.encodeMarkdown(uiState.value.practice, it, options).content }

    fun importJson(json: String) {
        val catalog = backupCatalog() ?: return
        viewModelScope.launch(Dispatchers.Default) {
            val report = practiceRepository.mergeBackup(json, catalog)
            if (report.succeeded) {
                transientPositionsMs.value = emptyMap()
                suppressedResumeIds.value = emptySet()
            }
            feedback.value = report.userMessage()
        }
    }

    fun dismissFeedback() {
        feedback.value = null
    }

    private fun loadCatalog() {
        catalogError.value = null
        catalog.value = null
        viewModelScope.launch {
            runCatching { catalogRepository.load() }
                .onSuccess { catalog.value = it }
                .onFailure { error -> catalogError.value = error.message ?: "The lesson catalog could not be opened." }
        }
    }

    private fun resetPlayerSession(lessonId: String) {
        val next = sessionForLesson(
            previous = PracticePlayerSession(
                lessonId = sessionLessonId.value,
                speed = sessionSpeed.value,
                mirrored = sessionMirrored.value,
                loopStartMs = sessionLoopStartMs.value,
                loopEndMs = sessionLoopEndMs.value,
                theaterMode = sessionTheaterMode.value,
            ),
            lessonId = lessonId,
        )
        savedStateHandle[SESSION_SPEED_KEY] = next.speed
        savedStateHandle[SESSION_MIRRORED_KEY] = next.mirrored
        savedStateHandle[SESSION_LOOP_START_KEY] = next.loopStartMs
        savedStateHandle[SESSION_LOOP_END_KEY] = next.loopEndMs
        savedStateHandle[SESSION_THEATER_KEY] = next.theaterMode
        // Publish ownership last so Compose cannot observe a new lesson with the old lesson's
        // partially-updated tool state and overwrite the preserved session with player defaults.
        savedStateHandle[SESSION_LESSON_KEY] = next.lessonId
    }

    private fun backupCatalog(): PracticeBackupCatalog? = uiState.value.catalog?.lessons?.let { lessons ->
        PracticeBackupCatalog.from(
            references = lessons.map { lesson ->
                BackupLessonReference(lesson.id, lesson.legacyPath, lesson.title, lesson.rawSummary)
            },
            knownThemeIds = uiState.value.catalog?.themes.orEmpty().mapTo(linkedSetOf()) { it.id },
        )
    }

    private fun showBookmarkResult(result: BookmarkAddResult) {
        feedback.value = result.message ?: when {
            result.status == BookmarkAddStatus.ADDED && result.bookmark != null ->
                "Bookmark added at ${formatClock(result.bookmark.positionMs)}."
            result.status == BookmarkAddStatus.DUPLICATE -> "A bookmark already exists at that time."
            else -> "The bookmark could not be added."
        }
    }

    private companion object {
        const val SELECTED_LESSON_KEY = "selected_lesson_id"
        const val QUERY_KEY = "query"
        const val LOCATION_KEY = "browse_location"
        const val DESTINATION_KEY = "destination"
        const val PLAYBACK_INTENT_KEY = "playback_intent"
        const val SEEK_POSITION_KEY = "seek_position_ms"
        const val SEEK_NONCE_KEY = "seek_nonce"
        const val SESSION_LESSON_KEY = "player_session_lesson"
        const val SESSION_SPEED_KEY = "player_session_speed"
        const val SESSION_MIRRORED_KEY = "player_session_mirrored"
        const val SESSION_LOOP_START_KEY = "player_session_loop_start"
        const val SESSION_LOOP_END_KEY = "player_session_loop_end"
        const val SESSION_THEATER_KEY = "player_session_theater"
        const val ROOT_LOCATION = "root"
    }
}

private data class NavigationControls(
    val query: String,
    val locationKey: String,
    val destinationKey: String,
    val selectedLessonId: String?,
)

private data class PlaybackControls(
    val playWhenReady: Boolean,
    val seekRequest: SeekRequest?,
    val transientPositions: Map<String, Long>,
    val suppressedResumeIds: Set<String>,
    val playerSession: PracticePlayerSession = PracticePlayerSession(),
)

private data class UiControls(
    val navigation: NavigationControls,
    val playback: PlaybackControls,
    val feedback: String?,
)

internal fun mergePlaybackPositions(
    persisted: Map<String, Long>,
    transient: Map<String, Long>,
    suppressed: Set<String>,
): Map<String, Long> = (persisted - suppressed) + transient

internal fun updateTransientPlaybackPosition(
    positions: Map<String, Long>,
    lessonId: String,
    positionMs: Long,
    durationMs: Long,
): Map<String, Long> = if (
    isPlaybackComplete(positionMs, durationMs) || positionMs < MINIMUM_TRANSIENT_RESUME_MS
) {
    positions - lessonId
} else {
    positions + (lessonId to positionMs)
}

internal fun isPlaybackComplete(positionMs: Long, durationMs: Long): Boolean =
    durationMs > 0L && positionMs >= (durationMs - COMPLETION_WINDOW_MS).coerceAtLeast(0L)

private fun encodeLocation(location: BrowseLocation): String = when (location) {
    BrowseLocation.Root -> "root"
    is BrowseLocation.Category -> "category:${location.categoryId}"
    is BrowseLocation.Folder -> "folder:${location.folderId}"
}

private fun decodeLocation(key: String, catalog: DanceCatalog?): BrowseLocation = when {
    key.startsWith("category:") -> key.substringAfter(':').takeIf { id -> catalog?.categories?.any { it.id == id } == true }
        ?.let(BrowseLocation::Category)
        ?: BrowseLocation.Root
    key.startsWith("folder:") -> key.substringAfter(':').takeIf { id -> catalog?.folders?.any { it.id == id } == true }
        ?.let(BrowseLocation::Folder)
        ?: BrowseLocation.Root
    else -> BrowseLocation.Root
}

private fun String.toDestination(): AppDestination =
    AppDestination.entries.firstOrNull { it.name == this } ?: AppDestination.LIBRARY

private fun BackupImportReport.userMessage(): String = if (!succeeded) {
    message ?: "The backup could not be imported."
} else {
        val changed = favoritesAdded + watchedAdded + positionsAddedOrUpdated + historyAddedOrUpdated + bookmarksAdded + bookmarksUpdated + settingsUpdated
    buildString {
        append("Import complete: ").append(changed).append(" saved item")
        if (changed != 1) append('s')
        append(" merged.")
        if (unknownLegacyPaths.isNotEmpty()) append(" ${unknownLegacyPaths.size} unknown lesson path(s) skipped.")
    }
}

private fun formatClock(milliseconds: Long): String {
    val seconds = (milliseconds / 1_000L).coerceAtLeast(0L)
    return "%d:%02d".format(seconds / 60L, seconds % 60L)
}

private const val MINIMUM_TRANSIENT_RESUME_MS = 500L
private const val MINIMUM_DURABLE_RESUME_MS = 5_000L
private const val COMPLETION_WINDOW_MS = 5_000L
