package com.deadlywolf.dancelibrary

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
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

class LibraryViewModel(application: Application) : AndroidViewModel(application) {
    private val catalogRepository = CatalogRepository(application)
    private val practiceRepository = PracticeRepository(application)

    private val catalog = MutableStateFlow<DanceCatalog?>(null)
    private val catalogError = MutableStateFlow<String?>(null)
    private val selectedLessonId = MutableStateFlow<String?>(null)
    private val query = MutableStateFlow("")
    private val category = MutableStateFlow(ALL_CATEGORIES)
    private val favoritesOnly = MutableStateFlow(false)

    private val filter = combine(query, category, favoritesOnly, ::LibraryFilter)

    val uiState = combine(
        catalog,
        catalogError,
        practiceRepository.snapshot,
        combine(filter, selectedLessonId, ::Pair),
    ) { loadedCatalog, error, practice, (activeFilter, selectedId) ->
        val lessons = loadedCatalog?.lessons.orEmpty()
        val preferredOrder = listOf("Salsa", "Bachata", "Zouk", "Kizomba", "Salsa Masterclass", "Kizomba Masterclass")
        val available = lessons.map(Lesson::category).distinct()
        val categories = preferredOrder.filter(available::contains) + available.filterNot(preferredOrder::contains).sorted()

        LibraryUiState(
            loading = loadedCatalog == null && error == null,
            errorMessage = error,
            pullZone = loadedCatalog?.pullZoneHost.orEmpty(),
            allLessons = lessons,
            visibleLessons = filterLessons(lessons, activeFilter, practice.favorites),
            categories = categories,
            filter = activeFilter,
            practice = practice,
            selectedLesson = lessons.firstOrNull { it.id == selectedId },
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
        query.value = value
    }

    fun setCategory(value: String) {
        category.value = value
    }

    fun setFavoritesOnly(value: Boolean) {
        favoritesOnly.value = value
    }

    fun selectLesson(lessonId: String?) {
        selectedLessonId.value = lessonId
    }

    fun toggleFavorite(lessonId: String) {
        viewModelScope.launch { practiceRepository.toggleFavorite(lessonId) }
    }

    fun savePlayback(lessonId: String, positionMs: Long, durationMs: Long) {
        viewModelScope.launch { practiceRepository.savePlayback(lessonId, positionMs, durationMs) }
    }

    fun setWatched(lessonId: String, watched: Boolean) {
        viewModelScope.launch { practiceRepository.setWatched(lessonId, watched) }
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

    companion object {
        fun factory(application: Application): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T {
                    require(modelClass.isAssignableFrom(LibraryViewModel::class.java))
                    return LibraryViewModel(application) as T
                }
            }
    }
}

const val ALL_CATEGORIES = "All"
