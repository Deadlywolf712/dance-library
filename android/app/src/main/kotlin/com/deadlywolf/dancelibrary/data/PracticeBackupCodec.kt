package com.deadlywolf.dancelibrary.data

import com.google.gson.Gson
import com.google.gson.GsonBuilder
import com.google.gson.JsonArray
import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import java.nio.charset.StandardCharsets
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import kotlin.math.roundToLong

internal data class ImportedPracticeBookmark(
    val lessonId: String,
    val positionMs: Long,
    val note: String,
    val timestampMs: Long,
)

internal data class DecodedPracticeBackup(
    val favorites: Set<String>,
    val watched: Set<String>,
    val positionsMs: Map<String, Long>,
    val lastWatchedAtMs: Map<String, Long>,
    val bookmarks: Map<String, List<ImportedPracticeBookmark>>,
    val lastLessonId: String?,
    val themeId: String?,
    val favoriteThemes: Set<String>,
    val collapsedSections: Map<String, Boolean>,
    val notesBadgeSeen: Long?,
    val hasPullZoneOverride: Boolean,
    val pullZoneOverride: String?,
    val unknownLegacyPaths: Set<String>,
)

class BackupFormatException(message: String) : IllegalArgumentException(message)

class PracticeBackupCodec(
    private val gson: Gson = Gson(),
) {
    internal fun decodeJson(
        json: String,
        catalog: PracticeBackupCatalog,
    ): DecodedPracticeBackup {
        if (json.toByteArray(StandardCharsets.UTF_8).size > MAX_BACKUP_BYTES) {
            throw BackupFormatException("Backup exceeds the 10 MiB safety limit.")
        }

        val root = runCatching { JsonParser.parseString(json) }
            .getOrElse { throw BackupFormatException("Backup is not valid JSON.") }
            .takeIf(JsonElement::isJsonObject)
            ?.asJsonObject
            ?: throw BackupFormatException("Backup root must be an object.")

        if (RECOGNIZED_KEYS.none(root::has)) {
            throw BackupFormatException("No recognizable Dance Library data was found.")
        }

        val unknownPaths = linkedSetOf<String>()
        fun lessonIdFor(path: String): String? {
            val reference = catalog.referenceForLegacyPath(path)
            if (reference == null) unknownPaths += path
            return reference?.lessonId
        }

        val favorites = readPathArray(root, "favoriteVideos", ::lessonIdFor)
        val watched = readPathArray(root, "watchedVideos", ::lessonIdFor)
        val positions = readPathTimeMap(root, "videoPositions", ::lessonIdFor, secondsToMs = true)
        val lastWatched = readPathTimeMap(root, "videoLastWatched", ::lessonIdFor, secondsToMs = false)
        val bookmarks = readBookmarks(root, ::lessonIdFor)

        val themeId = root.optionalString("theme")
            ?.also(::requireSafeIdentifier)
            ?.takeIf(catalog::isKnownTheme)
        val favoriteThemes = root.optionalStringSet("favoriteThemes")
            .onEach(::requireSafeIdentifier)
            .filter(catalog::isKnownTheme)
            .toSet()
        val collapsedSections = root.optionalBooleanMap("collapsedSections")
        val notesBadgeSeen = root.optionalNonNegativeLong("notesBadgeSeen")
        val hasPullZoneOverride = root.has("bunnyPullZone") || root.has("pullZoneOverride")
        val rawPullZone = when {
            root.has("bunnyPullZone") -> root.optionalString("bunnyPullZone", allowNull = true)
            root.has("pullZoneOverride") -> root.optionalString("pullZoneOverride", allowNull = true)
            else -> null
        }
        val pullZoneOverride = if (hasPullZoneOverride) {
            normalizePullZoneOverride(rawPullZone)
                ?: rawPullZone?.takeIf(String::isNotBlank)?.let {
                    throw BackupFormatException("Invalid Bunny pull-zone override.")
                }
        } else {
            null
        }
        val lastLessonId = root.optionalString("lastLessonPath")?.let(::lessonIdFor)

        return DecodedPracticeBackup(
            favorites = favorites,
            watched = watched,
            positionsMs = positions,
            lastWatchedAtMs = lastWatched,
            bookmarks = bookmarks,
            lastLessonId = lastLessonId,
            themeId = themeId,
            favoriteThemes = favoriteThemes,
            collapsedSections = collapsedSections,
            notesBadgeSeen = notesBadgeSeen,
            hasPullZoneOverride = hasPullZoneOverride,
            pullZoneOverride = pullZoneOverride,
            unknownLegacyPaths = unknownPaths,
        )
    }

    fun encodeJson(
        snapshot: PracticeSnapshot,
        catalog: PracticeBackupCatalog,
        options: PracticeExportOptions = PracticeExportOptions(),
        exportedAtMs: Long = System.currentTimeMillis(),
    ): BackupExportResult {
        val root = JsonObject().apply {
            addProperty("exportedAt", formatIsoTimestamp(exportedAtMs))
            addProperty("nativeSchemaVersion", BACKUP_SCHEMA_VERSION)
        }
        val skipped = linkedSetOf<String>()

        fun referenceFor(lessonId: String): BackupLessonReference? {
            if (options.lessonIds != null && lessonId !in options.lessonIds) return null
            return catalog.referenceForLessonId(lessonId).also { if (it == null) skipped += lessonId }
        }

        if (options.includeBookmarks) {
            val exported = JsonObject()
            snapshot.bookmarks.entries
                .mapNotNull { (lessonId, bookmarks) ->
                    referenceFor(lessonId)?.let { Triple(it.legacyPath, lessonId, bookmarks) }
                }
                .sortedBy(Triple<String, String, List<PracticeBookmark>>::first)
                .forEach { (legacyPath, _, bookmarks) ->
                    val values = JsonArray()
                    bookmarks.sortedBy(PracticeBookmark::positionMs).forEach { bookmark ->
                        values.add(JsonObject().apply {
                            addProperty("t", bookmark.positionMs / 1_000.0)
                            addProperty("n", bookmark.note)
                            addProperty("ts", bookmark.updatedAtMs)
                        })
                    }
                    if (values.size() > 0) exported.add(legacyPath, values)
                }
            root.add("videoBookmarks", exported)
        }

        if (options.includeSummaries) {
            root.add("summaries", JsonObject().apply {
                catalog.references.asSequence()
                    .filter { options.lessonIds == null || it.lessonId in options.lessonIds }
                    .filter { it.summary.isNotBlank() }
                    .sortedBy(BackupLessonReference::legacyPath)
                    .forEach { reference -> addProperty(reference.legacyPath, reference.summary) }
            })
        }

        if (options.includeFavorites) {
            root.add("favoriteVideos", pathArray(snapshot.favorites, catalog, options.lessonIds, skipped))
        }

        if (options.includeWatchHistory) {
            root.add("watchedVideos", pathArray(snapshot.watched, catalog, options.lessonIds, skipped))
            root.add(
                "videoPositions",
                pathNumberMap(snapshot.positionsMs, catalog, options.lessonIds, skipped) { it / 1_000.0 },
            )
            root.add(
                "videoLastWatched",
                pathNumberMap(snapshot.lastWatchedAtMs, catalog, options.lessonIds, skipped, Long::toDouble),
            )
        }

        if (options.includeSettings) {
            root.addProperty("theme", snapshot.themeId)
            root.add("favoriteThemes", JsonArray().apply { snapshot.favoriteThemes.sorted().forEach(::add) })
            root.add("collapsedSections", JsonObject().apply {
                snapshot.collapsedSections.toSortedMap().forEach(::addProperty)
            })
            root.addProperty("notesBadgeSeen", snapshot.notesBadgeSeen)
            snapshot.pullZoneOverride?.let { root.addProperty("bunnyPullZone", it) }
        }

        snapshot.lastLessonId
            ?.takeIf { options.includeWatchHistory }
            ?.takeIf { options.lessonIds == null || it in options.lessonIds }
            ?.let(catalog::referenceForLessonId)
            ?.legacyPath
            ?.let { root.addProperty("lastLessonPath", it) }

        return BackupExportResult(
            content = GsonBuilder().setPrettyPrinting().create().toJson(root) + "\n",
            skippedLessonIds = skipped,
        )
    }

    fun encodeMarkdown(
        snapshot: PracticeSnapshot,
        catalog: PracticeBackupCatalog,
        options: PracticeExportOptions = PracticeExportOptions(),
        exportedAtMs: Long = System.currentTimeMillis(),
    ): BackupExportResult {
        val skipped = linkedSetOf<String>()
        fun referenceFor(lessonId: String): BackupLessonReference? {
            if (options.lessonIds != null && lessonId !in options.lessonIds) return null
            return catalog.referenceForLessonId(lessonId).also { if (it == null) skipped += lessonId }
        }

        val markdown = buildString {
            append("# Dance Library Notes\n\n")
            append("_Exported ").append(formatDate(exportedAtMs)).append("_\n\n")

            if (options.includeFavorites) {
                val favorites = snapshot.favorites.mapNotNull(::referenceFor).sortedBy(BackupLessonReference::legacyPath)
                if (favorites.isNotEmpty()) {
                    append("## Favorites\n\n")
                    favorites.forEach { reference ->
                        append("- **").append(escapeMarkdown(reference.title)).append("** — _")
                            .append(escapeMarkdown(reference.legacyPath.substringBeforeLast('/', "")))
                            .append("_\n")
                    }
                    append('\n')
                }
            }

            if (options.includeBookmarks) {
                val groups = snapshot.bookmarks.entries.mapNotNull { (lessonId, bookmarks) ->
                    referenceFor(lessonId)?.let { it to bookmarks }
                }.filter { it.second.isNotEmpty() }.sortedBy { it.first.legacyPath }
                if (groups.isNotEmpty()) {
                    append("## Bookmarks & Notes\n\n")
                    groups.forEach { (reference, bookmarks) ->
                        append("### ").append(escapeMarkdown(reference.title)).append("\n")
                        append('_').append(escapeMarkdown(reference.legacyPath.substringBeforeLast('/', ""))).append("_\n\n")
                        bookmarks.sortedBy(PracticeBookmark::positionMs).forEach { bookmark ->
                            val time = formatPlaybackTime(bookmark.positionMs)
                            if (bookmark.note.isBlank()) {
                                append("- [").append(time).append("]\n")
                            } else {
                                append("- **[").append(time).append("]** ")
                                    .append(escapeMarkdown(bookmark.note).replace('\n', ' ')).append("\n")
                            }
                        }
                        append('\n')
                    }
                }
            }

            if (options.includeSummaries) {
                val summaries = catalog.references.asSequence()
                    .filter { options.lessonIds == null || it.lessonId in options.lessonIds }
                    .filter { it.summary.isNotBlank() }
                    .sortedBy(BackupLessonReference::legacyPath)
                    .toList()
                if (summaries.isNotEmpty()) {
                    append("## Video Summaries\n\n")
                    summaries.forEach { reference ->
                        append("### ").append(escapeMarkdown(reference.title)).append("\n")
                        append('_').append(escapeMarkdown(reference.legacyPath.substringBeforeLast('/', ""))).append("_\n\n")
                        append(reference.summary.trim()).append("\n\n")
                    }
                }
            }

            if (options.includeWatchHistory) {
                val history = snapshot.watched.mapNotNull { lessonId ->
                    referenceFor(lessonId)?.let { it to (snapshot.lastWatchedAtMs[lessonId] ?: 0L) }
                }.sortedWith(compareByDescending<Pair<BackupLessonReference, Long>> { it.second }.thenBy { it.first.legacyPath })
                if (history.isNotEmpty()) {
                    append("## Watch History\n\n")
                    history.forEach { (reference, watchedAt) ->
                        append("- ").append(escapeMarkdown(reference.title))
                        if (watchedAt > 0L) append(" — ").append(formatIsoTimestamp(watchedAt))
                        snapshot.positionsMs[reference.lessonId]?.let { append(" — at ").append(formatPlaybackTime(it)) }
                        append('\n')
                    }
                    append('\n')
                }
            }
        }

        return BackupExportResult(markdown, skipped)
    }

    private fun readPathArray(
        root: JsonObject,
        key: String,
        lessonIdFor: (String) -> String?,
    ): Set<String> {
        val value = root.get(key) ?: return emptySet()
        if (!value.isJsonArray) throw BackupFormatException("Invalid $key data.")
        return value.asJsonArray.map { element ->
            if (!element.isJsonPrimitive || !element.asJsonPrimitive.isString) {
                throw BackupFormatException("Invalid $key data.")
            }
            element.asString
        }.mapNotNull(lessonIdFor).toSet()
    }

    private fun readPathTimeMap(
        root: JsonObject,
        key: String,
        lessonIdFor: (String) -> String?,
        secondsToMs: Boolean,
    ): Map<String, Long> {
        val value = root.get(key) ?: return emptyMap()
        if (!value.isJsonObject) throw BackupFormatException("Invalid $key data.")
        return buildMap {
            value.asJsonObject.entrySet().forEach { (path, timeElement) ->
                val time = timeElement.nonNegativeFiniteDouble("Invalid $key data.")
                val converted = if (secondsToMs) secondsToMilliseconds(time) else time.roundToLong()
                lessonIdFor(path)?.let { lessonId -> put(lessonId, converted) }
            }
        }
    }

    private fun readBookmarks(
        root: JsonObject,
        lessonIdFor: (String) -> String?,
    ): Map<String, List<ImportedPracticeBookmark>> {
        val value = root.get("videoBookmarks") ?: return emptyMap()
        if (!value.isJsonObject) throw BackupFormatException("Invalid videoBookmarks data.")
        return buildMap {
            value.asJsonObject.entrySet().forEach { (path, bookmarksElement) ->
                if (!bookmarksElement.isJsonArray) throw BackupFormatException("Invalid videoBookmarks data.")
                val lessonId = lessonIdFor(path) ?: return@forEach
                val bookmarks = bookmarksElement.asJsonArray.map { element ->
                    val positionSeconds: Double
                    val note: String
                    val timestampMs: Long
                    when {
                        element.isJsonPrimitive && element.asJsonPrimitive.isNumber -> {
                            positionSeconds = element.nonNegativeFiniteDouble("Invalid videoBookmarks data.")
                            note = ""
                            timestampMs = 0L
                        }

                        element.isJsonObject -> {
                            val bookmark = element.asJsonObject
                            positionSeconds = bookmark.get("t")
                                ?.nonNegativeFiniteDouble("Invalid videoBookmarks data.")
                                ?: throw BackupFormatException("Invalid videoBookmarks data.")
                            note = bookmark.optionalString("n") ?: ""
                            if (note.length > MAX_IMPORTED_NOTE_LENGTH) {
                                throw BackupFormatException("A bookmark note exceeds $MAX_IMPORTED_NOTE_LENGTH characters.")
                            }
                            timestampMs = bookmark.optionalNonNegativeLong("ts") ?: 0L
                        }

                        else -> throw BackupFormatException("Invalid videoBookmarks data.")
                    }
                    ImportedPracticeBookmark(
                        lessonId = lessonId,
                        positionMs = secondsToMilliseconds(positionSeconds),
                        note = note,
                        timestampMs = timestampMs,
                    )
                }
                if (bookmarks.isNotEmpty()) put(lessonId, bookmarks)
            }
        }
    }

    private fun pathArray(
        lessonIds: Set<String>,
        catalog: PracticeBackupCatalog,
        selectedLessonIds: Set<String>?,
        skipped: MutableSet<String>,
    ): JsonArray = JsonArray().apply {
        lessonIds.asSequence()
            .filter { selectedLessonIds == null || it in selectedLessonIds }
            .mapNotNull { lessonId ->
                catalog.referenceForLessonId(lessonId)?.legacyPath.also { if (it == null) skipped += lessonId }
            }
            .sorted()
            .forEach(::add)
    }

    private fun pathNumberMap(
        values: Map<String, Long>,
        catalog: PracticeBackupCatalog,
        selectedLessonIds: Set<String>?,
        skipped: MutableSet<String>,
        transform: (Long) -> Double,
    ): JsonObject = JsonObject().apply {
        values.entries.asSequence()
            .filter { selectedLessonIds == null || it.key in selectedLessonIds }
            .mapNotNull { (lessonId, value) ->
                catalog.referenceForLessonId(lessonId)?.let { Triple(it.legacyPath, lessonId, value) }
                    .also { if (it == null) skipped += lessonId }
            }
            .sortedBy(Triple<String, String, Long>::first)
            .forEach { (path, _, value) -> addProperty(path, transform(value)) }
    }

    private fun secondsToMilliseconds(seconds: Double): Long {
        if (seconds > Long.MAX_VALUE / 1_000.0) throw BackupFormatException("Playback time is too large.")
        return (seconds * 1_000.0).roundToLong()
    }

    private companion object {
        const val BACKUP_SCHEMA_VERSION = 1
        val RECOGNIZED_KEYS = setOf(
            "watchedVideos",
            "videoBookmarks",
            "favoriteVideos",
            "videoPositions",
            "videoLastWatched",
            "theme",
            "favoriteThemes",
            "collapsedSections",
            "notesBadgeSeen",
            "bunnyPullZone",
            "pullZoneOverride",
            "lastLessonPath",
        )
    }
}

