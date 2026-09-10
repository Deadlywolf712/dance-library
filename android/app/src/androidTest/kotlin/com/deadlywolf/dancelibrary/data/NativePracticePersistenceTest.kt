package com.deadlywolf.dancelibrary.data

import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.google.gson.JsonParser
import java.io.File
import java.util.UUID
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/** Real Android DataStore files, fresh per test; no player, CDN, or app-profile reset. */
@RunWith(AndroidJUnit4::class)
class NativePracticePersistenceTest {
    @Test
    fun webV2BackupSurvivesDiskReopenAndReexportsStablePathsSecondsAndUnknownMetadata() = runBlocking {
        val disk = DiskRepository()
        try {
            val incoming = JsonParser.parseString(WEB_BACKUP).asJsonObject
            assertTrue(disk.repository.mergeBackup(WEB_BACKUP, CATALOG).succeeded)
            disk.reopen()
            val restored = disk.repository.snapshot.first()
            assertEquals(listOf(PATH_A, UNKNOWN_PATH), restored.workspace.queue)
            assertEquals(setOf(ID_B), restored.favorites)
            assertEquals(setOf(ID_A), restored.watched)
            assertEquals(25_125L, restored.positionsMs[ID_A])
            assertEquals(listOf(12_000L, 24_500L), restored.bookmarks.getValue(ID_A).map { it.positionMs })
            assertEquals("Turn slowly\nKeep the shoulders quiet", restored.bookmarks.getValue(ID_A)[1].note)
            assertEquals(0.25, restored.workspace.segments.single().speed, 0.0)
            val exported = JsonParser.parseString(disk.repository.exportJson(CATALOG, exportedAtMs = 1700000020000L).content).asJsonObject
            assertEquals(2, exported.get("schemaVersion").asInt)
            assertEquals(incoming.get("practiceData"), exported.get("practiceData"))
            assertEquals(incoming.get("videoPositions"), exported.get("videoPositions"))
            assertEquals(incoming.get("futureEnvelope"), exported.get("futureEnvelope"))
            assertEquals(24.5, exported.getAsJsonObject("videoBookmarks").getAsJsonArray(PATH_A)[1].asJsonObject.get("t").asDouble, 0.0)
            assertTrue(disk.repository.mergeBackup(exported.toString(), CATALOG).succeeded)
            disk.reopen()
            assertEquals(2, disk.repository.snapshot.first().bookmarks.getValue(ID_A).size)
            assertEquals(1, disk.repository.snapshot.first().workspace.segments.size)
        } finally { disk.close() }
    }

    @Test
    fun queueCompletionTwoThousandCharacterNotesReflectionDraftsAndUndoSurviveRealDiskReopen() = runBlocking {
        val disk = DiskRepository()
        try {
            assertTrue(disk.repository.toggleQueued(PATH_A))
            assertTrue(disk.repository.toggleQueued(PATH_B))
            assertTrue(disk.repository.moveQueued(PATH_B, -1))
            assertTrue(disk.repository.toggleCompleted(PATH_B))
            val segment = PracticeSegment("native-short-range", PATH_A, "Precise transition", 1.25, 1.35, 0.25, 1700000000000L)
            assertTrue(disk.repository.saveSegment(segment))
            val prefix = "Practice cue:\n"
            val note = prefix + "x".repeat(2000 - prefix.length)
            val added = disk.repository.addBookmark(ID_A, 24_500L, note)
            assertTrue(added.succeeded)
            val bookmark = requireNotNull(added.bookmark)
            assertTrue(disk.repository.saveReflectionDraft(PATH_A, "Draft goal\nSmall final step", null))
            disk.reopen()
            var current = disk.repository.snapshot.first()
            assertEquals(listOf(PATH_B, PATH_A), current.workspace.queue)
            assertEquals(segment, current.workspace.segments.single())
            assertTrue(PATH_B in current.workspace.completed)
            assertTrue(current.watched.isEmpty())
            assertEquals(note, current.bookmarks.getValue(ID_A).single().note)
            assertEquals("Draft goal\nSmall final step", current.reflectionDrafts.getValue(PATH_A).text)
            assertFalse(PATH_A in current.workspace.reflections)
            assertTrue(disk.repository.saveReflection(PATH_A, "Draft goal\nSmall final step", null))
            val savedReflection = disk.repository.snapshot.first().workspace.reflections.getValue(PATH_A)
            assertTrue(disk.repository.saveReflectionDraft(PATH_A, "Keep my competing draft", savedReflection))
            assertTrue(disk.repository.saveReflection(PATH_A, "A newer saved goal", savedReflection))
            assertFalse(disk.repository.saveReflection(PATH_A, "Keep my competing draft", savedReflection))
            assertTrue(disk.repository.deleteBookmark(ID_A, bookmark.id))
            disk.reopen()
            current = disk.repository.snapshot.first()
            assertEquals("A newer saved goal", current.workspace.reflections.getValue(PATH_A).text)
            assertEquals("Keep my competing draft", current.reflectionDrafts.getValue(PATH_A).text)
            assertEquals(bookmark, current.deletedBookmark)
            assertTrue(current.bookmarks[ID_A].isNullOrEmpty())
            assertTrue(disk.repository.undoDeleteBookmark())
            assertTrue(disk.repository.deleteSegment(segment.id))
            disk.reopen()
            assertEquals(bookmark, disk.repository.snapshot.first().bookmarks.getValue(ID_A).single())
            assertNull(disk.repository.snapshot.first().deletedBookmark)
            assertTrue(disk.repository.snapshot.first().workspace.segments.isEmpty())
        } finally { disk.close() }
    }

