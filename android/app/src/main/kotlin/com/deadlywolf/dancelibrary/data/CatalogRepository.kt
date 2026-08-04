package com.deadlywolf.dancelibrary.data

import android.content.Context
import com.deadlywolf.dancelibrary.model.CatalogFolder
import com.deadlywolf.dancelibrary.model.DanceCatalog
import com.deadlywolf.dancelibrary.model.Lesson
import com.deadlywolf.dancelibrary.model.ThemeCssVariables
import com.deadlywolf.dancelibrary.model.isAvailable
import com.google.gson.Gson
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.InputStreamReader
import java.nio.charset.StandardCharsets
import java.util.UUID

class CatalogRepository(
    private val context: Context,
    private val gson: Gson = Gson(),
    private val ioDispatcher: CoroutineDispatcher = Dispatchers.IO,
) {
    suspend fun load(): DanceCatalog = withContext(ioDispatcher) {
        context.assets.open(CATALOG_ASSET).use { stream ->
            InputStreamReader(stream, StandardCharsets.UTF_8).use { reader ->
                gson.fromJson(reader, DanceCatalog::class.java)
            }
        }.also(CatalogValidator::requireValid)
    }

    private companion object {
        const val CATALOG_ASSET = "catalog.json"
    }
}

object CatalogValidator {
    private val hostname = Regex("^[a-zA-Z0-9.-]+\\.b-cdn\\.net$")
    private val sha256 = Regex("^[0-9a-f]{64}$")
    private val cssColor = Regex("^(?:#[0-9a-fA-F]{3,8}|rgba?\\([^\\r\\n()]+\\))$")
    private val videoExtension = Regex("\\.(mp4|mov|m4v)$", RegexOption.IGNORE_CASE)