internal fun normalizePullZoneOverride(value: String?): String? {
    val normalized = value
        ?.trim()
        ?.removePrefix("https://")
        ?.removePrefix("http://")
        ?.trimEnd('/')
        .orEmpty()
    if (normalized.isBlank()) return null
    return normalized.takeIf { BUNNY_HOST.matches(it) }
}

private fun requireSafeIdentifier(value: String) {
    if (!SAFE_IDENTIFIER.matches(value)) throw BackupFormatException("Invalid preference identifier.")
}

private fun JsonObject.optionalString(key: String, allowNull: Boolean = false): String? {
    val element = get(key) ?: return null
    if (allowNull && element.isJsonNull) return null
    if (!element.isJsonPrimitive || !element.asJsonPrimitive.isString) {
        throw BackupFormatException("Invalid $key data.")
    }
    return element.asString
}

private fun JsonObject.optionalStringSet(key: String): Set<String> {
    val element = get(key) ?: return emptySet()
    if (!element.isJsonArray) throw BackupFormatException("Invalid $key data.")
    return element.asJsonArray.map { value ->
        if (!value.isJsonPrimitive || !value.asJsonPrimitive.isString) {
            throw BackupFormatException("Invalid $key data.")
        }
        value.asString
    }.toSet()
}

private fun JsonObject.optionalBooleanMap(key: String): Map<String, Boolean> {
    val element = get(key) ?: return emptyMap()
    if (!element.isJsonObject) throw BackupFormatException("Invalid $key data.")
    return buildMap {
        element.asJsonObject.entrySet().forEach { (name, value) ->
            if (name.isBlank() || name.length > 200 || !value.isJsonPrimitive || !value.asJsonPrimitive.isBoolean) {
                throw BackupFormatException("Invalid $key data.")
            }
            put(name, value.asBoolean)
        }
    }
}

