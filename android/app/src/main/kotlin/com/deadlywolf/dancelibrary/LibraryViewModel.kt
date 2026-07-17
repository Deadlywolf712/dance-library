package com.deadlywolf.dancelibrary

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.viewModelScope
import com.deadlywolf.dancelibrary.data.CatalogRepository
import com.deadlywolf.dancelibrary.data.PracticeRepository
import com.deadlywolf.dancelibrary.data.PracticeSnapshot
import com.deadlywolf.dancelibrary.model.DanceCatalog
import com.deadlywolf.dancelibrary.model.Lesson
import com.deadlywolf.dancelibrary.model.category
import com.deadlywolf.dancelibrary.model.matchesSearch
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class LibraryFilter(
    val query: String = "",
    val category: String = ALL_CATEGORIES,
    val favoritesOnly: Boolean = false,
)

data class LibraryUiState(
    val loading: Boolean = true,
    val errorMessage: String? = null,
    val pullZone: String = "",
    val allLessons: List<Lesson> = emptyList(),
    val visibleLessons: List<Lesson> = emptyList(),
    val categories: List<String> = emptyList(),
    val filter: LibraryFilter = LibraryFilter(),
    val practice: PracticeSnapshot = PracticeSnapshot(),
    val selectedLesson: Lesson? = null,
    val playWhenReady: Boolean = false,
) {
    val watchedCount: Int get() = practice.watched.count { id -> allLessons.any { it.id == id } }
    val favoriteCount: Int get() = practice.favorites.count { id -> allLessons.any { it.id == id } }
    val lastLesson: Lesson? get() = allLessons.firstOrNull { it.id == practice.lastLessonId }
}

fun filterLessons(
    lessons: List<Lesson>,
    filter: LibraryFilter,
    favorites: Set<String>,
): List<Lesson> = lessons.asSequence()
    .filter { filter.category == ALL_CATEGORIES || it.category == filter.category }
    .filter { !filter.favoritesOnly || it.id in favorites }
    .filter { it.matchesSearch(filter.query) }
    .sortedBy(Lesson::catalogOrdinal)
    .toList()

