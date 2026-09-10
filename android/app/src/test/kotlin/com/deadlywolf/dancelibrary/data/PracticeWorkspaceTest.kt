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
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.take
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.io.IOException

class PracticeWorkspaceTest {
    @Test
    fun realWebGeneratedV2FixtureImportsAndExportsLosslessly() = runTest {
        // Fixture produced by the web practice-store.js mergePracticeData implementation.
        val source = requireNotNull(javaClass.getResourceAsStream("/web-v2-workspace.json"))
            .bufferedReader().use { it.readText() }
        val original = JsonParser.parseString(source).asJsonObject
        val repository = PracticeRepository(RecordingDataStore())
        val report = repository.mergeBackup(source, KNOWN_CATALOG)
        assertTrue(report.succeeded)
        assertTrue(report.workspaceItemsChanged > 0)
        val content = repository.exportJson(KNOWN_CATALOG, exportedAtMs = 1800000010000L).content
        val exported = JsonParser.parseString(content).asJsonObject
        assertEquals(original.get("practiceData"), exported.get("practiceData"))
        assertEquals(original.get("futureEnvelope"), exported.get("futureEnvelope"))
        assertEquals(original.get("videoBookmarks"), exported.get("videoBookmarks"))
        assertEquals(0, repository.mergeBackup(source, KNOWN_CATALOG).workspaceItemsChanged)
        // Parent verification runs the web validator and merge against this native output.
        File("build/reports/interoperability/android-v2-workspace.json").apply {
            requireNotNull(parentFile).mkdirs()
            writeText(content)
        }
    }

    @Test
    fun webV2RoundTripPreservesUnknownPathsAndMetadataWithoutCatalogLookup() = runTest {
        val workspaceJson = """{
          "version":1,"queue":["Unknown/One.mp4","Unknown/Two.mp4"],
          "segments":[{"id":"segment","path":"Unknown/One.mp4","title":"Frame","start":1.25,"end":5.5,"speed":0.75,"createdAt":100,"future":{"counts":[1,2,3]}}],
          "completed":{"Unknown/Two.mp4":200},
          "reflections":{"Unknown/One.mp4":{"text":"Line one\nLine two","updatedAt":300,"tags":["frame"]}},
          "futureWorkspace":{"enabled":true},"__proto__":{"literal":"metadata"}
        }"""
        val repository = PracticeRepository(RecordingDataStore())
        val report = repository.mergeBackup("""{"schemaVersion":2,"practiceData":$workspaceJson,"futureEnvelope":{"retain":"me"}}""", EMPTY_CATALOG)
        assertTrue(report.succeeded)
        assertEquals(listOf("Unknown/One.mp4", "Unknown/Two.mp4"), repository.snapshot.first().workspace.queue)
        assertTrue(report.unknownLegacyPaths.isEmpty())
        val exported = JsonParser.parseString(repository.exportJson(EMPTY_CATALOG).content).asJsonObject
        assertEquals(2, exported.get("schemaVersion").asInt)
        assertEquals(JsonParser.parseString(workspaceJson), exported.get("practiceData"))
        assertEquals("me", exported.getAsJsonObject("futureEnvelope").get("retain").asString)
        val restored = PracticeRepository(RecordingDataStore())
        assertTrue(restored.mergeBackup(exported.toString(), EMPTY_CATALOG).succeeded)
        assertEquals(repository.snapshot.first().workspace, restored.snapshot.first().workspace)
    }

    @Test
    fun optionalReflectionsRemainOmittedWhenAbsentAndUnknownDataIsRetained() {
        val original = JsonParser.parseString("""{"version":1,"queue":[],"segments":[],"completed":{},"future":null}""")
        assertEquals(original, PracticeWorkspaceCodec.encode(PracticeWorkspaceCodec.decode(original)))
    }

