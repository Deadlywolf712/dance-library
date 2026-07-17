package com.deadlywolf.dancelibrary.data

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.emptyPreferences
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
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
    fun identicalPlaybackProgressDoesNotCreateAnotherChangedWrite() = runTest {
        val dataStore = RecordingDataStore()
        val repository = PracticeRepository(dataStore)

        repository.savePlayback(LESSON_ID, positionMs = 10_000, durationMs = 60_000)
        repository.savePlayback(LESSON_ID, positionMs = 10_000, durationMs = 60_000)

        assertEquals(1, dataStore.changedWrites)
    }

    @Test
    fun markingWatchedAtomicallyClearsSavedResumePosition() = runTest {
        val dataStore = RecordingDataStore()
        val repository = PracticeRepository(dataStore)

        repository.savePlayback(LESSON_ID, positionMs = 10_000, durationMs = 60_000)
        repository.setWatched(LESSON_ID, watched = true)

        val snapshot = repository.snapshot.first()
        assertTrue(LESSON_ID in snapshot.watched)
        assertEquals(null, snapshot.positionsMs[LESSON_ID])
    }

    @Test
    fun laterProgressCannotRestoreResumeForWatchedLesson() = runTest {
        val dataStore = RecordingDataStore()
        val repository = PracticeRepository(dataStore)

        repository.savePlayback(LESSON_ID, positionMs = 10_000, durationMs = 60_000)
        repository.setWatched(LESSON_ID, watched = true)
        repository.savePlayback(LESSON_ID, positionMs = 30_000, durationMs = 60_000)

        val snapshot = repository.snapshot.first()
        assertTrue(LESSON_ID in snapshot.watched)
        assertEquals(null, snapshot.positionsMs[LESSON_ID])
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

    private class RecordingDataStore : DataStore<Preferences> {
        private val stored = MutableStateFlow<Preferences>(emptyPreferences())
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
    }
}
