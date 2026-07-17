package com.deadlywolf.dancelibrary.data

import com.google.gson.annotations.SerializedName

data class PracticeSnapshot(
    val favorites: Set<String> = emptySet(),
    val watched: Set<String> = emptySet(),
    val positionsMs: Map<String, Long> = emptyMap(),
    val lastWatchedAtMs: Map<String, Long> = emptyMap(),
    val bookmarks: Map<String, List<PracticeBookmark>> = emptyMap(),
    val lastLessonId: String? = null,
    val themeId: String = DEFAULT_THEME_ID,
    val favoriteThemes: Set<String> = emptySet(),
    val collapsedSections: Map<String, Boolean> = emptyMap(),
    val notesBadgeSeen: Long = 0L,
    val pullZoneOverride: String? = null,
) {
    val bookmarkCount: Int
        get() = bookmarks.values.sumOf(List<PracticeBookmark>::size)

    val unseenBookmarkCount: Long
        get() = (bookmarkCount.toLong() - notesBadgeSeen).coerceAtLeast(0L)
}

data class PracticeBookmark(
    @SerializedName("id") val id: String,
    @SerializedName("lessonId") val lessonId: String,
    @SerializedName("positionMs") val positionMs: Long,
    @SerializedName("note") val note: String = "",
    @SerializedName("createdAtMs") val createdAtMs: Long,
    @SerializedName("updatedAtMs") val updatedAtMs: Long = createdAtMs,
)

enum class PracticeReset {
    WATCH_HISTORY,
    BOOKMARKS_AND_NOTES,
    FAVORITES,
    RESUME_POSITIONS,
    ALL_PRACTICE_DATA,
    SETTINGS,
    EVERYTHING,
}

enum class BookmarkAddStatus {
    ADDED,
    DUPLICATE,
    INVALID,
    PERSISTENCE_FAILED,
}

data class BookmarkAddResult(
    val status: BookmarkAddStatus,
    val bookmark: PracticeBookmark? = null,
    val message: String? = null,
) {
    val succeeded: Boolean
        get() = status == BookmarkAddStatus.ADDED || status == BookmarkAddStatus.DUPLICATE
}

data class BackupLessonReference(
    val lessonId: String,
    val legacyPath: String,
    val title: String,
    val summary: String = "",
)

class PracticeBackupCatalog private constructor(
    private val byLessonId: Map<String, BackupLessonReference>,
    private val byLegacyPath: Map<String, BackupLessonReference>,
    private val knownThemeIds: Set<String>,
) {
    fun referenceForLessonId(lessonId: String): BackupLessonReference? = byLessonId[lessonId]

    fun referenceForLegacyPath(legacyPath: String): BackupLessonReference? = byLegacyPath[legacyPath]

    val lessonIds: Set<String>
        get() = byLessonId.keys

    val references: List<BackupLessonReference>
        get() = byLessonId.values.toList()

    fun isKnownTheme(themeId: String): Boolean = knownThemeIds.isEmpty() || themeId in knownThemeIds

    companion object {
        fun from(
            references: Iterable<BackupLessonReference>,
            knownThemeIds: Set<String> = emptySet(),
        ): PracticeBackupCatalog {
            val idIndex = LinkedHashMap<String, BackupLessonReference>()
            val pathIndex = LinkedHashMap<String, BackupLessonReference>()
            references.forEach { reference ->
                require(reference.lessonId.isNotBlank()) { "Backup lesson id cannot be blank." }
                require(reference.legacyPath.isNotBlank()) { "Backup legacy path cannot be blank." }
                require(idIndex.put(reference.lessonId, reference) == null) {
                    "Duplicate backup lesson id: ${reference.lessonId}"
                }
                require(pathIndex.put(reference.legacyPath, reference) == null) {
                    "Duplicate backup legacy path: ${reference.legacyPath}"
                }
            }
            return PracticeBackupCatalog(idIndex, pathIndex, knownThemeIds)
        }

        fun fromLegacyPathMap(lessonIdByLegacyPath: Map<String, String>): PracticeBackupCatalog = from(
            lessonIdByLegacyPath.map { (legacyPath, lessonId) ->
                BackupLessonReference(
                    lessonId = lessonId,
                    legacyPath = legacyPath,
                    title = legacyPath.substringAfterLast('/').substringBeforeLast('.'),
                )
            },
        )
    }
}

data class PracticeExportOptions(
    val includeBookmarks: Boolean = true,
    val includeSummaries: Boolean = false,
    val includeFavorites: Boolean = true,
    val includeWatchHistory: Boolean = true,
    val includeSettings: Boolean = true,
    val lessonIds: Set<String>? = null,
)

data class BackupExportResult(
    val content: String,
    val skippedLessonIds: Set<String> = emptySet(),
)

data class BackupImportReport(
    val succeeded: Boolean,
    val favoritesAdded: Int = 0,
    val watchedAdded: Int = 0,
    val positionsAddedOrUpdated: Int = 0,
    val historyAddedOrUpdated: Int = 0,
    val bookmarksAdded: Int = 0,
    val bookmarksUpdated: Int = 0,
    val duplicateBookmarksSkipped: Int = 0,
    val settingsUpdated: Int = 0,
    val unknownLegacyPaths: Set<String> = emptySet(),
    val message: String? = null,
)

const val DEFAULT_THEME_ID = "arctic"
const val MAX_UI_NOTE_LENGTH = 120
const val MAX_IMPORTED_NOTE_LENGTH = 2_000
const val MAX_BACKUP_BYTES = 10 * 1024 * 1024