    @Test
    fun mergeMatchesWebOrderTimestampsAndMetadataPrecedence() {
        val local = workspace("""{"version":1,"queue":["B","A"],"segments":[{"id":"x","path":"A","title":"old","start":1,"end":3,"speed":1,"createdAt":100,"localExtra":true,"shared":"local"}],"completed":{"A":300},"reflections":{"A":{"text":"old","updatedAt":100,"localExtra":true},"B":{"text":"local tie","updatedAt":200}},"shared":"local"}""")
        val incoming = workspace("""{"version":1,"queue":["A","C"],"segments":[{"id":"x","path":"A","title":"new","start":2,"end":4,"speed":0.5,"createdAt":200,"incomingExtra":true,"shared":"incoming"}],"completed":{"A":100,"C":200},"reflections":{"A":{"text":"new","updatedAt":200,"incomingExtra":true},"B":{"text":"incoming tie","updatedAt":200}},"shared":"incoming","incomingOnly":true}""")
        val merged = PracticeWorkspaceCodec.merge(local, incoming)
        assertEquals(listOf("B", "A", "C"), merged.queue)
        assertEquals("new", merged.segments.single().title)
        assertEquals("local", merged.segments.single().extra.get("shared").asString)
        assertTrue(merged.segments.single().extra.get("incomingExtra").asBoolean)
        assertEquals(300L, merged.completed["A"])
        assertEquals("new", merged.reflections.getValue("A").text)
        assertTrue(merged.reflections.getValue("A").extra.get("localExtra").asBoolean)
        assertEquals("local tie", merged.reflections.getValue("B").text)
        assertEquals("local", merged.extra.get("shared").asString)
        assertEquals(merged, PracticeWorkspaceCodec.merge(merged, incoming))
    }

    @Test
    fun futureVersionsAndMalformedExtensionsAreRejectedBeforeAnyWrites() = runTest {
        val store = RecordingDataStore()
        val repository = PracticeRepository(store)
        val empty = PracticeWorkspaceCodec.encode(PracticeWorkspace()).toString()
        for (invalid in listOf(
            """{"schemaVersion":3,"practiceData":$empty}""",
            """{"nativeSchemaVersion":3,"practiceData":$empty}""",
            """{"schemaVersion":"2","practiceData":$empty}""",
            """{"practiceData":{"version":2,"queue":[],"segments":[],"completed":{}}}""",
            """{"favoriteVideos":["Known.mp4"],"practiceData":{"version":1,"queue":["A","A"],"segments":[],"completed":{}}}""",
            """{"practiceData":{"version":1,"queue":[],"segments":[{"id":"x","path":"A","title":"bad","start":2,"end":1,"speed":1,"createdAt":0}],"completed":{}}}""",
        )) assertFalse(invalid, repository.mergeBackup(invalid, EMPTY_CATALOG).succeeded)
        assertEquals(0, store.commits)
    }

    @Test
    fun mergeOverLimitAbortsBothWorkspaceAndLegacyChangesAtomically() = runTest {
        val local = PracticeWorkspace(queue = (0 until 1000).map { "Unknown/$it" })
        val store = RecordingDataStore(mutablePreferencesOf(stringPreferencesKey("practice_workspace_v1") to PracticeWorkspaceCodec.encode(local).toString()))
        val repository = PracticeRepository(store)
        val before = repository.snapshot.first()
        val report = repository.mergeBackup("""{"favoriteVideos":["Known.mp4"],"practiceData":{"version":1,"queue":["Extra"],"segments":[],"completed":{}}}""", KNOWN_CATALOG)
        assertFalse(report.succeeded)
        assertEquals(before, repository.snapshot.first())
        assertEquals(0, store.commits)
    }

    @Test
    fun queueSegmentAndCompletionMutationsPersistUnknownPaths() = runTest {
        val store = RecordingDataStore()
        val repository = PracticeRepository(store, clock = { 100L })
        assertTrue(repository.toggleQueued("Unknown/A"))
        assertTrue(repository.toggleQueued("Unknown/B"))
        assertTrue(repository.moveQueued("Unknown/B", -1))
        assertEquals(listOf("Unknown/B", "Unknown/A"), repository.snapshot.first().workspace.queue)
        assertTrue(repository.removeQueued("Unknown/A"))
        assertTrue(repository.toggleCompleted("Unknown/B"))
        val segment = PracticeSegment("x", "Unknown/B", "Frame", 1.25, 3.0, 0.5, 100)
        assertTrue(repository.saveSegment(segment))
        assertFalse(repository.saveSegment(segment.copy(id = "bad", end = 0.0)))
        val afterReload = PracticeRepository(store).snapshot.first().workspace
        assertEquals(listOf(segment), afterReload.segments)
        assertEquals(100L, afterReload.completed["Unknown/B"])
        assertTrue(repository.deleteSegment("x"))
        assertTrue(repository.toggleCompleted("Unknown/B"))
        assertTrue(repository.snapshot.first().workspace.completed.isEmpty())
    }