    fun requireValid(catalog: DanceCatalog) {
        require(catalog.schemaVersion == 3) { "Unsupported catalog schema ${catalog.schemaVersion}" }
        require(sha256.matches(catalog.sourceSha256)) { "Catalog source hash is invalid" }
        require(hostname.matches(catalog.pullZoneHost)) { "Catalog pull zone is not a Bunny CDN hostname" }
        require(catalog.lessonCount == catalog.lessons.size) { "Catalog lesson count does not match payload" }
        require(catalog.lessons.isNotEmpty()) { "Catalog contains no lessons" }
        require(catalog.summaryCount == catalog.lessonCount) { "Catalog summary count does not match lessons" }
        require(catalog.chapterCount == catalog.lessons.sumOf { it.chapters.size }) { "Catalog chapter count does not match lessons" }
        require(catalog.introParagraphCount == catalog.lessons.sumOf { it.introParagraphs.size }) {
            "Catalog introduction count does not match lessons"
        }

        require(catalog.themes.size == EXPECTED_THEME_COUNT) {
            "Expected $EXPECTED_THEME_COUNT themes, found ${catalog.themes.size}"
        }
        requireUniqueIds("theme", catalog.themes.map { it.id })
        requireContiguousOrdinals("theme", catalog.themes.map { it.sortOrdinal })
        require(catalog.defaultThemeId == DEFAULT_THEME_ID) { "Catalog default theme must be $DEFAULT_THEME_ID" }
        require(catalog.themes.any { it.id == catalog.defaultThemeId }) { "Default theme is missing" }
        catalog.themes.forEach { theme ->
            require(theme.id.isNotBlank() && theme.name.isNotBlank()) { "Theme metadata is incomplete" }
            require(theme.cssVariables.keys == ThemeCssVariables.required) { "Theme ${theme.id} has incomplete CSS variables" }
            require(theme.cssVariables.values.all(cssColor::matches)) { "Theme ${theme.id} contains an invalid CSS color" }
        }

        require(catalog.categories.isNotEmpty()) { "Catalog contains no categories" }
        require(catalog.courses.isNotEmpty()) { "Catalog contains no courses" }
        require(catalog.folders.isNotEmpty()) { "Catalog contains no folders" }
        requireUniqueIds("category", catalog.categories.map { it.id })
        requireUniqueIds("course", catalog.courses.map { it.id })
        requireUniqueIds("folder", catalog.folders.map { it.id })
        requireContiguousOrdinals("category", catalog.categories.map { it.sortOrdinal })

        val categoryById = catalog.categories.associateBy { it.id }
        val courseById = catalog.courses.associateBy { it.id }
        val folderById = catalog.folders.associateBy { it.id }
        val courseByRootFolder = catalog.courses.associateBy { it.rootFolderId }

        catalog.courses.groupBy { it.categoryId }.forEach { (categoryId, courses) ->
            require(categoryId in categoryById) { "Course category does not exist: $categoryId" }
            require(courses.all { it.title.isNotBlank() && it.displayName.isNotBlank() }) {
                "Course metadata is incomplete in category $categoryId"
            }
            requireContiguousOrdinals("courses in $categoryId", courses.map { it.sortOrdinal })
        }

        catalog.folders.groupBy { folder ->
            folder.parentId?.let { "folder:$it" } ?: "category:${folder.categoryId}"
        }.forEach { (parent, folders) ->
            requireContiguousOrdinals("folders under $parent", folders.map { it.sortOrdinal })
        }

        catalog.folders.forEach { folder ->
            require(folder.id.isNotBlank() && folder.name.isNotBlank() && folder.displayName.isNotBlank()) {
                "Folder metadata is incomplete"
            }
            require(folder.pathSegments.isNotEmpty() && folder.pathSegments.last() == folder.name) {
                "Folder path is invalid: ${folder.id}"
            }
            val course = requireNotNull(courseById[folder.courseId]) { "Folder course does not exist: ${folder.id}" }
            require(folder.categoryId == course.categoryId) { "Folder category diverges from course: ${folder.id}" }
            if (folder.parentId == null) {
                require(folder.pathSegments == listOf(course.title)) { "Course root path is invalid: ${folder.id}" }
                require(folder.name == course.title) { "Course root name diverges from stable title: ${folder.id}" }
                require(folder.displayName == course.displayName) { "Course root display name diverges: ${folder.id}" }
                require(course.rootFolderId == folder.id) { "Unreferenced course root folder: ${folder.id}" }
                require(folder.sortOrdinal == course.sortOrdinal) { "Course and root-folder order diverged: ${course.id}" }
            } else {
                val parent = requireNotNull(folderById[folder.parentId]) { "Folder parent does not exist: ${folder.id}" }
                require(parent.courseId == folder.courseId && parent.categoryId == folder.categoryId) {
                    "Folder parent crosses a course or category: ${folder.id}"
                }
                require(folder.pathSegments == parent.pathSegments + folder.name) { "Folder path diverges from parent: ${folder.id}" }
                require(folder.displayName == folder.name) { "Nested folder display name diverges: ${folder.id}" }
            }
            validatePresentation(folder)
        }
        require(courseByRootFolder.size == catalog.courses.size) { "Courses share a root folder" }
        require(catalog.folders.count { it.parentId == null } == catalog.courses.size) { "Course root-folder count is invalid" }

        catalog.folders.forEach { folder ->
            val visited = HashSet<String>()
            var current: CatalogFolder? = folder
            while (current != null) {
                require(visited.add(current.id)) { "Folder hierarchy contains a cycle at ${folder.id}" }
                current = current.parentId?.let(folderById::get)
            }
        }

        val ids = HashSet<String>(catalog.lessons.size)
        catalog.lessons.forEach { lesson ->
            require(runCatching { UUID.fromString(lesson.id) }.isSuccess) { "Invalid lesson id: ${lesson.id}" }
            require(lesson.id == lesson.bunnyId) { "Lesson id and Bunny id diverged: ${lesson.id}" }
            require(ids.add(lesson.id)) { "Duplicate lesson id: ${lesson.id}" }
            require(lesson.title.isNotBlank() && lesson.course.isNotBlank() && lesson.courseDisplayName.isNotBlank()) {
                "Lesson metadata is incomplete: ${lesson.id}"
            }
            require(lesson.legacyPath.isNotBlank()) { "Lesson path is missing: ${lesson.id}" }
            require(lesson.playlistId.isNotBlank()) { "Lesson playlist is missing: ${lesson.id}" }
            val folder = requireNotNull(folderById[lesson.folderId]) { "Lesson folder does not exist: ${lesson.id}" }
            val course = requireNotNull(courseById[lesson.courseId]) { "Lesson course does not exist: ${lesson.id}" }
            require(folder.courseId == course.id && lesson.categoryId == course.categoryId) {
                "Lesson hierarchy references diverge: ${lesson.id}"
            }
            require(lesson.categoryTitle == categoryById.getValue(lesson.categoryId).title) {
                "Lesson category title diverges: ${lesson.id}"
            }
            require(lesson.course == course.title) { "Lesson course title diverges: ${lesson.id}" }
            require(lesson.courseDisplayName == course.displayName) { "Lesson course display name diverges: ${lesson.id}" }
            require(lesson.breadcrumbs == folder.pathSegments.drop(1)) { "Lesson breadcrumbs diverge: ${lesson.id}" }
            require(lesson.legacyPath.substringBeforeLast('/') == folder.pathSegments.joinToString("/")) {
                "Lesson path diverges from folder: ${lesson.id}"
            }
            require(videoExtension.containsMatchIn(lesson.legacyPath.substringAfterLast('/'))) {
                "Lesson path has an unsupported video extension: ${lesson.id}"
            }
            require(lesson.title.none { it == '\r' || it == '\n' }) {
                "Lesson display title is invalid: ${lesson.id}"
            }
            require(lesson.availability == "available" || lesson.availability == "unavailable") {
                "Lesson availability is invalid: ${lesson.id}"
            }
            require(lesson.isAvailable == lesson.availabilityReason.isNullOrBlank()) {
                "Lesson availability reason disagrees: ${lesson.id}"
            }
            require(lesson.chapters.zipWithNext().all { (a, b) -> a.seconds < b.seconds }) {
                "Lesson chapters are not strictly ordered: ${lesson.id}"
            }
        }

        requireContiguousOrdinals("catalog lessons", catalog.lessons.map { it.catalogOrdinal })
        val lessonsByFolder = catalog.lessons.groupBy(Lesson::folderId)
        val playlistFolder = HashMap<String, String>()
        lessonsByFolder.forEach { (folderId, lessons) ->
            requireContiguousOrdinals("lessons in $folderId", lessons.map { it.sortOrdinal })
            val playlistIds = lessons.map(Lesson::playlistId).toSet()
            require(playlistIds.size == 1) { "Folder $folderId has multiple playlists" }
            val playlistId = playlistIds.single()
            require(playlistFolder.put(playlistId, folderId) == null) { "Playlist $playlistId spans multiple folders" }
        }

        val childrenByParent = catalog.folders
            .filter { it.parentId != null }
            .groupBy { requireNotNull(it.parentId) }
            .mapValues { (_, folders) -> folders.sortedBy(CatalogFolder::sortOrdinal) }
        val directLessonsByFolder = lessonsByFolder.mapValues { (_, lessons) -> lessons.sortedBy(Lesson::sortOrdinal) }
        val folderCountByCourse = catalog.folders.groupingBy(CatalogFolder::courseId).eachCount()

        fun validateFolderRollup(folder: CatalogFolder): Int {
            val children = childrenByParent[folder.id].orEmpty()
            require(folder.childFolderCount == children.size) { "Child-folder count is invalid: ${folder.id}" }
            val directCount = directLessonsByFolder[folder.id].orEmpty().size
            require(folder.directLessonCount == directCount) { "Direct lesson count is invalid: ${folder.id}" }
            val lessonCount = directCount + children.sumOf(::validateFolderRollup)
            require(folder.lessonCount == lessonCount) { "Folder lesson rollup is invalid: ${folder.id}" }
            return lessonCount
        }

        catalog.courses.forEach { course ->
            val rootFolder = requireNotNull(folderById[course.rootFolderId]) { "Course root is missing: ${course.id}" }
            require(course.lessonCount == validateFolderRollup(rootFolder)) { "Course lesson count is invalid: ${course.id}" }
            require(course.folderCount == folderCountByCourse[course.id]) { "Course folder count is invalid: ${course.id}" }
            course.presentation?.let { presentation ->
                require(presentation.title.isNotBlank() && presentation.subtitle.isNotBlank() && presentation.intro.isNotBlank()) {
                    "Course presentation is incomplete: ${course.id}"
                }
            }
        }

        catalog.categories.forEach { category ->
            val courses = catalog.courses.filter { it.categoryId == category.id }
            require(category.courseCount == courses.size) { "Category course count is invalid: ${category.id}" }
            require(category.lessonCount == courses.sumOf { it.lessonCount }) { "Category lesson count is invalid: ${category.id}" }
            require(category.folderCount == courses.sumOf { it.folderCount }) { "Category folder count is invalid: ${category.id}" }
        }

        val expectedWebsiteOrder = buildList {
            fun appendFolder(folder: CatalogFolder) {
                childrenByParent[folder.id].orEmpty().forEach(::appendFolder)
                addAll(directLessonsByFolder[folder.id].orEmpty().map(Lesson::id))
            }
            catalog.categories.sortedBy { it.sortOrdinal }.forEach { category ->
                catalog.courses
                    .filter { it.categoryId == category.id }
                    .sortedBy { it.sortOrdinal }
                    .forEach { course -> appendFolder(requireNotNull(folderById[course.rootFolderId])) }
            }
        }
        val actualCatalogOrder = catalog.lessons.sortedBy(Lesson::catalogOrdinal).map(Lesson::id)
        require(actualCatalogOrder == expectedWebsiteOrder) { "Catalog order does not match folder-first website order" }
    }

