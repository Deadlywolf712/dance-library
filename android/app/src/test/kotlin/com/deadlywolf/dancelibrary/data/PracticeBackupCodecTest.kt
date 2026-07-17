package com.deadlywolf.dancelibrary.data

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.emptyPreferences
import com.google.gson.JsonParser
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PracticeBackupCodecTest {
    @Test
    fun webBackupMergesByLegacyPathWithUnitConversionAndRichDuplicateResolution() = runTest {
        var nextId = 0
        val repository = PracticeRepository(
            dataStore = RecordingDataStore(),
            clock = { 1_000L },
            bookmarkIdFactory = { "bookmark-${++nextId}" },
        )
        repository.toggleFavorite(LESSON_ONE)
        repository.savePlayback(LESSON_ONE, 20_000L, 60_000L)
        repository.addBookmark(LESSON_ONE, 10_000L, "")

        val backup = """
            {
              "exportedAt": "2026-07-17T12:00:00.000Z",
              "favoriteVideos": ["$PATH_TWO"],
              "watchedVideos": ["$PATH_ONE", "$PATH_TWO", "Missing/video.mp4"],
              "videoPositions": {"$PATH_ONE": 15, "$PATH_TWO": 30},
              "videoLastWatched": {"$PATH_ONE": 5000, "$PATH_TWO": 6000},
              "videoBookmarks": {
                "$PATH_ONE": [
                  {"t": 10.5, "n": "Imported richer note", "ts": 2000},
                  20
                ],
                "Missing/video.mp4": [{"t": 5, "n": "ignored"}]
              },
              "theme": "night-owl",
              "favoriteThemes": ["night-owl"],
              "collapsedSections": {"favorites": true},
              "notesBadgeSeen": 1,
              "bunnyPullZone": "https://custom.b-cdn.net/",
              "lastLessonPath": "$PATH_TWO"
            }
        """.trimIndent()

        val report = repository.mergeBackup(backup, CATALOG)
        val snapshot = repository.snapshot.first()

        assertTrue(report.succeeded)
        assertEquals(1, report.favoritesAdded)
        assertEquals(2, report.watchedAdded)
        assertEquals(1, report.positionsAddedOrUpdated)
        assertEquals(2, report.historyAddedOrUpdated)
        assertEquals(1, report.bookmarksAdded)
        assertEquals(1, report.bookmarksUpdated)
        assertEquals(5, report.settingsUpdated)
        assertEquals(setOf("Missing/video.mp4"), report.unknownLegacyPaths)
        assertEquals(setOf(LESSON_ONE, LESSON_TWO), snapshot.favorites)
        assertEquals(20_000L, snapshot.positionsMs[LESSON_ONE])
        assertEquals(30_000L, snapshot.positionsMs[LESSON_TWO])
        assertEquals("Imported richer note", snapshot.bookmarks.getValue(LESSON_ONE).first().note)
        assertEquals(listOf(10_000L, 20_000L), snapshot.bookmarks.getValue(LESSON_ONE).map { it.positionMs })
        assertEquals("night-owl", snapshot.themeId)
        assertEquals("custom.b-cdn.net", snapshot.pullZoneOverride)
        assertEquals(LESSON_TWO, snapshot.lastLessonId)
    }

    @Test
    fun invalidBackupIsRejectedAtomically() = runTest {
        val repository = PracticeRepository(RecordingDataStore())
        repository.toggleFavorite(LESSON_ONE)
        val before = repository.snapshot.first()
        val invalid = """
            {"videoBookmarks":{"$PATH_ONE":[{"t":5,"n":"${"x".repeat(MAX_IMPORTED_NOTE_LENGTH + 1)}"}]}}
        """.trimIndent()

        val report = repository.mergeBackup(invalid, CATALOG)

        assertFalse(report.succeeded)
        assertTrue(report.message.orEmpty().contains("exceeds"))
        assertEquals(before, repository.snapshot.first())
    }

    @Test
    fun jsonExportUsesWebKeysPathsAndSecondsAndRoundTrips() = runTest {
        var nextId = 0
        val source = PracticeRepository(
            dataStore = RecordingDataStore(),
            clock = { EXPORTED_AT },
            bookmarkIdFactory = { "source-${++nextId}" },
        )
        source.toggleFavorite(LESSON_ONE)
        source.markOpened(LESSON_ONE, 8_000L)
        source.savePlayback(LESSON_ONE, 12_500L, 60_000L)
        source.addBookmark(LESSON_ONE, 7_500L, "Frame & timing")
        source.setTheme("arctic")

        val exported = source.exportJson(
            CATALOG,
            options = PracticeExportOptions(includeSummaries = true),
            exportedAtMs = EXPORTED_AT,
        )
        val root = JsonParser.parseString(exported.content).asJsonObject

        assertEquals(PATH_ONE, root.getAsJsonArray("favoriteVideos").first().asString)
        assertEquals(12.5, root.getAsJsonObject("videoPositions").get(PATH_ONE).asDouble, 0.0)
        assertEquals(7.5, root.getAsJsonObject("videoBookmarks").getAsJsonArray(PATH_ONE).first().asJsonObject.get("t").asDouble, 0.0)
        assertEquals("Frame & timing", root.getAsJsonObject("videoBookmarks").getAsJsonArray(PATH_ONE).first().asJsonObject.get("n").asString)
        assertEquals("Lesson one analysis", root.getAsJsonObject("summaries").get(PATH_ONE).asString)

        val restored = PracticeRepository(
            dataStore = RecordingDataStore(),
            clock = { EXPORTED_AT },
            bookmarkIdFactory = { "restored" },
        )
        val report = restored.mergeBackup(exported.content, CATALOG)
        val snapshot = restored.snapshot.first()
        assertTrue(report.succeeded)
        assertTrue(LESSON_ONE in snapshot.favorites)
        assertTrue(LESSON_ONE in snapshot.watched)
        assertEquals(12_500L, snapshot.positionsMs[LESSON_ONE])
        assertEquals("Frame & timing", snapshot.bookmarks.getValue(LESSON_ONE).single().note)

        val repeated = restored.mergeBackup(exported.content, CATALOG)
        assertTrue(repeated.succeeded)
        assertEquals(0, repeated.bookmarksAdded)
        assertEquals(1, repeated.duplicateBookmarksSkipped)
        assertEquals(1, restored.snapshot.first().bookmarks.getValue(LESSON_ONE).size)
    }

    @Test
    fun markdownExportContainsFavoritesBookmarksAndChronologicalHistory() = runTest {
        var nextId = 0
        val repository = PracticeRepository(
            dataStore = RecordingDataStore(),
            clock = { EXPORTED_AT },
            bookmarkIdFactory = { "bookmark-${++nextId}" },
        )
        repository.toggleFavorite(LESSON_ONE)
        repository.markOpened(LESSON_ONE, 8_000L)
        repository.markOpened(LESSON_TWO, 9_000L)
        repository.addBookmark(LESSON_ONE, 65_000L, "Keep frame")

        val markdown = repository.exportMarkdown(
            CATALOG,
            options = PracticeExportOptions(includeSummaries = true),
            exportedAtMs = EXPORTED_AT,
        ).content

        assertTrue(markdown.contains("## Favorites"))
        assertTrue(markdown.contains("## Bookmarks & Notes"))
        assertTrue(markdown.contains("**[1:05]** Keep frame"))
        assertTrue(markdown.contains("## Watch History"))
        assertTrue(markdown.contains("## Video Summaries"))
        assertTrue(markdown.contains("Lesson one analysis"))
        assertTrue(markdown.indexOf("Lesson Two") < markdown.lastIndexOf("Lesson One"))
    }

    @Test
    fun importIgnoresUnknownThemesAndKeepsNewerLocalLastLesson() = runTest {
        val repository = PracticeRepository(RecordingDataStore(), clock = { 10_000L })
        repository.markOpened(LESSON_ONE, 10_000L)
        val backup = """
            {
              "watchedVideos": ["$PATH_TWO"],
              "videoLastWatched": {"$PATH_TWO": 5000},
              "lastLessonPath": "$PATH_TWO",
              "theme": "unknown-theme",
              "favoriteThemes": ["unknown-theme"]
            }
        """.trimIndent()

        val report = repository.mergeBackup(backup, CATALOG)
        val snapshot = repository.snapshot.first()

        assertTrue(report.succeeded)
        assertEquals(LESSON_ONE, snapshot.lastLessonId)
        assertEquals(DEFAULT_THEME_ID, snapshot.themeId)
        assertTrue(snapshot.favoriteThemes.isEmpty())
    }

    private class RecordingDataStore(initial: Preferences = emptyPreferences()) : DataStore<Preferences> {
        private val stored = MutableStateFlow(initial)
        override val data: Flow<Preferences> = stored

        override suspend fun updateData(transform: suspend (Preferences) -> Preferences): Preferences {
            val next = transform(stored.value)
            stored.value = next
            return next
        }
    }

    private companion object {
        const val LESSON_ONE = "9b0a1d6a-da85-4a75-92f8-8cc8d62abe96"
        const val LESSON_TWO = "8a5f23e4-bf47-4e54-9493-ce64b0982575"
        const val PATH_ONE = "Salsa/Course/Lesson One.mp4"
        const val PATH_TWO = "Bachata/Course/Lesson Two.mp4"
        const val EXPORTED_AT = 1_721_234_567_890L
        val CATALOG = PracticeBackupCatalog.from(
            listOf(
                BackupLessonReference(LESSON_ONE, PATH_ONE, "Lesson One", "Lesson one analysis"),
                BackupLessonReference(LESSON_TWO, PATH_TWO, "Lesson Two", "Lesson two analysis"),
            ),
            knownThemeIds = setOf("arctic", "night-owl"),
        )
    }
}