    @Test
    fun reflectionDraftsSurviveReloadAndConflictsNeverOverwriteSavedText() = runTest {
        val store = RecordingDataStore()
        val repository = PracticeRepository(store, clock = { 100L })
        assertTrue(repository.saveReflection("Unknown/A", "First", null))
        val first = repository.snapshot.first().workspace.reflections.getValue("Unknown/A")
        assertTrue(repository.saveReflectionDraft("Unknown/A", "Draft from first", first))
        assertEquals("Draft from first", PracticeRepository(store).snapshot.first().reflectionDrafts.getValue("Unknown/A").text)
        assertTrue(repository.saveReflection("Unknown/A", "Other saved change", first))
        assertFalse(repository.saveReflection("Unknown/A", "Draft from first", first))
        assertEquals("Other saved change", repository.snapshot.first().workspace.reflections.getValue("Unknown/A").text)
        assertEquals("Draft from first", repository.snapshot.first().reflectionDrafts.getValue("Unknown/A").text)
        val latest = repository.snapshot.first().workspace.reflections.getValue("Unknown/A")
        val long = "x".repeat(10000)
        assertTrue(repository.saveReflectionDraft("Unknown/A", long, latest))
        assertTrue(repository.saveReflection("Unknown/A", long, latest))
        assertTrue(repository.snapshot.first().reflectionDrafts.isEmpty())
        assertTrue(repository.snapshot.first().workspace.reflections.getValue("Unknown/A").updatedAt > latest.updatedAt)
        assertFalse(repository.saveReflection("Unknown/A", "x".repeat(10001), latest))
    }

    @Test
    fun noteDraftsLongNotesConflictsAndDurableUndoPreserveData() = runTest {
        val store = RecordingDataStore()
        val repository = PracticeRepository(store, clock = { 100L }, bookmarkIdFactory = { "bookmark" })
        val original = repository.addBookmark("lesson", 5000, "x".repeat(2000)).bookmark!!
        assertTrue(repository.saveNoteDraft("lesson", original.id, "Draft", original))
        assertEquals("Draft", PracticeRepository(store).snapshot.first().noteDrafts.getValue(original.id).text)
        assertTrue(repository.updateBookmarkNote("lesson", original.id, "Other edit", original))
        assertFalse(repository.updateBookmarkNote("lesson", original.id, "Draft", original))
        val edited = repository.snapshot.first().bookmarks.getValue("lesson").single()
        assertTrue(edited.updatedAtMs > original.updatedAtMs)
        assertTrue(repository.deleteBookmark("lesson", original.id))
        assertEquals(edited, PracticeRepository(store).snapshot.first().deletedBookmark)
        assertTrue(repository.undoDeleteBookmark())
        assertEquals(edited, repository.snapshot.first().bookmarks.getValue("lesson").single())
        assertNull(repository.snapshot.first().deletedBookmark)
    }

    @Test
    fun addingNoteClearsOnlyItsMatchingDraftInTheSameCommit() = runTest {
        val store = RecordingDataStore()
        val repository = PracticeRepository(store, clock = { 100L }, bookmarkIdFactory = { "saved-note" })
        assertTrue(repository.saveNoteDraft("lesson", "new:lesson:5000", "  Saved note  ", null))
        val commitsBefore = store.commits
        assertTrue(repository.addBookmark("lesson", 5000, "Saved note").succeeded)
        assertEquals(commitsBefore + 1, store.commits)
        assertTrue(PracticeRepository(store).snapshot.first().noteDrafts.isEmpty())
        assertEquals("Saved note", repository.snapshot.first().bookmarks.getValue("lesson").single().note)
    }

