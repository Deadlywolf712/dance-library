package com.deadlywolf.dancelibrary.model

sealed interface BrowseLocation {
    data object Root : BrowseLocation
    data class Category(val categoryId: String) : BrowseLocation
    data class Folder(val folderId: String) : BrowseLocation
}

sealed interface BrowseNode {
    val id: String
    val title: String
    val lessonCount: Int

    data class Category(val category: CatalogCategory) : BrowseNode {
        override val id: String = category.id
        override val title: String = category.title
        override val lessonCount: Int = category.lessonCount
    }

    data class Folder(val folder: CatalogFolder) : BrowseNode {
        override val id: String = folder.id
        override val title: String = folder.name
        override val lessonCount: Int = folder.lessonCount
    }

    data class Lesson(val lesson: com.deadlywolf.dancelibrary.model.Lesson) : BrowseNode {
        override val id: String = lesson.id
        override val title: String = lesson.title
        override val lessonCount: Int = 1
    }
}

/**
 * Indexed, immutable view of the exported website hierarchy.
 *
 * Normal browsing is folder-first: child folders are returned before lessons that live directly
 * in the current folder, matching app.js. Search and favorites can keep using [DanceCatalog.lessons].
 */
class CatalogTree(val catalog: DanceCatalog) {
    val categoryById: Map<String, CatalogCategory> = catalog.categories.associateBy(CatalogCategory::id)
    val courseById: Map<String, CatalogCourse> = catalog.courses.associateBy(CatalogCourse::id)
    val folderById: Map<String, CatalogFolder> = catalog.folders.associateBy(CatalogFolder::id)
    val lessonById: Map<String, Lesson> = catalog.lessons.associateBy(Lesson::id)

    val categories: List<CatalogCategory> = catalog.categories
        .sortedWith(compareBy(CatalogCategory::sortOrdinal, CatalogCategory::id))

    val rootNodes: List<BrowseNode> = categories.map(BrowseNode::Category)

    private val coursesByCategory: Map<String, List<CatalogCourse>> = catalog.courses
        .groupBy(CatalogCourse::categoryId)
        .mapValues { (_, courses) -> courses.sortedWith(compareBy(CatalogCourse::sortOrdinal, CatalogCourse::id)) }

    private val childFoldersByParent: Map<String, List<CatalogFolder>> = catalog.folders
        .filter { it.parentId != null }
        .groupBy { requireNotNull(it.parentId) }
        .mapValues { (_, folders) -> folders.sortedWith(compareBy(CatalogFolder::sortOrdinal, CatalogFolder::id)) }

    private val orderedLessons: List<Lesson> = catalog.lessons
        .sortedWith(compareBy(Lesson::catalogOrdinal, Lesson::id))

    private val directLessonsByFolder: Map<String, List<Lesson>> = orderedLessons
        .groupBy(Lesson::folderId)
        .mapValues { (_, lessons) -> lessons.sortedWith(compareBy(Lesson::sortOrdinal, Lesson::legacyPath)) }

    private val lessonsUnderFolder: Map<String, List<Lesson>> = buildMap {
        val mutableRollups = HashMap<String, MutableList<Lesson>>()
        for (lesson in orderedLessons) {
            var current = folderById[lesson.folderId]
            while (current != null) {
                mutableRollups.getOrPut(current.id, ::mutableListOf).add(lesson)
                current = current.parentId?.let(folderById::get)
            }
        }
        for (folder in catalog.folders) {
            put(folder.id, mutableRollups[folder.id]?.toList().orEmpty())
        }
    }

    fun nodesAt(location: BrowseLocation): List<BrowseNode> = when (location) {
        BrowseLocation.Root -> rootNodes
        is BrowseLocation.Category -> rootFoldersInCategory(location.categoryId).map(BrowseNode::Folder)
        is BrowseLocation.Folder -> buildList {
            addAll(childFolders(location.folderId).map(BrowseNode::Folder))
            addAll(directLessons(location.folderId).map(BrowseNode::Lesson))
        }
    }

    fun coursesInCategory(categoryId: String): List<CatalogCourse> = coursesByCategory[categoryId].orEmpty()

    fun rootFoldersInCategory(categoryId: String): List<CatalogFolder> = coursesInCategory(categoryId)
        .mapNotNull { course -> folderById[course.rootFolderId] }

    fun childFolders(folderId: String): List<CatalogFolder> = childFoldersByParent[folderId].orEmpty()

    fun directLessons(folderId: String): List<Lesson> = directLessonsByFolder[folderId].orEmpty()

    fun lessonsUnder(folderId: String): List<Lesson> = lessonsUnderFolder[folderId].orEmpty()

    fun folderBreadcrumb(folderId: String): List<CatalogFolder> {
        val folders = ArrayDeque<CatalogFolder>()
        var current = folderById[folderId]
        while (current != null) {
            folders.addFirst(current)
            current = current.parentId?.let(folderById::get)
        }
        return folders.toList()
    }

    fun browseBreadcrumb(folderId: String): List<BrowseNode> {
        val folder = folderById[folderId] ?: return emptyList()
        val category = categoryById[folder.categoryId] ?: return emptyList()
        return buildList {
            add(BrowseNode.Category(category))
            addAll(folderBreadcrumb(folderId).map(BrowseNode::Folder))
        }
    }

    fun categoryForFolder(folderId: String): CatalogCategory? = folderById[folderId]
        ?.categoryId
        ?.let(categoryById::get)

    fun courseForFolder(folderId: String): CatalogCourse? = folderById[folderId]
        ?.courseId
        ?.let(courseById::get)
}
