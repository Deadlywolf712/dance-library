package com.deadlywolf.dancelibrary.data

import com.google.gson.JsonArray
import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import kotlin.math.abs

/** Retains personal data for catalog paths this installation cannot display. */
internal object UnmappedLegacyCodec {
    data class Promotion(val root: JsonObject, val remaining: JsonObject)
    private val arrayKeys = setOf("favoriteVideos", "watchedVideos")
    private val timeKeys = setOf("videoPositions", "videoLastWatched")
    private val keys = arrayKeys + timeKeys + setOf("videoBookmarks", "lastLessonPath")

    fun read(raw: String?): JsonObject {
        if (raw == null) return JsonObject()
        return try {
            val value = JsonParser.parseString(raw)
            if (!value.isJsonObject) invalid()
            validate(value.asJsonObject)
        } catch (error: Exception) {
            throw BackupFormatException(error.message ?: "Retained lesson data is invalid; its original storage has been kept.")
        }
    }

    fun capture(root: JsonObject, catalog: PracticeBackupCatalog): JsonObject {
        val retained = JsonObject()
        fun unknown(path: String) = catalog.referenceForLegacyPath(path) == null
        arrayKeys.forEach { key -> root.get(key)?.let { value ->
            if (!value.isJsonArray) invalid()
            val selected = JsonArray()
            value.asJsonArray.forEach { if (unknown(path(it))) selected.add(it.deepCopy()) }
            if (selected.size() > 0) retained.add(key, selected)
        } }
        (timeKeys + "videoBookmarks").forEach { key -> root.get(key)?.let { value ->
            if (!value.isJsonObject) invalid()
            val selected = JsonObject()
            value.asJsonObject.entrySet().forEach { (path, entry) -> if (unknown(path)) selected.add(path, entry.deepCopy()) }
            if (selected.size() > 0) retained.add(key, selected)
        } }
        root.get("lastLessonPath")?.let { if (unknown(path(it))) retained.add("lastLessonPath", it.deepCopy()) }
        return validate(retained)
    }

    /** Promote only paths touched by this import, including all their retained originals. */
    fun preparePromotion(root: JsonObject, retained: JsonObject, catalog: PracticeBackupCatalog): Promotion {
        validate(retained)
        val promoted = JsonObject()
        val remaining = retained.deepCopy()
        arrayKeys.forEach { key ->
            val touched = root.getAsJsonArray(key)?.map { it.asString }?.toSet().orEmpty()
            retained.getAsJsonArray(key)?.let { values ->
                val selected = values.filter { it.asString in touched && catalog.referenceForLegacyPath(it.asString) != null }
                if (selected.isNotEmpty()) {
                    val selectedPaths = selected.map { it.asString }.toSet()
                    promoted.add(key, JsonArray().apply { selected.forEach { add(it.deepCopy()) } })
                    val kept = JsonArray().apply { values.filter { it.asString !in selectedPaths }.forEach { add(it.deepCopy()) } }
                    if (kept.size() == 0) remaining.remove(key) else remaining.add(key, kept)
                }
            }
        }
        (timeKeys + "videoBookmarks").forEach { key ->
            val touched = root.getAsJsonObject(key)
            retained.getAsJsonObject(key)?.let { values ->
                val selected = JsonObject()
                val kept = values.deepCopy()
                values.entrySet().forEach { (path, entry) ->
                    if (touched?.has(path) == true && catalog.referenceForLegacyPath(path) != null) {
                        selected.add(path, entry.deepCopy())
                        kept.remove(path)
                    }
                }
                if (selected.size() > 0) promoted.add(key, selected)
                if (kept.size() == 0) remaining.remove(key) else remaining.add(key, kept)
            }
        }
        val lastPath = retained.get("lastLessonPath")?.asString
        if (lastPath != null && root.get("lastLessonPath")?.asString == lastPath && catalog.referenceForLegacyPath(lastPath) != null) {
            promoted.addProperty("lastLessonPath", lastPath)
            remaining.remove("lastLessonPath")
        }
        val incoming = JsonObject().apply { keys.forEach { key -> root.get(key)?.let { add(key, it.deepCopy()) } } }
        val combined = merge(promoted, incoming)
        return Promotion(root.deepCopy().apply { combined.entrySet().forEach { (key, value) -> add(key, value) } }, remaining)
    }

    fun merge(local: JsonObject, incoming: JsonObject): JsonObject {
        validate(local); validate(incoming)
        val result = local.deepCopy()
        arrayKeys.forEach { key -> incoming.get(key)?.let { added ->
            val values = local.getAsJsonArray(key)?.map { it.asString }.orEmpty().toMutableList()
            added.asJsonArray.forEach { if (it.asString !in values) values += it.asString }
            result.add(key, JsonArray().apply { values.forEach(::add) })
        } }
        timeKeys.forEach { key -> incoming.get(key)?.let { added ->
            val times = local.getAsJsonObject(key)?.deepCopy() ?: JsonObject()
            added.asJsonObject.entrySet().forEach { (path, time) ->
                if (!times.has(path) || time.asDouble > times.get(path).asDouble) times.add(path, time.deepCopy())
            }
            result.add(key, times)
        } }
        incoming.getAsJsonObject("videoBookmarks")?.let { added ->
            val paths = local.getAsJsonObject("videoBookmarks")?.deepCopy() ?: JsonObject()
            added.entrySet().forEach { (path, incomingNotes) ->
                if (!paths.has(path)) {
                    paths.add(path, incomingNotes.deepCopy())
                    return@forEach
                }
                val notes = paths.getAsJsonArray(path)?.map { it.deepCopy() }?.toMutableList() ?: mutableListOf()
                incomingNotes.asJsonArray.forEach { incomingNote ->
                    val index = notes.indexOfFirst { abs(time(it) - time(incomingNote)) < 1.0 }
                    if (index < 0) notes += incomingNote.deepCopy()
                    else notes[index] = mergeNote(notes[index], incomingNote)
                }
                paths.add(path, JsonArray().apply { notes.forEach(::add) })
            }
            result.add("videoBookmarks", paths)
        }
        incoming.get("lastLessonPath")?.let { added ->
            val old = local.get("lastLessonPath")?.asString
            val history = result.getAsJsonObject("videoLastWatched")
            val incomingTime = history?.get(added.asString)?.asDouble ?: -1.0
            val oldTime = old?.let { history?.get(it)?.asDouble } ?: -1.0
            if (old == null || incomingTime > oldTime) result.add("lastLessonPath", added.deepCopy())
        }
        return validate(result)
    }

