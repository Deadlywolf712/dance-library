package com.deadlywolf.dancelibrary.data

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.emptyPreferences
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.mutablePreferencesOf
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.core.stringSetPreferencesKey
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException

class PracticeRepositoryTest {
    @Test
    fun writeIoFailuresDoNotEscapeAnyPersistenceOperation() = runTest {
        val dataStore = FailingDataStore()
        val repository = PracticeRepository(dataStore)

        repository.toggleFavorite(LESSON_ID)
        repository.savePlayback(LESSON_ID, positionMs = 10_000, durationMs = 60_000)
        repository.setWatched(LESSON_ID, watched = true)

        assertEquals(3, dataStore.updateAttempts)
    }

    @Test
    fun bookmarkWriteFailureIsReportedToCaller() = runTest {
        val result = PracticeRepository(FailingDataStore()).addBookmark(LESSON_ID, 10_000L)

        assertEquals(BookmarkAddStatus.PERSISTENCE_FAILED, result.status)
        assertFalse(result.succeeded)
    }

    @Test
    fun identicalPlaybackProgressDoesNotCreateAnotherChangedWrite() = runTest {
        val dataStore = RecordingDataStore()
        val repository = PracticeRepository(dataStore)

        repository.savePlayback(LESSON_ID, positionMs = 10_000, durationMs = 60_000)
        repository.savePlayback(LESSON_ID, positionMs = 10_000, durationMs = 60_000)

        assertEquals(1, dataStore.changedWrites)
    }

    @Test
    fun openingLessonMarksWatchedAndKeepsResumeIndependent() = runTest {
        val dataStore = RecordingDataStore()
        val repository = PracticeRepository(dataStore, clock = { OPENED_AT })

        repository.savePlayback(LESSON_ID, positionMs = 10_000, durationMs = 60_000)
        repository.markOpened(LESSON_ID)

        val snapshot = repository.snapshot.first()
        assertTrue(LESSON_ID in snapshot.watched)
        assertEquals(10_000L, snapshot.positionsMs[LESSON_ID])
        assertEquals(OPENED_AT, snapshot.lastWatchedAtMs[LESSON_ID])
        assertEquals(LESSON_ID, snapshot.lastLessonId)
    }

    @Test
    fun watchedLessonContinuesSavingResumeUntilPlaybackCompletes() = runTest {
        val dataStore = RecordingDataStore()
        val repository = PracticeRepository(dataStore)

        repository.markOpened(LESSON_ID)
        repository.savePlayback(LESSON_ID, positionMs = 30_000, durationMs = 60_000)

        assertEquals(30_000L, repository.snapshot.first().positionsMs[LESSON_ID])

        repository.savePlayback(LESSON_ID, positionMs = 54_000, durationMs = 60_000)
        assertEquals(54_000L, repository.snapshot.first().positionsMs[LESSON_ID])

        repository.savePlayback(LESSON_ID, positionMs = 55_000, durationMs = 60_000)
        assertNull(repository.snapshot.first().positionsMs[LESSON_ID])
    }

    @Test
    fun bookmarkCrudEnforcesUiLimitAndOneSecondDuplicateWindow() = runTest {
        var now = OPENED_AT
        var nextId = 0
        val repository = PracticeRepository(
            dataStore = RecordingDataStore(),
            clock = { now++ },
            bookmarkIdFactory = { "bookmark-${++nextId}" },
        )

        val first = repository.addBookmark(LESSON_ID, 10_000L, "  First note  ")
        val duplicate = repository.addBookmark(LESSON_ID, 10_999L)
        val boundary = repository.addBookmark(LESSON_ID, 11_000L)
        val tooLong = repository.addBookmark(LESSON_ID, 20_000L, "x".repeat(MAX_UI_NOTE_LENGTH + 1))

        assertEquals(BookmarkAddStatus.ADDED, first.status)
        assertEquals("First note", first.bookmark?.note)
        assertEquals(BookmarkAddStatus.DUPLICATE, duplicate.status)
        assertEquals(BookmarkAddStatus.ADDED, boundary.status)
        assertEquals(BookmarkAddStatus.INVALID, tooLong.status)

        assertTrue(repository.updateBookmarkNote(LESSON_ID, "bookmark-1", "  Updated  "))
        assertFalse(repository.updateBookmarkNote(LESSON_ID, "bookmark-1", "x".repeat(MAX_IMPORTED_NOTE_LENGTH + 1)))
        assertEquals("Updated", repository.snapshot.first().bookmarks.getValue(LESSON_ID).first().note)
        assertTrue(repository.deleteBookmark(LESSON_ID, "bookmark-1"))
        assertEquals(listOf("bookmark-2"), repository.snapshot.first().bookmarks.getValue(LESSON_ID).map { it.id })
    }