private fun JsonObject.optionalNonNegativeLong(key: String): Long? {
    val element = get(key) ?: return null
    return element.nonNegativeFiniteDouble("Invalid $key data.").roundToLong()
}

private fun JsonElement.nonNegativeFiniteDouble(message: String): Double {
    if (!isJsonPrimitive || !asJsonPrimitive.isNumber) throw BackupFormatException(message)
    val value = runCatching { asDouble }.getOrElse { throw BackupFormatException(message) }
    if (!value.isFinite() || value < 0.0 || value > Long.MAX_VALUE.toDouble()) throw BackupFormatException(message)
    return value
}

private fun formatIsoTimestamp(epochMs: Long): String = SimpleDateFormat(
    "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
    Locale.US,
).apply { timeZone = TimeZone.getTimeZone("UTC") }.format(Date(epochMs.coerceAtLeast(0L)))

private fun formatDate(epochMs: Long): String = SimpleDateFormat("yyyy-MM-dd", Locale.US)
    .apply { timeZone = TimeZone.getTimeZone("UTC") }
    .format(Date(epochMs.coerceAtLeast(0L)))

private fun formatPlaybackTime(milliseconds: Long): String {
    val totalSeconds = (milliseconds / 1_000L).coerceAtLeast(0L)
    val hours = totalSeconds / 3_600L
    val minutes = (totalSeconds % 3_600L) / 60L
    val seconds = totalSeconds % 60L
    return if (hours > 0L) String.format(Locale.US, "%d:%02d:%02d", hours, minutes, seconds)
    else String.format(Locale.US, "%d:%02d", minutes, seconds)
}

private fun escapeMarkdown(value: String): String = value.replace(Regex("([\\\\`*_{}\\[\\]()#+.!|>-])"), "\\\\$1")

private val SAFE_IDENTIFIER = Regex("^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$")
private val BUNNY_HOST = Regex("^[a-zA-Z0-9.-]+\\.b-cdn\\.net$")