    @Test
    fun malformedWorkspaceBackupCannotPartiallyOverwritePreviouslyPersistedNotesOrFavorites() = runBlocking {
        val disk = DiskRepository()
        try {
            assertTrue(disk.repository.mergeBackup(WEB_BACKUP, CATALOG).succeeded)
            val before = JsonParser.parseString(disk.repository.exportJson(CATALOG, exportedAtMs = 1234L).content)
            val malformed = """{"schemaVersion":2,"favoriteVideos":["$PATH_A"],"videoBookmarks":{"$PATH_A":[{"t":90,"n":"Should not commit"}]},"practiceData":{"version":1,"queue":["duplicate","duplicate"],"segments":[],"completed":{},"reflections":{}}}"""
            assertFalse(disk.repository.mergeBackup(malformed, CATALOG).succeeded)
            disk.reopen()
            assertEquals(before, JsonParser.parseString(disk.repository.exportJson(CATALOG, exportedAtMs = 1234L).content))
        } finally { disk.close() }
    }

    private class DiskRepository {
        private val directory = File(InstrumentationRegistry.getInstrumentation().targetContext.cacheDir, "practice-test-${UUID.randomUUID()}").apply { check(mkdirs()) }
        private val file = File(directory, "practice.preferences_pb")
        private var job: Job = SupervisorJob()
        var repository: PracticeRepository = createRepository()
            private set

        private fun createRepository(): PracticeRepository = PracticeRepository(
            PreferenceDataStoreFactory.create(scope = CoroutineScope(job + Dispatchers.IO), produceFile = { file }),
        )

        suspend fun reopen() {
            job.cancelAndJoin()
            job = SupervisorJob()
            repository = createRepository()
        }

        suspend fun close() {
            job.cancelAndJoin()
            check(directory.deleteRecursively())
        }
    }

    companion object {
        private const val PATH_A = "Carolina Rosa - Beginner/07 - Turns in 15.mp4"
        private const val PATH_B = "Carolina Rosa - Advanced/09 - 33 Steps.mp4"
        private const val UNKNOWN_PATH = "Archived course/Keep this practice.mp4"
        private const val ID_A = "889ba4f6-8181-495b-9001-ed3b40c701a2"
        private const val ID_B = "091ce8f2-de17-4eda-a1a1-bb62d048926b"
        private val CATALOG = PracticeBackupCatalog.from(listOf(
            BackupLessonReference(ID_A, PATH_A, "07 - Turns in 1/5"),
            BackupLessonReference(ID_B, PATH_B, "09 - 3X3 Steps"),
        ))
        private val WEB_BACKUP = """{
          "schemaVersion":2,
          "favoriteVideos":["$PATH_B"],"watchedVideos":["$PATH_A"],
          "videoPositions":{"$PATH_A":25.125},"videoLastWatched":{"$PATH_A":1700000000000},
          "videoBookmarks":{"$PATH_A":[12,{"t":24.5,"n":"Turn slowly\nKeep the shoulders quiet","ts":1700000001000}]},
          "practiceData":{"version":1,"queue":["$PATH_A","$UNKNOWN_PATH"],
            "segments":[{"id":"web-segment","path":"$PATH_A","title":"Small transition","start":1.25,"end":8.75,"speed":0.25,"createdAt":1700000000000,"futureSegment":{"keep":true}}],
            "completed":{"$PATH_B":1700000001000},
            "reflections":{"$PATH_A":{"text":"Goal for next time\nKeep the step small","updatedAt":1700000001000,"futureReflection":["preserve"]}},
            "futureWorkspace":{"preserve":true}},
          "futureEnvelope":{"preserve":"cross-platform metadata"}
        }"""
    }
}
