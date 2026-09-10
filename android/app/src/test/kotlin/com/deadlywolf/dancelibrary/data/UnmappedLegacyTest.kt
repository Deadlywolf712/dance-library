package com.deadlywolf.dancelibrary.data

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.emptyPreferences
import androidx.datastore.preferences.core.mutablePreferencesOf
import androidx.datastore.preferences.core.stringPreferencesKey
import com.google.gson.JsonParser
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

class UnmappedLegacyTest {
    @Test
    fun unknownLegacyRecordsRoundTripInTheirOriginalShapeWithoutInventingIds() = runTest {
        val source = """{"favoriteVideos":["Unknown.mp4"],"watchedVideos":["Unknown.mp4"],"videoPositions":{"Unknown.mp4":12.1234567},"videoLastWatched":{"Unknown.mp4":1000},"lastLessonPath":"Unknown.mp4","videoBookmarks":{"Unknown.mp4":[4.125,{"t":12.125,"n":"Line one\nLine two","ts":1234,"future":null,"meta":{"a":1}}],"__proto__":[{"t":1,"n":"Literal catalog path"}]}}"""
        val store = MemoryStore()
        val repository = PracticeRepository(store)
        val report = repository.mergeBackup(source, EMPTY)
        assertTrue(report.succeeded)
        assertEquals(setOf("Unknown.mp4", "__proto__"), report.unknownLegacyPaths)
        val snapshot = repository.snapshot.first()
        assertTrue(snapshot.bookmarks.isEmpty())
        assertTrue(snapshot.favorites.isEmpty())
        val exported = JsonParser.parseString(PracticeRepository(store).exportJson(EMPTY).content).asJsonObject
        JsonParser.parseString(source).asJsonObject.entrySet().forEach { (key, value) -> assertEquals(key, value, exported.get(key)) }
    }

    @Test
    fun retainedConflictsUseSameNoteWindowNewestTextAndLocalMetadataRules() = runTest {
        val local = UnmappedLegacyCodec.read("""{"favoriteVideos":["B","A"],"videoPositions":{"A":10},"videoBookmarks":{"A":[{"t":10.1,"n":"old","ts":100,"local":true,"shared":"local"},20]}}""")
        val incoming = UnmappedLegacyCodec.read("""{"favoriteVideos":["A","C"],"videoPositions":{"A":5,"C":15},"videoBookmarks":{"A":[{"t":10.5,"n":"new","ts":200,"incoming":null,"shared":"incoming"},{"t":20.25,"n":"Filled","ts":50}]}}""")
        val merged = UnmappedLegacyCodec.merge(local, incoming)
        assertEquals(listOf("B", "A", "C"), merged.getAsJsonArray("favoriteVideos").map { it.asString })
        assertEquals(10.0, merged.getAsJsonObject("videoPositions").get("A").asDouble, 0.0)
        val notes = merged.getAsJsonObject("videoBookmarks").getAsJsonArray("A")
        assertEquals(2, notes.size())
        val note = notes[0].asJsonObject
        assertEquals(10.1, note.get("t").asDouble, 0.0)
        assertEquals("new", note.get("n").asString)
        assertEquals("local", note.get("shared").asString)
        assertTrue(note.has("incoming"))
        assertTrue(note.get("incoming").isJsonNull)
        assertEquals("Filled", notes[1].asJsonObject.get("n").asString)
        assertEquals(20.0, notes[1].asJsonObject.get("t").asDouble, 0.0)
        assertEquals(merged, UnmappedLegacyCodec.merge(merged, incoming))
        val emptyNewer = UnmappedLegacyCodec.read("""{"videoBookmarks":{"A":[{"t":10.5,"n":"","ts":300}]}}""")
        assertEquals("new", UnmappedLegacyCodec.merge(merged, emptyNewer).getAsJsonObject("videoBookmarks").getAsJsonArray("A")[0].asJsonObject.get("n").asString)
    }

    @Test
    fun malformedUnknownBookmarkAbortsTheWholeImportBeforeWrites() = runTest {
        for (bad in listOf("null", "false", "{\"t\":-1}", "{\"t\":1,\"n\":false}", "{\"t\":1,\"ts\":-1}")) {
            val store = MemoryStore()
            val repository = PracticeRepository(store)
            val report = repository.mergeBackup("""{"favoriteVideos":["Known.mp4"],"videoBookmarks":{"Unknown.mp4":[$bad]}}""", KNOWN)
            assertFalse(report.succeeded)
            assertEquals(0, store.commits)
            assertTrue(repository.snapshot.first().favorites.isEmpty())
        }
    }