    private fun validatePresentation(folder: CatalogFolder) {
        val presentation = folder.presentation ?: return
        require(presentation.kind == "week" || presentation.kind == "lesson-group") {
            "Unknown folder presentation kind: ${folder.id}"
        }
        require(presentation.description.isNotBlank()) { "Folder presentation has no description: ${folder.id}" }
        if (presentation.kind == "week") {
            require(!presentation.title.isNullOrBlank() && !presentation.number.isNullOrBlank()) {
                "Week presentation is incomplete: ${folder.id}"
            }
            require(presentation.color?.let(cssColor::matches) == true) { "Week color is invalid: ${folder.id}" }
        }
        presentation.prerequisites?.let { prerequisites ->
            require(prerequisites.on1.isNotEmpty() || prerequisites.on2.isNotEmpty()) {
                "Folder prerequisites are empty: ${folder.id}"
            }
            require((prerequisites.on1 + prerequisites.on2).all { it.isNotBlank() }) {
                "Folder prerequisites contain an empty item: ${folder.id}"
            }
        }
    }

    private fun requireUniqueIds(label: String, ids: List<String>) {
        require(ids.all(String::isNotBlank)) { "$label id is blank" }
        require(ids.toSet().size == ids.size) { "Duplicate $label id" }
    }

    private fun requireContiguousOrdinals(label: String, ordinals: List<Int>) {
        require(ordinals.sorted() == ordinals.indices.toList()) { "$label ordinals are not contiguous" }
    }

    private const val EXPECTED_THEME_COUNT = 103
    private const val DEFAULT_THEME_ID = "arctic"
}