    @Test
    fun corruptedBookmarkAndDraftRecordsCannotBeOverwrittenByTheNextSave() = runTest {
        for (raw in listOf("{unfinished", "null", "{\"lesson\":[null]}", "{\"lesson\":false}")) {
            val store = RecordingDataStore(mutablePreferencesOf(stringPreferencesKey("bookmarks") to raw))
            val repository = PracticeRepository(store)
            assertNotNull(repository.snapshot.first().storageReadError)
            assertFalse(repository.addBookmark("lesson", 5000, "New").succeeded)
            assertFalse(repository.updateBookmarkNote("lesson", "old", "New"))
            assertFalse(repository.deleteBookmark("lesson", "old"))
            assertFalse(repository.mergeBackup("{\"favoriteVideos\":[\"Known.mp4\"]}", KNOWN_CATALOG).succeeded)
            assertEquals(0, store.commits)
            assertEquals(raw, store.data.first()[stringPreferencesKey("bookmarks")])
        }
        val store = RecordingDataStore(mutablePreferencesOf(stringPreferencesKey("note_drafts") to "{unfinished"))
        val repository = PracticeRepository(store)
        assertFalse(repository.saveNoteDraft("lesson", "draft", "New", null))
        assertFalse(repository.addBookmark("lesson", 5000, "New").succeeded)
        assertEquals(0, store.commits)
        assertEquals("{unfinished", store.data.first()[stringPreferencesKey("note_drafts")])
    }

    @Test
    fun timestampNotesResetRetainsSeparateReflectionsUntilAllPracticeIsReset() = runTest {
        val repository = PracticeRepository(RecordingDataStore())
        repository.addBookmark("lesson", 5000, "Timestamp note")
        repository.saveReflection("Unknown.mp4", "Lesson reflection", null)
        assertTrue(repository.reset(PracticeReset.BOOKMARKS_AND_NOTES))
        assertTrue(repository.snapshot.first().bookmarks.isEmpty())
        assertEquals("Lesson reflection", repository.snapshot.first().workspace.reflections.getValue("Unknown.mp4").text)
        assertTrue(repository.reset(PracticeReset.ALL_PRACTICE_DATA))
        assertTrue(repository.snapshot.first().workspace.reflections.isEmpty())
    }

    @Test
    fun corruptSavedWorkspaceIsVisibleAsAnErrorAndCannotBeOverwrittenOrExportedAsEmpty() = runTest {
        val raw = "{unfinished original"
        val store = RecordingDataStore(mutablePreferencesOf(stringPreferencesKey("practice_workspace_v1") to raw))
        val repository = PracticeRepository(store)
        assertNotNull(repository.snapshot.first().workspaceReadError)
        assertFalse(repository.toggleQueued("New lesson"))
        assertEquals(raw, store.data.first()[stringPreferencesKey("practice_workspace_v1")])
        try {
            repository.exportJson(EMPTY_CATALOG)
            fail("Corrupt workspace must block complete backup export")
        } catch (_: BackupFormatException) { }
    }

    @Test
    fun unreadableDataStoreCannotMasqueradeAsAnEmptyBackup() = runTest {
        val store = object : DataStore<Preferences> {
            override val data: Flow<Preferences> = flow { throw IOException("Storage unavailable") }
            override suspend fun updateData(transform: suspend (Preferences) -> Preferences): Preferences = throw IOException("Storage unavailable")
        }
        val repository = PracticeRepository(store)
        assertNotNull(repository.snapshot.first().storageReadError)
        assertNotNull(repository.snapshot.first().workspaceReadError)
        assertFalse(repository.toggleQueued("Known.mp4"))
        for (includeWorkspace in listOf(true, false)) {
            try {
                repository.exportJson(EMPTY_CATALOG, PracticeExportOptions(includeWorkspace = includeWorkspace))
                fail("Unreadable storage must block export even if practice data is unchecked")
            } catch (_: BackupFormatException) { }
            try {
                repository.exportMarkdown(EMPTY_CATALOG, PracticeExportOptions(includeWorkspace = includeWorkspace))
                fail("Unreadable storage must block Markdown export")
            } catch (_: BackupFormatException) { }
        }
    }

