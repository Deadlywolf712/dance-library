package com.deadlywolf.dancelibrary.data

import android.content.Context
import android.util.Log
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.MutablePreferences
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.core.stringSetPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import java.io.IOException
import java.util.UUID

private val Context.practiceDataStore by preferencesDataStore(name = "dance_practice")

class PracticeRepository internal constructor(
    private val dataStore: DataStore<Preferences>,
    private val gson: Gson = Gson(),
    private val clock: () -> Long = System::currentTimeMillis,
    private val bookmarkIdFactory: () -> String = { UUID.randomUUID().toString() },
    private val backupCodec: PracticeBackupCodec = PracticeBackupCodec(gson),
) {
    constructor(context: Context, gson: Gson = Gson()) : this(
        dataStore = context.practiceDataStore,
        gson = gson,
    )

    val snapshot: Flow<PracticeSnapshot> = dataStore.data
        .catch { error ->
            if (error is IOException) emit(androidx.datastore.preferences.core.emptyPreferences()) else throw error
        }
        .map(::decode)

    suspend fun markOpened(lessonId: String, openedAtMs: Long = clock()): Boolean {
        if (lessonId.isBlank() || openedAtMs < 0L) return false
        return editSafely("watch history") { values ->
            val watched = values[WATCHED].orEmpty().toMutableSet()
            val history = decodeLongMap(values[LAST_WATCHED_AT_MS]).toMutableMap()
            watched += lessonId
            history[lessonId] = maxOf(history[lessonId] ?: 0L, openedAtMs)
            values[WATCHED] = watched
            values[LAST_WATCHED_AT_MS] = gson.toJson(history)
            values[LAST_LESSON] = lessonId
            values[LAST_SAVED_AT] = clock()
        }
    }

    suspend fun toggleFavorite(lessonId: String): Boolean {
        if (lessonId.isBlank()) return false
        return editSafely("favorites") { values ->
            val next = values[FAVORITES].orEmpty().toMutableSet()
            if (!next.add(lessonId)) next.remove(lessonId)
            values[FAVORITES] = next
        }
    }

    suspend fun savePlayback(lessonId: String, positionMs: Long, durationMs: Long): Boolean {
        if (lessonId.isBlank() || positionMs < 0L) return false
        return editSafely("playback progress") { values ->
            val originalPositions = decodePositions(values[POSITIONS])
            val originalWatched = values[WATCHED].orEmpty()
            val positions = originalPositions.toMutableMap()
            val watched = originalWatched.toMutableSet()
            val completed = durationMs > 0L && positionMs >= (durationMs - COMPLETION_WINDOW_MS).coerceAtLeast(0L)

            when {
                completed -> {
                    positions.remove(lessonId)
                    watched += lessonId
                }

                positionMs >= MINIMUM_RESUME_MS -> positions[lessonId] = positionMs
                else -> positions.remove(lessonId)
            }

            if (
                positions == originalPositions &&
                watched == originalWatched &&
                values[LAST_LESSON] == lessonId
            ) {
                return@editSafely
            }

            values[POSITIONS] = gson.toJson(positions)
            values[WATCHED] = watched
            values[LAST_LESSON] = lessonId
            values[LAST_SAVED_AT] = clock()
        }
    }

    suspend fun setWatched(lessonId: String, watched: Boolean): Boolean {
        if (lessonId.isBlank()) return false
        return editSafely("watched status") { values ->
            val current = values[WATCHED].orEmpty()
            val next = current.toMutableSet()
            val history = decodeLongMap(values[LAST_WATCHED_AT_MS]).toMutableMap()
            if (watched) {
                next += lessonId
                history.putIfAbsent(lessonId, clock())
            } else {
                next -= lessonId
                history.remove(lessonId)
            }
            if (next == current && history == decodeLongMap(values[LAST_WATCHED_AT_MS])) return@editSafely
            values[WATCHED] = next
            values[LAST_WATCHED_AT_MS] = gson.toJson(history)
        }
    }

    suspend fun addBookmark(
        lessonId: String,
        positionMs: Long,
        note: String = "",
    ): BookmarkAddResult {
        val normalizedNote = note.trim()
        if (lessonId.isBlank() || positionMs < 0L || normalizedNote.length > MAX_UI_NOTE_LENGTH) {
            return BookmarkAddResult(
                status = BookmarkAddStatus.INVALID,
                message = "Bookmarks require a valid lesson, time, and a note of at most $MAX_UI_NOTE_LENGTH characters.",
            )
        }

        var result: BookmarkAddResult? = null
        val persisted = editSafely("bookmark") { values ->
            val allBookmarks = decodeBookmarks(values[BOOKMARKS]).toMutableMap()
            val lessonBookmarks = allBookmarks[lessonId].orEmpty().toMutableList()
            val duplicate = lessonBookmarks.firstOrNull { bookmark ->
                distanceBetween(bookmark.positionMs, positionMs) < BOOKMARK_DUPLICATE_WINDOW_MS
            }
            if (duplicate != null) {
                result = BookmarkAddResult(BookmarkAddStatus.DUPLICATE, duplicate)
                return@editSafely
            }

            val now = clock().coerceAtLeast(0L)
            val bookmark = PracticeBookmark(
                id = bookmarkIdFactory(),
                lessonId = lessonId,
                positionMs = positionMs,
                note = normalizedNote,
                createdAtMs = now,
                updatedAtMs = now,
            )
            lessonBookmarks += bookmark
            allBookmarks[lessonId] = lessonBookmarks.sortedBy(PracticeBookmark::positionMs)
            values[BOOKMARKS] = gson.toJson(allBookmarks)
            result = BookmarkAddResult(BookmarkAddStatus.ADDED, bookmark)
        }

        return when {
            !persisted -> BookmarkAddResult(
                BookmarkAddStatus.PERSISTENCE_FAILED,
                message = "The bookmark could not be saved.",
            )

            else -> requireNotNull(result)
        }
    }

    suspend fun updateBookmarkNote(
        lessonId: String,
        bookmarkId: String,
        note: String,
    ): Boolean {
        val normalizedNote = note.trim()
        if (lessonId.isBlank() || bookmarkId.isBlank() || normalizedNote.length > MAX_IMPORTED_NOTE_LENGTH) return false
        var found = false
        val persisted = editSafely("bookmark note") { values ->
            val allBookmarks = decodeBookmarks(values[BOOKMARKS]).toMutableMap()
            val bookmarks = allBookmarks[lessonId].orEmpty().toMutableList()
            val index = bookmarks.indexOfFirst { it.id == bookmarkId }
            if (index < 0) return@editSafely
            found = true
            if (bookmarks[index].note == normalizedNote) return@editSafely
            bookmarks[index] = bookmarks[index].copy(note = normalizedNote, updatedAtMs = clock().coerceAtLeast(0L))
            allBookmarks[lessonId] = bookmarks
            values[BOOKMARKS] = gson.toJson(allBookmarks)
        }
        return persisted && found
    }

    suspend fun deleteBookmark(lessonId: String, bookmarkId: String): Boolean {
        if (lessonId.isBlank() || bookmarkId.isBlank()) return false
        var removed = false
        val persisted = editSafely("bookmark deletion") { values ->
            val allBookmarks = decodeBookmarks(values[BOOKMARKS]).toMutableMap()
            val bookmarks = allBookmarks[lessonId].orEmpty().toMutableList()
            removed = bookmarks.removeAll { it.id == bookmarkId }
            if (!removed) return@editSafely
            if (bookmarks.isEmpty()) allBookmarks.remove(lessonId) else allBookmarks[lessonId] = bookmarks
            values[BOOKMARKS] = gson.toJson(allBookmarks)
            values[NOTES_BADGE_SEEN] = minOf(
                values[NOTES_BADGE_SEEN] ?: 0L,
                allBookmarks.values.sumOf { it.size }.toLong(),
            )
        }
        return persisted && removed
    }

    suspend fun setThemeId(themeId: String): Boolean {
        if (!isSafePreferenceIdentifier(themeId)) return false
        return editSafely("theme") { it[THEME_ID] = themeId }
    }

    suspend fun setTheme(themeId: String): Boolean = setThemeId(themeId)

    suspend fun toggleFavoriteTheme(themeId: String): Boolean {
        if (!isSafePreferenceIdentifier(themeId)) return false
        return editSafely("favorite themes") { values ->
            val next = values[FAVORITE_THEMES].orEmpty().toMutableSet()
            if (!next.add(themeId)) next.remove(themeId)
            values[FAVORITE_THEMES] = next
        }
    }

    suspend fun setCollapsedSection(sectionId: String, collapsed: Boolean): Boolean {
        if (sectionId.isBlank() || sectionId.length > MAX_SECTION_ID_LENGTH) return false
        return editSafely("collapsed sections") { values ->
            val sections = normalizeCollapsedSectionIds(decodeBooleanMap(values[COLLAPSED_SECTIONS])).toMutableMap()
            sections[sectionId] = collapsed
            values[COLLAPSED_SECTIONS] = gson.toJson(sections)
        }
    }

    suspend fun setSectionCollapsed(sectionId: String, collapsed: Boolean): Boolean =
        setCollapsedSection(sectionId, collapsed)

    suspend fun markNotesSeen(): Boolean = editSafely("notes badge") { values ->
        values[NOTES_BADGE_SEEN] = decodeBookmarks(values[BOOKMARKS]).values.sumOf { it.size }.toLong()
    }

    suspend fun setPullZoneOverride(value: String?): Boolean {
        val normalized = normalizePullZoneOverride(value)
        if (!value.isNullOrBlank() && normalized == null) return false
        return editSafely("Bunny pull-zone override") { values ->
            if (normalized == null) values.remove(PULL_ZONE_OVERRIDE) else values[PULL_ZONE_OVERRIDE] = normalized
        }
    }

    suspend fun reset(target: PracticeReset): Boolean = editSafely("practice reset") { values ->
        when (target) {
            PracticeReset.WATCH_HISTORY -> {
                values.remove(WATCHED)
                values.remove(LAST_WATCHED_AT_MS)
                values.remove(POSITIONS)
                values.remove(LAST_LESSON)
                values.remove(LAST_SAVED_AT)
            }

            PracticeReset.BOOKMARKS_AND_NOTES -> {
                values.remove(BOOKMARKS)
                values.remove(NOTES_BADGE_SEEN)
            }

            PracticeReset.FAVORITES -> values.remove(FAVORITES)
            PracticeReset.RESUME_POSITIONS -> values.remove(POSITIONS)
            PracticeReset.ALL_PRACTICE_DATA -> clearPracticeData(values)
            PracticeReset.SETTINGS -> clearSettings(values)
            PracticeReset.EVERYTHING -> {
                clearPracticeData(values)
            }
        }
    }

    suspend fun mergeBackup(
        json: String,
        catalog: PracticeBackupCatalog,
    ): BackupImportReport {
        val imported = try {
            backupCodec.decodeJson(json, catalog)
        } catch (error: BackupFormatException) {
            return BackupImportReport(succeeded = false, message = error.message)
        }

        var favoritesAdded = 0
        var watchedAdded = 0
        var positionsUpdated = 0
        var historyUpdated = 0
        var bookmarksAdded = 0
        var bookmarksUpdated = 0
        var duplicateBookmarks = 0
        var settingsUpdated = 0

        val persisted = editSafely("backup import") { values ->
            val favorites = values[FAVORITES].orEmpty().toMutableSet()
            imported.favorites.forEach { if (favorites.add(it)) favoritesAdded += 1 }
            values[FAVORITES] = favorites

            val watched = values[WATCHED].orEmpty().toMutableSet()
            imported.watched.forEach { if (watched.add(it)) watchedAdded += 1 }
            values[WATCHED] = watched

            val positions = decodePositions(values[POSITIONS]).toMutableMap()
            imported.positionsMs.forEach { (lessonId, positionMs) ->
                if (positionMs >= MINIMUM_RESUME_MS && positionMs > (positions[lessonId] ?: -1L)) {
                    positions[lessonId] = positionMs
                    positionsUpdated += 1
                }
            }
            values[POSITIONS] = gson.toJson(positions)

            val history = decodeLongMap(values[LAST_WATCHED_AT_MS]).toMutableMap()
            imported.lastWatchedAtMs.forEach { (lessonId, watchedAtMs) ->
                if (watchedAtMs > (history[lessonId] ?: -1L)) {
                    history[lessonId] = watchedAtMs
                    historyUpdated += 1
                }
            }
            values[LAST_WATCHED_AT_MS] = gson.toJson(history)

            val allBookmarks = decodeBookmarks(values[BOOKMARKS]).toMutableMap()
            imported.bookmarks.forEach { (lessonId, incomingBookmarks) ->
                val existing = allBookmarks[lessonId].orEmpty().toMutableList()
                incomingBookmarks.forEach { incoming ->
                    val duplicateIndex = existing.indexOfFirst { bookmark ->
                        distanceBetween(bookmark.positionMs, incoming.positionMs) < BOOKMARK_DUPLICATE_WINDOW_MS
                    }
                    if (duplicateIndex < 0) {
                        val timestamp = incoming.timestampMs.takeIf { it > 0L } ?: clock().coerceAtLeast(0L)
                        existing += PracticeBookmark(
                            id = bookmarkIdFactory(),
                            lessonId = lessonId,
                            positionMs = incoming.positionMs,
                            note = incoming.note,
                            createdAtMs = timestamp,
                            updatedAtMs = timestamp,
                        )
                        bookmarksAdded += 1
                    } else {
                        val current = existing[duplicateIndex]
                        val incomingIsNewer = incoming.timestampMs > current.updatedAtMs
                        val incomingAddsNote = current.note.isBlank() && incoming.note.isNotBlank()
                        if (incoming.note.isNotBlank() && (incomingIsNewer || incomingAddsNote)) {
                            existing[duplicateIndex] = current.copy(
                                note = incoming.note,
                                updatedAtMs = maxOf(current.updatedAtMs, incoming.timestampMs),
                            )
                            bookmarksUpdated += 1
                        } else {
                            duplicateBookmarks += 1
                        }
                    }
                }
                if (existing.isNotEmpty()) allBookmarks[lessonId] = existing.sortedBy(PracticeBookmark::positionMs)
            }
            values[BOOKMARKS] = gson.toJson(allBookmarks)

            imported.lastLessonId?.let { incomingLessonId ->
                val currentLessonId = values[LAST_LESSON]
                val currentOpenedAt = currentLessonId?.let { history[it] } ?: Long.MIN_VALUE
                val incomingOpenedAt = imported.lastWatchedAtMs[incomingLessonId] ?: Long.MIN_VALUE
                if (currentLessonId == null || incomingOpenedAt > currentOpenedAt) {
                    values[LAST_LESSON] = incomingLessonId
                }
            }
            imported.themeId?.let {
                if (values[THEME_ID] != it) settingsUpdated += 1
                values[THEME_ID] = it
            }
            if (imported.favoriteThemes.isNotEmpty()) {
                val current = values[FAVORITE_THEMES].orEmpty()
                val merged = current + imported.favoriteThemes
                settingsUpdated += merged.size - current.size
                values[FAVORITE_THEMES] = merged
            }
            if (imported.collapsedSections.isNotEmpty()) {
                val sections = normalizeCollapsedSectionIds(decodeBooleanMap(values[COLLAPSED_SECTIONS])).toMutableMap()
                val importedSections = normalizeCollapsedSectionIds(imported.collapsedSections)
                settingsUpdated += importedSections.count { (key, value) -> sections[key] != value }
                sections.putAll(importedSections)
                values[COLLAPSED_SECTIONS] = gson.toJson(sections)
            }
            imported.notesBadgeSeen?.let { importedSeen ->
                val mergedSeen = minOf(
                    maxOf(values[NOTES_BADGE_SEEN] ?: 0L, importedSeen),
                    allBookmarks.values.sumOf { it.size }.toLong(),
                )
                if (values[NOTES_BADGE_SEEN] != mergedSeen) settingsUpdated += 1
                values[NOTES_BADGE_SEEN] = mergedSeen
            }
            if (imported.hasPullZoneOverride) {
                if (normalizePullZoneOverride(values[PULL_ZONE_OVERRIDE]) != imported.pullZoneOverride) settingsUpdated += 1
                if (imported.pullZoneOverride == null) values.remove(PULL_ZONE_OVERRIDE)
                else values[PULL_ZONE_OVERRIDE] = imported.pullZoneOverride
            }
        }

        return BackupImportReport(
            succeeded = persisted,
            favoritesAdded = if (persisted) favoritesAdded else 0,
            watchedAdded = if (persisted) watchedAdded else 0,
            positionsAddedOrUpdated = if (persisted) positionsUpdated else 0,
            historyAddedOrUpdated = if (persisted) historyUpdated else 0,
            bookmarksAdded = if (persisted) bookmarksAdded else 0,
            bookmarksUpdated = if (persisted) bookmarksUpdated else 0,
            duplicateBookmarksSkipped = if (persisted) duplicateBookmarks else 0,
            settingsUpdated = if (persisted) settingsUpdated else 0,
            unknownLegacyPaths = imported.unknownLegacyPaths,
            message = if (persisted) null else "The backup was valid, but its data could not be saved.",
        )
    }

    suspend fun mergeBackup(
        json: String,
        lessonIdByLegacyPath: Map<String, String>,
    ): BackupImportReport = mergeBackup(json, PracticeBackupCatalog.fromLegacyPathMap(lessonIdByLegacyPath))

    suspend fun exportJson(
        catalog: PracticeBackupCatalog,
        options: PracticeExportOptions = PracticeExportOptions(),
        exportedAtMs: Long = clock(),
    ): BackupExportResult = backupCodec.encodeJson(snapshot.first(), catalog, options, exportedAtMs)

    suspend fun exportMarkdown(
        catalog: PracticeBackupCatalog,
        options: PracticeExportOptions = PracticeExportOptions(),
        exportedAtMs: Long = clock(),
    ): BackupExportResult = backupCodec.encodeMarkdown(snapshot.first(), catalog, options, exportedAtMs)

    private suspend fun editSafely(
        operation: String,
        transform: suspend (MutablePreferences) -> Unit,
    ): Boolean = try {
        dataStore.edit { values ->
            migrate(values)
            transform(values)
        }
        true
    } catch (error: IOException) {
        Log.w(TAG, "Could not persist $operation; continuing without saving.", error)
        false
    }

    private fun migrate(values: MutablePreferences) {
        val version = values[STORAGE_SCHEMA_VERSION] ?: 0
        if (version < CURRENT_STORAGE_SCHEMA_VERSION) {
            // Schema 1 used the same favorites, watched, positions, and last-lesson keys.
            // Keeping those keys in place makes this migration lossless and idempotent.
            values[STORAGE_SCHEMA_VERSION] = CURRENT_STORAGE_SCHEMA_VERSION
        }
    }

    private fun decode(values: Preferences): PracticeSnapshot {
        val bookmarks = decodeBookmarks(values[BOOKMARKS])
        val bookmarkCount = bookmarks.values.sumOf { it.size }.toLong()
        return PracticeSnapshot(
            favorites = values[FAVORITES].orEmpty(),
            watched = values[WATCHED].orEmpty(),
            positionsMs = decodePositions(values[POSITIONS]),
            lastWatchedAtMs = decodeLongMap(values[LAST_WATCHED_AT_MS]),
            bookmarks = bookmarks,
            lastLessonId = values[LAST_LESSON],
            themeId = values[THEME_ID]?.takeIf(::isSafePreferenceIdentifier) ?: DEFAULT_THEME_ID,
            favoriteThemes = values[FAVORITE_THEMES].orEmpty().filterTo(linkedSetOf(), ::isSafePreferenceIdentifier),
            collapsedSections = normalizeCollapsedSectionIds(decodeBooleanMap(values[COLLAPSED_SECTIONS])),
            notesBadgeSeen = (values[NOTES_BADGE_SEEN] ?: 0L).coerceIn(0L, bookmarkCount),
            pullZoneOverride = normalizePullZoneOverride(values[PULL_ZONE_OVERRIDE]),
        )
    }

    private fun decodePositions(json: String?): Map<String, Long> = decodeLongMap(json)
        .filterValues { it >= MINIMUM_RESUME_MS }

    private fun decodeLongMap(json: String?): Map<String, Long> {
        if (json.isNullOrBlank()) return emptyMap()
        return runCatching {
            gson.fromJson<Map<String, Long>>(json, LONG_MAP_TYPE).orEmpty()
                .filter { (key, value) -> key.isNotBlank() && value >= 0L }
        }.getOrDefault(emptyMap())
    }

    private fun decodeBooleanMap(json: String?): Map<String, Boolean> {
        if (json.isNullOrBlank()) return emptyMap()
        return runCatching {
            gson.fromJson<Map<String, Boolean>>(json, BOOLEAN_MAP_TYPE).orEmpty()
                .filterKeys { it.isNotBlank() && it.length <= MAX_SECTION_ID_LENGTH }
        }.getOrDefault(emptyMap())
    }

    private fun normalizeCollapsedSectionIds(sections: Map<String, Boolean>): Map<String, Boolean> {
        if (sections.isEmpty()) return emptyMap()
        val normalized = sections.toMutableMap()
        LEGACY_COLLAPSED_SECTION_IDS.forEach { (legacyId, websiteId) ->
            if (websiteId !in normalized) normalized[legacyId]?.let { normalized[websiteId] = it }
            normalized.remove(legacyId)
        }
        return normalized
    }

    private fun decodeBookmarks(json: String?): Map<String, List<PracticeBookmark>> {
        if (json.isNullOrBlank()) return emptyMap()
        return runCatching {
            gson.fromJson<Map<String, List<PracticeBookmark>>>(json, BOOKMARK_MAP_TYPE).orEmpty()
                .mapNotNull { (lessonId, bookmarks) ->
                    if (lessonId.isBlank()) return@mapNotNull null
                    val valid = bookmarks.asSequence()
                        .filter { bookmark ->
                            bookmark.id.isNotBlank() &&
                                bookmark.positionMs >= 0L &&
                                bookmark.note.length <= MAX_IMPORTED_NOTE_LENGTH &&
                                bookmark.createdAtMs >= 0L &&
                                bookmark.updatedAtMs >= 0L
                        }
                        .distinctBy(PracticeBookmark::id)
                        .map { it.copy(lessonId = lessonId) }
                        .sortedBy(PracticeBookmark::positionMs)
                        .toList()
                    lessonId.takeIf { valid.isNotEmpty() }?.let { it to valid }
                }
                .toMap()
        }.getOrDefault(emptyMap())
    }

    private fun clearPracticeData(values: MutablePreferences) {
        values.remove(FAVORITES)
        values.remove(WATCHED)
        values.remove(POSITIONS)
        values.remove(LAST_WATCHED_AT_MS)
        values.remove(BOOKMARKS)
        values.remove(LAST_LESSON)
        values.remove(LAST_SAVED_AT)
        values.remove(NOTES_BADGE_SEEN)
    }

    private fun clearSettings(values: MutablePreferences) {
        values.remove(THEME_ID)
        values.remove(FAVORITE_THEMES)
        values.remove(COLLAPSED_SECTIONS)
        values.remove(PULL_ZONE_OVERRIDE)
    }

    private companion object {
        const val TAG = "PracticeRepository"
        const val CURRENT_STORAGE_SCHEMA_VERSION = 2
        const val MINIMUM_RESUME_MS = 5_000L
        const val COMPLETION_WINDOW_MS = 5_000L
        const val BOOKMARK_DUPLICATE_WINDOW_MS = 1_000L
        const val MAX_SECTION_ID_LENGTH = 200
        val SAFE_PREFERENCE_ID = Regex("^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$")
        val LEGACY_COLLAPSED_SECTION_IDS = mapOf(
            "home_favorites" to "favorites",
            "home_continue" to "continue-watching",
            "home_notes" to "recent-notes",
        )

        val FAVORITES = stringSetPreferencesKey("favorite_lesson_ids")
        val WATCHED = stringSetPreferencesKey("watched_lesson_ids")
        val POSITIONS = stringPreferencesKey("playback_positions_ms")
        val LAST_WATCHED_AT_MS = stringPreferencesKey("last_watched_at_ms")
        val BOOKMARKS = stringPreferencesKey("bookmarks")
        val LAST_LESSON = stringPreferencesKey("last_lesson_id")
        val LAST_SAVED_AT = longPreferencesKey("last_saved_at")
        val THEME_ID = stringPreferencesKey("theme_id")
        val FAVORITE_THEMES = stringSetPreferencesKey("favorite_theme_ids")
        val COLLAPSED_SECTIONS = stringPreferencesKey("collapsed_sections")
        val NOTES_BADGE_SEEN = longPreferencesKey("notes_badge_seen")
        val PULL_ZONE_OVERRIDE = stringPreferencesKey("pull_zone_override")
        val STORAGE_SCHEMA_VERSION = intPreferencesKey("storage_schema_version")

        val LONG_MAP_TYPE = object : TypeToken<Map<String, Long>>() {}.type
        val BOOLEAN_MAP_TYPE = object : TypeToken<Map<String, Boolean>>() {}.type
        val BOOKMARK_MAP_TYPE = object : TypeToken<Map<String, List<PracticeBookmark>>>() {}.type

        fun isSafePreferenceIdentifier(value: String): Boolean = SAFE_PREFERENCE_ID.matches(value)

        fun distanceBetween(first: Long, second: Long): Long = if (first >= second) first - second else second - first
    }
}