    @Test
    fun granularResetMatchesWebsiteWatchHistoryBehavior() = runTest {
        val repository = PracticeRepository(RecordingDataStore(), bookmarkIdFactory = { "bookmark" })
        repository.toggleFavorite(LESSON_ID)
        repository.markOpened(LESSON_ID, OPENED_AT)
        repository.savePlayback(LESSON_ID, 10_000L, 60_000L)
        repository.addBookmark(LESSON_ID, 10_000L, "note")

        repository.reset(PracticeReset.WATCH_HISTORY)
        val afterHistoryReset = repository.snapshot.first()
        assertTrue(afterHistoryReset.watched.isEmpty())
        assertTrue(afterHistoryReset.lastWatchedAtMs.isEmpty())
        assertTrue(afterHistoryReset.positionsMs.isEmpty())
        assertTrue(LESSON_ID in afterHistoryReset.favorites)
        assertTrue(afterHistoryReset.bookmarks.isNotEmpty())

        repository.reset(PracticeReset.ALL_PRACTICE_DATA)
        val reset = repository.snapshot.first()
        assertTrue(reset.favorites.isEmpty())
        assertTrue(reset.bookmarks.isEmpty())
        assertEquals(DEFAULT_THEME_ID, reset.themeId)
    }

    @Test
    fun settingsAndNotesBadgePersistAndClampAfterDeletion() = runTest {
        var id = 0
        val repository = PracticeRepository(RecordingDataStore(), bookmarkIdFactory = { "bookmark-${++id}" })
        repository.addBookmark(LESSON_ID, 10_000L)
        repository.markNotesSeen()
        repository.addBookmark(LESSON_ID, 12_000L)
        repository.setTheme("night-owl")
        repository.toggleFavoriteTheme("night-owl")
        repository.setSectionCollapsed("favorites", true)
        repository.setPullZoneOverride("https://example.b-cdn.net/")

        var snapshot = repository.snapshot.first()
        assertEquals(1L, snapshot.unseenBookmarkCount)
        assertEquals("night-owl", snapshot.themeId)
        assertTrue("night-owl" in snapshot.favoriteThemes)
        assertEquals(true, snapshot.collapsedSections["favorites"])
        assertEquals("example.b-cdn.net", snapshot.pullZoneOverride)

        repository.deleteBookmark(LESSON_ID, "bookmark-1")
        snapshot = repository.snapshot.first()
        assertEquals(0L, snapshot.unseenBookmarkCount)
        assertFalse(repository.setPullZoneOverride("https://example.com/path"))

        repository.reset(PracticeReset.EVERYTHING)
        snapshot = repository.snapshot.first()
        assertTrue(snapshot.bookmarks.isEmpty())
        assertEquals("night-owl", snapshot.themeId)
        assertTrue("night-owl" in snapshot.favoriteThemes)
        assertEquals("example.b-cdn.net", snapshot.pullZoneOverride)
    }

    @Test
    fun legacyPreferencesDecodeWithoutLosingExistingPracticeData() = runTest {
        val legacy = mutablePreferencesOf(
            stringSetPreferencesKey("favorite_lesson_ids") to setOf(LESSON_ID),
            stringSetPreferencesKey("watched_lesson_ids") to setOf(LESSON_ID),
            stringPreferencesKey("playback_positions_ms") to "{\"$LESSON_ID\":10000}",
            stringPreferencesKey("last_lesson_id") to LESSON_ID,
            longPreferencesKey("last_saved_at") to OPENED_AT,
            stringPreferencesKey("collapsed_sections") to
                "{\"home_favorites\":true,\"home_continue\":false,\"home_notes\":true}",
        )
        val repository = PracticeRepository(RecordingDataStore(legacy))

        val snapshot = repository.snapshot.first()
        assertTrue(LESSON_ID in snapshot.favorites)
        assertTrue(LESSON_ID in snapshot.watched)
        assertEquals(10_000L, snapshot.positionsMs[LESSON_ID])
        assertEquals(LESSON_ID, snapshot.lastLessonId)
        assertEquals(DEFAULT_THEME_ID, snapshot.themeId)
        assertEquals(
            mapOf("favorites" to true, "continue-watching" to false, "recent-notes" to true),
            snapshot.collapsedSections,
        )
    }

    private class FailingDataStore : DataStore<Preferences> {
        override val data: Flow<Preferences> = flowOf(emptyPreferences())
        var updateAttempts: Int = 0
            private set

        override suspend fun updateData(transform: suspend (Preferences) -> Preferences): Preferences {
            updateAttempts += 1
            throw IOException("Simulated persistence failure")
        }
    }

    private class RecordingDataStore(initial: Preferences = emptyPreferences()) : DataStore<Preferences> {
        private val stored = MutableStateFlow(initial)
        override val data: Flow<Preferences> = stored
        var changedWrites: Int = 0
            private set

        override suspend fun updateData(transform: suspend (Preferences) -> Preferences): Preferences {
            val next = transform(stored.value)
            if (next != stored.value) changedWrites += 1
            stored.value = next
            return next
        }
    }

    private companion object {
        const val LESSON_ID = "9b0a1d6a-da85-4a75-92f8-8cc8d62abe96"
        const val OPENED_AT = 1_721_234_567_890L
    }
}