    fun forOptions(retained: JsonObject, options: PracticeExportOptions): JsonObject {
        if (options.lessonIds != null) return JsonObject()
        validate(retained)
        return retained.deepCopy().apply {
            if (!options.includeBookmarks) remove("videoBookmarks")
            if (!options.includeFavorites) remove("favoriteVideos")
            if (!options.includeWatchHistory) {
                remove("watchedVideos"); remove("videoPositions"); remove("videoLastWatched"); remove("lastLessonPath")
            }
        }
    }

    fun combineExport(root: JsonObject, retained: JsonObject): JsonObject {
        val known = JsonObject().apply { keys.forEach { key -> root.get(key)?.let { add(key, it.deepCopy()) } } }
        val combined = merge(retained, known)
        return root.deepCopy().apply { combined.entrySet().forEach { (key, value) -> add(key, value) } }
    }

    fun without(retained: JsonObject, removed: Set<String>): JsonObject = validate(retained).deepCopy().apply { removed.forEach(::remove) }

    private fun validate(value: JsonObject): JsonObject {
        if (value.keySet().any { it !in keys }) invalid()
        arrayKeys.forEach { key -> value.get(key)?.let {
            if (!it.isJsonArray) invalid()
            it.asJsonArray.forEach { path(it) }
        } }
        timeKeys.forEach { key -> value.get(key)?.let {
            if (!it.isJsonObject) invalid()
            it.asJsonObject.entrySet().forEach { (path, time) -> requirePath(path); number(time) }
        } }
        value.get("videoBookmarks")?.let { notes ->
            if (!notes.isJsonObject) invalid()
            notes.asJsonObject.entrySet().forEach { (path, entries) ->
                requirePath(path)
                if (!entries.isJsonArray) invalid()
                entries.asJsonArray.forEach { note ->
                    time(note)
                    if (note.isJsonObject) {
                        note.asJsonObject.get("n")?.let { text ->
                            if (!text.isJsonPrimitive || !text.asJsonPrimitive.isString || text.asString.length > MAX_IMPORTED_NOTE_LENGTH) invalid()
                        }
                        note.asJsonObject.get("ts")?.let(::number)
                    }
                }
            }
        }
        value.get("lastLessonPath")?.let(::path)
        return value
    }

    private fun mergeNote(local: JsonElement, incoming: JsonElement): JsonElement {
        val localText = note(local)
        val incomingText = note(incoming)
        val newNote = incomingText.isNotBlank() && (localText.isBlank() || timestamp(incoming) > timestamp(local))
        val sameTextNewer = localText == incomingText && timestamp(incoming) > timestamp(local)
        if (!local.isJsonObject && !incoming.isJsonObject) return local.deepCopy()
        // Keep the established timestamp position and all opaque local fields on collisions.
        val combined = if (local.isJsonObject) local.asJsonObject.deepCopy() else JsonObject().apply { add("t", local.deepCopy()) }
        if (incoming.isJsonObject) incoming.asJsonObject.entrySet().forEach { (key, value) ->
            if (key !in setOf("t", "n", "ts") && !combined.has(key)) combined.add(key, value.deepCopy())
        }
        if (newNote) combined.addProperty("n", incomingText)
        if (newNote || sameTextNewer) combined.addProperty("ts", maxOf(timestamp(local), timestamp(incoming)))
        return combined
    }

    private fun note(value: JsonElement): String = if (value.isJsonObject) value.asJsonObject.get("n")?.asString.orEmpty() else ""
    private fun timestamp(value: JsonElement): Double = if (value.isJsonObject) value.asJsonObject.get("ts")?.asDouble ?: 0.0 else 0.0
    private fun time(value: JsonElement): Double = number(if (value.isJsonObject) value.asJsonObject.get("t") ?: invalid() else value)
    private fun number(value: JsonElement): Double {
        if (!value.isJsonPrimitive || !value.asJsonPrimitive.isNumber) invalid()
        return value.asDouble.takeIf { it.isFinite() && it >= 0 } ?: invalid()
    }
    private fun path(value: JsonElement): String {
        if (!value.isJsonPrimitive || !value.asJsonPrimitive.isString) invalid()
        return value.asString.also(::requirePath)
    }
    private fun requirePath(path: String) { if (path.isBlank()) invalid() }
    private fun invalid(): Nothing = throw BackupFormatException("Retained lesson data is invalid; its original storage has been kept.")
}
