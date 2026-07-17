package com.deadlywolf.dancelibrary.data

import android.content.Context
import android.util.Log
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.MutablePreferences
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.core.stringSetPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.map
import java.io.IOException

private val Context.practiceDataStore by preferencesDataStore(name = "dance_practice")

data class PracticeSnapshot(
    val favorites: Set<String> = emptySet(),
    val watched: Set<String> = emptySet(),
    val positionsMs: Map<String, Long> = emptyMap(),
    val lastLessonId: String? = null,
)

class PracticeRepository internal constructor(
    private val dataStore: DataStore<Preferences>,
    private val gson: Gson = Gson(),
) {
    constructor(context: Context, gson: Gson = Gson()) : this(context.practiceDataStore, gson)

    val snapshot: Flow<PracticeSnapshot> = dataStore.data
        .catch { error ->
            if (error is IOException) emit(androidx.datastore.preferences.core.emptyPreferences()) else throw error
        }
        .map(::decode)

    suspend fun toggleFavorite(lessonId: String) {
        editSafely("favorites") { values ->
            val next = values[FAVORITES].orEmpty().toMutableSet()
            if (!next.add(lessonId)) next.remove(lessonId)
            values[FAVORITES] = next
        }
    }

    suspend fun savePlayback(lessonId: String, positionMs: Long, durationMs: Long) {
        if (positionMs < 0) return
        editSafely("playback progress") { values ->
            val originalPositions = decodePositions(values[POSITIONS])
            val originalWatched = values[WATCHED].orEmpty()
            val positions = originalPositions.toMutableMap()
            val watched = originalWatched.toMutableSet()
            val completed = durationMs > 0 && positionMs >= (durationMs * COMPLETION_FRACTION).toLong()

            if (lessonId in originalWatched) {
                if (positions.remove(lessonId) != null) {
                    values[POSITIONS] = gson.toJson(positions)
                }
                return@editSafely
            }

            when {
                completed -> {
                    positions.remove(lessonId)
                    watched.add(lessonId)
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
            values[LAST_SAVED_AT] = System.currentTimeMillis()
        }
    }

    suspend fun setWatched(lessonId: String, watched: Boolean) {
        editSafely("watched status") { values ->
            val current = values[WATCHED].orEmpty()
            val next = current.toMutableSet()
            if (watched) next.add(lessonId) else next.remove(lessonId)
            val positions = decodePositions(values[POSITIONS]).toMutableMap()
            val removedPosition = watched && positions.remove(lessonId) != null
            if (next == current && !removedPosition) return@editSafely
            values[WATCHED] = next
            if (removedPosition) values[POSITIONS] = gson.toJson(positions)
        }
    }

    private suspend fun editSafely(
        operation: String,
        transform: suspend (MutablePreferences) -> Unit,
    ) {
        try {
            dataStore.edit(transform)
        } catch (error: IOException) {
            Log.w(TAG, "Could not persist $operation; continuing without saving.", error)
        }
    }

    private fun decode(values: Preferences): PracticeSnapshot = PracticeSnapshot(
        favorites = values[FAVORITES].orEmpty(),
        watched = values[WATCHED].orEmpty(),
        positionsMs = decodePositions(values[POSITIONS]),
        lastLessonId = values[LAST_LESSON],
    )

    private fun decodePositions(json: String?): Map<String, Long> {
        if (json.isNullOrBlank()) return emptyMap()
        return runCatching {
            gson.fromJson<Map<String, Long>>(json, POSITIONS_TYPE).orEmpty()
                .filterValues { it >= MINIMUM_RESUME_MS }
        }.getOrDefault(emptyMap())
    }

    private companion object {
        const val TAG = "PracticeRepository"
        val FAVORITES = stringSetPreferencesKey("favorite_lesson_ids")
        val WATCHED = stringSetPreferencesKey("watched_lesson_ids")
        val POSITIONS = stringPreferencesKey("playback_positions_ms")
        val LAST_LESSON = stringPreferencesKey("last_lesson_id")
        val LAST_SAVED_AT = longPreferencesKey("last_saved_at")
        val POSITIONS_TYPE = object : TypeToken<Map<String, Long>>() {}.type
        const val MINIMUM_RESUME_MS = 5_000L
        const val COMPLETION_FRACTION = 0.90
    }
}