    @Test
    fun scopedAndCategoryExportsAndResetsRespectRetainedLegacyData() = runTest {
        val repository = PracticeRepository(MemoryStore())
        val source = """{"favoriteVideos":["Unknown.mp4"],"watchedVideos":["Unknown.mp4"],"videoPositions":{"Unknown.mp4":12},"videoBookmarks":{"Unknown.mp4":[{"t":5,"n":"private"}]}}"""
        assertTrue(repository.mergeBackup(source, KNOWN).succeeded)
        val scoped = JsonParser.parseString(repository.exportJson(KNOWN, PracticeExportOptions(lessonIds = setOf("known"))).content).asJsonObject
        assertFalse(scoped.getAsJsonObject("videoBookmarks").has("Unknown.mp4"))
        assertEquals(0, scoped.getAsJsonArray("favoriteVideos").size())
        val filtered = JsonParser.parseString(repository.exportJson(KNOWN, PracticeExportOptions(includeBookmarks = false, includeFavorites = false, includeWatchHistory = false)).content).asJsonObject
        assertFalse(filtered.has("videoBookmarks"))
        assertFalse(filtered.has("favoriteVideos"))
        assertFalse(filtered.has("watchedVideos"))
        assertTrue(repository.reset(PracticeReset.BOOKMARKS_AND_NOTES))
        var full = JsonParser.parseString(repository.exportJson(KNOWN).content).asJsonObject
        assertFalse(full.getAsJsonObject("videoBookmarks").has("Unknown.mp4"))
        assertEquals(1, full.getAsJsonArray("favoriteVideos").size())
        assertTrue(repository.reset(PracticeReset.WATCH_HISTORY))
        full = JsonParser.parseString(repository.exportJson(KNOWN).content).asJsonObject
        assertEquals(0, full.getAsJsonArray("watchedVideos").size())
        assertEquals(0, full.getAsJsonObject("videoPositions").size())
        assertTrue(repository.reset(PracticeReset.FAVORITES))
        assertEquals(0, JsonParser.parseString(repository.exportJson(KNOWN).content).asJsonObject.getAsJsonArray("favoriteVideos").size())
    }

    @Test
    fun retainedLegacyDataCanBeImportedWhenItsCatalogPathBecomesAvailable() = runTest {
        val source = PracticeRepository(MemoryStore())
        assertTrue(source.mergeBackup("""{"videoBookmarks":{"Known.mp4":[{"t":5,"n":"Previously unavailable","ts":1000}]}}""", EMPTY).succeeded)
        val destination = PracticeRepository(MemoryStore())
        val report = destination.mergeBackup(source.exportJson(KNOWN).content, KNOWN)
        assertTrue(report.succeeded)
        assertTrue(report.unknownLegacyPaths.isEmpty())
        assertEquals("Previously unavailable", destination.snapshot.first().bookmarks.getValue("known").single().note)
    }

    @Test
    fun sameInstallationPromotionCannotResurrectClearedDeletedOrUnfavoritedData() = runTest {
        val store = MemoryStore()
        val repository = PracticeRepository(store, clock = { 2000L })
        val original = """{"favoriteVideos":["Known.mp4"],"watchedVideos":["Known.mp4"],"videoPositions":{"Known.mp4":12},"videoLastWatched":{"Known.mp4":1000},"lastLessonPath":"Known.mp4","videoBookmarks":{"Known.mp4":[{"t":5,"n":"Old note","ts":1000,"future":null,"meta":{"preserve":true}}]}}"""
        assertTrue(repository.mergeBackup(original, EMPTY).succeeded)
        assertTrue(repository.mergeBackup(repository.exportJson(KNOWN).content, KNOWN).succeeded)
        assertEquals(0, repository.snapshot.first().unmappedLegacy.size())
        val promoted = repository.snapshot.first().bookmarks.getValue("known").single()
        assertTrue(requireNotNull(promoted.extra).get("future").isJsonNull)
        assertTrue(repository.updateBookmarkNote("known", promoted.id, "", promoted))
        val cleared = JsonParser.parseString(repository.exportJson(KNOWN).content).asJsonObject.getAsJsonObject("videoBookmarks").getAsJsonArray("Known.mp4")
        assertEquals(1, cleared.size())
        assertEquals("", cleared[0].asJsonObject.get("n").asString)
        assertTrue(cleared[0].asJsonObject.get("future").isJsonNull)
        assertTrue(repository.deleteBookmark("known", promoted.id))
        assertTrue(repository.toggleFavorite("known"))
        assertTrue(repository.setWatched("known", false))
        assertTrue(repository.savePlayback("known", 0, 0))
        val afterReload = PracticeRepository(store)
        val exported = JsonParser.parseString(afterReload.exportJson(KNOWN).content).asJsonObject
        assertFalse(exported.getAsJsonObject("videoBookmarks").has("Known.mp4"))
        assertEquals(0, exported.getAsJsonArray("favoriteVideos").size())
        assertEquals(0, exported.getAsJsonArray("watchedVideos").size())
        assertEquals(0, exported.getAsJsonObject("videoPositions").size())
        assertTrue(afterReload.reset(PracticeReset.ALL_PRACTICE_DATA))
        assertEquals(0, afterReload.snapshot.first().unmappedLegacy.size())
    }