    @Test
    fun snapshotRecoversAfterStorageBecomesReadable() = runTest {
        var attempts = 0
        val workspace = PracticeWorkspaceCodec.encode(PracticeWorkspace(queue = listOf("Retained.mp4"))).toString()
        val store = object : DataStore<Preferences> {
            override val data: Flow<Preferences> = flow {
                if (attempts++ == 0) throw IOException("Temporary read error")
                emit(mutablePreferencesOf(stringPreferencesKey("practice_workspace_v1") to workspace))
            }
            override suspend fun updateData(transform: suspend (Preferences) -> Preferences): Preferences = error("Not used")
        }
        val snapshots = PracticeRepository(store).snapshot.take(2).toList()
        assertNotNull(snapshots[0].storageReadError)
        assertNull(snapshots[1].storageReadError)
        assertEquals(listOf("Retained.mp4"), snapshots[1].workspace.queue)
    }

    @Test
    fun lessonScopedExportContainsOnlySelectedWorkspacePaths() = runTest {
        val repository = PracticeRepository(RecordingDataStore())
        repository.toggleQueued("Known.mp4"); repository.toggleQueued("Unknown.mp4")
        repository.saveReflection("Known.mp4", "Selected", null)
        repository.saveReflection("Unknown.mp4", "Private other lesson", null)
        val exported = JsonParser.parseString(repository.exportJson(KNOWN_CATALOG, PracticeExportOptions(lessonIds = setOf("known-id"))).content).asJsonObject.getAsJsonObject("practiceData")
        assertEquals(listOf("Known.mp4"), exported.getAsJsonArray("queue").map { it.asString })
        assertFalse(exported.getAsJsonObject("reflections").has("Unknown.mp4"))
    }

    @Test
    fun lessonScopedExportOmitsOpaqueRootMetadataButKeepsSelectedRecordMetadata() = runTest {
        val source = requireNotNull(javaClass.getResourceAsStream("/web-v2-workspace.json"))
            .bufferedReader().use { it.readText() }
        val repository = PracticeRepository(RecordingDataStore())
        assertTrue(repository.mergeBackup(source, KNOWN_CATALOG).succeeded)
        val full = JsonParser.parseString(repository.exportJson(KNOWN_CATALOG).content).asJsonObject
        val scoped = JsonParser.parseString(repository.exportJson(KNOWN_CATALOG, PracticeExportOptions(lessonIds = setOf("known-id"))).content).asJsonObject
        assertTrue(full.has("futureEnvelope"))
        assertTrue(full.getAsJsonObject("practiceData").has("futureWorkspace"))
        assertFalse(scoped.has("futureEnvelope"))
        val workspace = scoped.getAsJsonObject("practiceData")
        assertFalse(workspace.has("futureWorkspace"))
        assertFalse(workspace.has("futureIncoming"))
        assertFalse(workspace.has("__proto__"))
        assertEquals(listOf("Known.mp4"), workspace.getAsJsonArray("queue").map { it.asString })
        assertTrue(workspace.getAsJsonArray("segments").single().asJsonObject.has("localOnly"))
        assertTrue(workspace.getAsJsonObject("reflections").getAsJsonObject("Known.mp4").has("tags"))
        assertFalse(workspace.getAsJsonObject("reflections").has("Unknown/Third.mp4"))
    }

    private fun workspace(json: String) = PracticeWorkspaceCodec.decode(JsonParser.parseString(json))

    private class RecordingDataStore(initial: Preferences = emptyPreferences()) : DataStore<Preferences> {
        private val stored = MutableStateFlow(initial)
        var commits = 0
        override val data: Flow<Preferences> = stored
        override suspend fun updateData(transform: suspend (Preferences) -> Preferences): Preferences {
            val next = transform(stored.value)
            stored.value = next
            commits++
            return next
        }
    }

    companion object {
        private val EMPTY_CATALOG = PracticeBackupCatalog.from(emptyList())
        private val KNOWN_CATALOG = PracticeBackupCatalog.from(listOf(BackupLessonReference("known-id", "Known.mp4", "Known")))
    }
}