class LibraryViewModel(
    application: Application,
    private val savedStateHandle: SavedStateHandle,
) : AndroidViewModel(application) {
    private val catalogRepository = CatalogRepository(application)
    private val practiceRepository = PracticeRepository(application)

    private val catalog = MutableStateFlow<DanceCatalog?>(null)
    private val catalogError = MutableStateFlow<String?>(null)
    private val selectedLessonId = savedStateHandle.getStateFlow<String?>(SELECTED_LESSON_KEY, null)
    private val query = savedStateHandle.getStateFlow(QUERY_KEY, "")
    private val category = savedStateHandle.getStateFlow(CATEGORY_KEY, ALL_CATEGORIES)
    private val favoritesOnly = savedStateHandle.getStateFlow(FAVORITES_ONLY_KEY, false)
    private val playbackIntent = savedStateHandle.getStateFlow(PLAYBACK_INTENT_KEY, false)
    private val transientPositionsMs = MutableStateFlow<Map<String, Long>>(emptyMap())
    private val suppressedResumeIds = MutableStateFlow<Set<String>>(emptySet())
    private val explicitlyWatchedPlaybackLocks = MutableStateFlow<Set<String>>(emptySet())

    private val filter = combine(query, category, favoritesOnly, ::LibraryFilter)
    private val playbackSession = combine(
        transientPositionsMs,
        suppressedResumeIds,
        playbackIntent,
        ::PlaybackSessionState,
    )
    private val uiControls = combine(filter, selectedLessonId, playbackSession, ::UiControls)

    val uiState = combine(
        catalog,
        catalogError,
        practiceRepository.snapshot,
        uiControls,
    ) { loadedCatalog, error, persistedPractice, controls ->
        val lessons = loadedCatalog?.lessons.orEmpty()
        val preferredOrder = listOf("Salsa", "Bachata", "Zouk", "Kizomba", "Salsa Masterclass", "Kizomba Masterclass")
        val available = lessons.map(Lesson::category).distinct()
        val categories = preferredOrder.filter(available::contains) + available.filterNot(preferredOrder::contains).sorted()
        val practice = persistedPractice.copy(
            positionsMs = mergePlaybackPositions(
                persisted = persistedPractice.positionsMs,
                transient = controls.playbackSession.transientPositions,
                suppressed = controls.playbackSession.suppressedResumeIds,
            ),
        )

        LibraryUiState(
            loading = loadedCatalog == null && error == null,
            errorMessage = error,
            pullZone = loadedCatalog?.pullZoneHost.orEmpty(),
            allLessons = lessons,
            visibleLessons = filterLessons(lessons, controls.filter, practice.favorites),
            categories = categories,
            filter = controls.filter,
            practice = practice,
            selectedLesson = lessons.firstOrNull { it.id == controls.selectedLessonId },
            playWhenReady = controls.playbackSession.playWhenReady,
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

    fun setCategory(value: String) {
        savedStateHandle[CATEGORY_KEY] = value
    }

    fun setFavoritesOnly(value: Boolean) {
        savedStateHandle[FAVORITES_ONLY_KEY] = value
    }

    fun selectLesson(lessonId: String?) {
        if (lessonId != selectedLessonId.value) {
            savedStateHandle[PLAYBACK_INTENT_KEY] = lessonId != null
        }
        savedStateHandle[SELECTED_LESSON_KEY] = lessonId
    }

    fun toggleFavorite(lessonId: String) {
        viewModelScope.launch { practiceRepository.toggleFavorite(lessonId) }
    }

    fun savePlayback(lessonId: String, positionMs: Long, durationMs: Long) {
        if (
            !isPlaybackTrackingAllowed(
                lessonId = lessonId,
                watchedIds = uiState.value.practice.watched,
                explicitlyWatchedIds = explicitlyWatchedPlaybackLocks.value,
            )
        ) {
            transientPositionsMs.update { it - lessonId }
            suppressedResumeIds.update { it + lessonId }
            return
        }

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
        if (watched) {
            explicitlyWatchedPlaybackLocks.update { it + lessonId }
            transientPositionsMs.update { it - lessonId }
            suppressedResumeIds.update { it + lessonId }
        } else {
            explicitlyWatchedPlaybackLocks.update { it - lessonId }
            suppressedResumeIds.update { it - lessonId }
        }
        viewModelScope.launch { practiceRepository.setWatched(lessonId, watched) }
    }

    fun setPlaybackIntent(lessonId: String, playWhenReady: Boolean) {
        if (selectedLessonId.value == lessonId) {
            savedStateHandle[PLAYBACK_INTENT_KEY] = playWhenReady
        }
    }

    private fun loadCatalog() {
        catalogError.value = null
        catalog.value = null
        viewModelScope.launch {
            runCatching { catalogRepository.load() }
                .onSuccess { catalog.value = it }
                .onFailure { error ->
                    catalogError.value = error.message ?: "The lesson catalog could not be opened."
                }
        }
    }

    private companion object {
        const val SELECTED_LESSON_KEY = "selected_lesson_id"
        const val QUERY_KEY = "query"
        const val CATEGORY_KEY = "category"
        const val FAVORITES_ONLY_KEY = "favorites_only"
        const val PLAYBACK_INTENT_KEY = "playback_intent"
    }
}

private data class PlaybackSessionState(
    val transientPositions: Map<String, Long>,
    val suppressedResumeIds: Set<String>,
    val playWhenReady: Boolean,
)

private data class UiControls(
    val filter: LibraryFilter,
    val selectedLessonId: String?,
    val playbackSession: PlaybackSessionState,
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
): Map<String, Long> {
    val completed = isPlaybackComplete(positionMs, durationMs)
    return if (completed || positionMs < MINIMUM_TRANSIENT_RESUME_MS) {
        positions - lessonId
    } else {
        positions + (lessonId to positionMs)
    }
}

internal fun isPlaybackTrackingAllowed(
    lessonId: String,
    watchedIds: Set<String>,
    explicitlyWatchedIds: Set<String>,
): Boolean = lessonId !in watchedIds && lessonId !in explicitlyWatchedIds

private fun isPlaybackComplete(positionMs: Long, durationMs: Long): Boolean =
    durationMs > 0 && positionMs >= (durationMs * PLAYBACK_COMPLETION_FRACTION).toLong()

const val ALL_CATEGORIES = "All"
private const val MINIMUM_TRANSIENT_RESUME_MS = 500L
private const val MINIMUM_DURABLE_RESUME_MS = 5_000L
private const val PLAYBACK_COMPLETION_FRACTION = 0.90