    @Test
    fun partialPromotionImportsAllTouchedPathOriginalsAndLeavesUntouchedCategoriesRetained() = runTest {
        val repository = PracticeRepository(MemoryStore())
        assertTrue(repository.mergeBackup("""{"favoriteVideos":["Known.mp4"],"videoBookmarks":{"Known.mp4":[{"t":5,"n":"Retained first","ts":1000}]}}""", EMPTY).succeeded)
        assertTrue(repository.mergeBackup("""{"favoriteVideos":["Known.mp4"]}""", KNOWN).succeeded)
        assertTrue(repository.snapshot.first().unmappedLegacy.has("videoBookmarks"))
        assertFalse(repository.snapshot.first().unmappedLegacy.has("favoriteVideos"))
        assertTrue(repository.mergeBackup("""{"videoBookmarks":{"Known.mp4":[{"t":15,"n":"Incoming second","ts":2000}]}}""", KNOWN).succeeded)
        assertEquals(listOf("Retained first", "Incoming second"), repository.snapshot.first().bookmarks.getValue("known").map { it.note })
        assertFalse(repository.snapshot.first().unmappedLegacy.has("videoBookmarks"))
        val exported = JsonParser.parseString(repository.exportJson(KNOWN).content).asJsonObject.getAsJsonObject("videoBookmarks").getAsJsonArray("Known.mp4")
        assertEquals(2, exported.size())
    }

    @Test
    fun markdownIncludesRetainedTimestampNotesAndHonorsScopeAndCategory() = runTest {
        val repository = PracticeRepository(MemoryStore())
        assertTrue(repository.mergeBackup("""{"videoBookmarks":{"Unknown.mp4":[5,{"t":65,"n":"First line\nSecond line"}]}}""", EMPTY).succeeded)
        val full = repository.exportMarkdown(KNOWN).content
        assertTrue(full.contains("Notes for lessons outside this catalog"))
        assertTrue(full.contains("Unknown\\.mp4"))
        assertTrue(full.contains("[0:05]"))
        assertTrue(full.contains("[1:05]"))
        assertTrue(full.contains("First line\n  Second line"))
        assertFalse(repository.exportMarkdown(KNOWN, PracticeExportOptions(includeBookmarks = false)).content.contains("First line"))
        assertFalse(repository.exportMarkdown(KNOWN, PracticeExportOptions(lessonIds = setOf("known"))).content.contains("First line"))
    }

    @Test
    fun legacyStoredBookmarksWithoutExtrasRemainReadableAndImportedMetadataSurvivesEditsAndUndo() = runTest {
        val raw = """{"known":[{"id":"old-native-id","lessonId":"known","positionMs":5000,"note":"Old native note","createdAtMs":1000,"updatedAtMs":1000}]}"""
        val store = MemoryStore(mutablePreferencesOf(stringPreferencesKey("bookmarks") to raw))
        val repository = PracticeRepository(store, clock = { 3000L })
        assertNull(repository.snapshot.first().storageReadError)
        assertNull(repository.snapshot.first().bookmarks.getValue("known").single().extra)
        assertTrue(repository.mergeBackup("""{"videoBookmarks":{"Known.mp4":[{"t":5,"n":"Imported","ts":2000,"future":null,"shared":"first"}]}}""", KNOWN).succeeded)
        assertTrue(repository.mergeBackup("""{"videoBookmarks":{"Known.mp4":[{"t":5,"n":"Newest","ts":2500,"newExtra":true,"shared":"second"}]}}""", KNOWN).succeeded)
        val current = repository.snapshot.first().bookmarks.getValue("known").single()
        assertEquals("old-native-id", current.id)
        assertEquals("first", requireNotNull(current.extra).get("shared").asString)
        assertTrue(repository.updateBookmarkNote("known", current.id, "User edit", current))
        assertTrue(repository.deleteBookmark("known", current.id))
        assertTrue(PracticeRepository(store).undoDeleteBookmark())
        val exported = JsonParser.parseString(repository.exportJson(KNOWN).content).asJsonObject.getAsJsonObject("videoBookmarks").getAsJsonArray("Known.mp4")[0].asJsonObject
        assertEquals("User edit", exported.get("n").asString)
        assertTrue(exported.get("future").isJsonNull)
        assertTrue(exported.get("newExtra").asBoolean)
        assertEquals("first", exported.get("shared").asString)
    }

