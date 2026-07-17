package com.deadlywolf.dancelibrary.data

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.emptyPreferences
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
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

    private class FailingDataStore : DataStore<Preferences> {
        override val data: Flow<Preferences> = flowOf(emptyPreferences())
        var updateAttempts: Int = 0
            private set

        override suspend fun updateData(transform: suspend (Preferences) -> Preferences): Preferences {
            updateAttempts += 1
            throw IOException("Simulated persistence failure")
        }
    }

    private companion object {
        const val LESSON_ID = "9b0a1d6a-da85-4a75-92f8-8cc8d62abe96"
    }
}