    @Test
    fun bookmarkMetadataAbsentNullAndObjectSurviveStrictReadsDraftsAndUndo() = runTest {
        for (metadata in listOf("", ",\"extra\":null", ",\"extra\":{\"future\":null,\"nested\":{\"unset\":null}}")) {
            val raw = """{"known":[{"id":"native","lessonId":"known","positionMs":5000,"note":"Original","createdAtMs":1000,"updatedAtMs":1000$metadata}]}"""
            val store = MemoryStore(mutablePreferencesOf(stringPreferencesKey("bookmarks") to raw))
            val repository = PracticeRepository(store, clock = { 2000L })
            val snapshot = repository.snapshot.first()
            assertNull(metadata, snapshot.storageReadError)
            val original = snapshot.bookmarks.getValue("known").single()
            assertTrue(repository.saveNoteDraft("known", original.id, "New note", original))
            assertEquals(original, PracticeRepository(store).snapshot.first().noteDrafts.getValue(original.id).expected)
            assertTrue(repository.updateBookmarkNote("known", original.id, "New note", original))
            assertTrue(repository.deleteBookmark("known", original.id))
            val afterReload = PracticeRepository(store)
            assertNotNull(afterReload.snapshot.first().deletedBookmark)
            assertTrue(afterReload.undoDeleteBookmark())
            val restored = afterReload.snapshot.first().bookmarks.getValue("known").single()
            assertEquals("New note", restored.note)
            assertEquals(original.extra, restored.extra)
            val exported = JsonParser.parseString(afterReload.exportJson(KNOWN).content).asJsonObject.getAsJsonObject("videoBookmarks").getAsJsonArray("Known.mp4")[0].asJsonObject
            if (original.extra != null) {
                assertTrue(exported.get("future").isJsonNull)
                assertTrue(exported.getAsJsonObject("nested").get("unset").isJsonNull)
            }
        }
    }

    @Test
    fun bookmarkMetadataOtherShapesRemainInvalidAndCannotBeOverwritten() = runTest {
        for (metadata in listOf("[]", "false", "\"wrong\"")) {
            val raw = """{"known":[{"id":"native","lessonId":"known","positionMs":5000,"note":"Original","createdAtMs":1000,"updatedAtMs":1000,"extra":$metadata}]}"""
            val store = MemoryStore(mutablePreferencesOf(stringPreferencesKey("bookmarks") to raw))
            val repository = PracticeRepository(store)
            assertNotNull(repository.snapshot.first().storageReadError)
            assertFalse(repository.addBookmark("known", 15000, "New").succeeded)
            assertEquals(0, store.commits)
            assertEquals(raw, store.data.first()[stringPreferencesKey("bookmarks")])
        }
    }

    @Test
    fun corruptRetainedStorageCannotBeSilentlyReplacedOrExported() = runTest {
        val raw = "{unfinished original"
        val store = MemoryStore(mutablePreferencesOf(stringPreferencesKey("unmapped_legacy") to raw))
        val repository = PracticeRepository(store)
        assertNotNull(repository.snapshot.first().storageReadError)
        assertFalse(repository.mergeBackup("{\"favoriteVideos\":[\"Known.mp4\"]}", KNOWN).succeeded)
        assertEquals(0, store.commits)
        assertEquals(raw, store.data.first()[stringPreferencesKey("unmapped_legacy")])
        try {
            repository.exportJson(KNOWN)
            fail("Corrupted retained data must block a misleading complete backup")
        } catch (_: BackupFormatException) { }
    }

    private class MemoryStore(initial: Preferences = emptyPreferences()) : DataStore<Preferences> {
        private val state = MutableStateFlow(initial)
        var commits = 0
        override val data: Flow<Preferences> = state
        override suspend fun updateData(transform: suspend (Preferences) -> Preferences): Preferences {
            val next = transform(state.value)
            state.value = next
            commits++
            return next
        }
    }

    companion object {
        private val EMPTY = PracticeBackupCatalog.from(emptyList())
        private val KNOWN = PracticeBackupCatalog.from(listOf(BackupLessonReference("known", "Known.mp4", "Known")))
    }
}
