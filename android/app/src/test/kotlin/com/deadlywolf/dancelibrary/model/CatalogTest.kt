package com.deadlywolf.dancelibrary.model

import com.deadlywolf.dancelibrary.data.CatalogValidator
import com.google.gson.Gson
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class CatalogTest {
    @Test
    fun streamUrlUsesBunnyIdAndNormalizesHost() {
        val lesson = lesson()

        assertEquals(
            "https://vz-example.b-cdn.net/${lesson.id}/playlist.m3u8",
            lesson.streamUrl("https://vz-example.b-cdn.net/"),
        )
    }

    @Test
    fun searchRequiresEveryTermAcrossLessonMetadata() {
        val lesson = lesson(title = "03 - Cross Body Lead", course = "Adolfo - Salsa On2")

        assertTrue(lesson.matchesSearch("salsa cross"))
        assertTrue(lesson.matchesSearch("ADOLFO on2"))
        assertFalse(lesson.matchesSearch("salsa bachata"))
    }

    @Test
    fun searchIgnoresAccents() {
        val lesson = lesson(course = "Alex Desirée - Salsa Partnerwork")

        assertTrue(lesson.matchesSearch("desiree"))
        assertTrue(lesson.matchesSearch("DÉSIRÉE"))
    }

    @Test
    fun validatorRejectsDuplicateBunnyIds() {
        val duplicate = lesson()
        val catalog = simpleCatalog(listOf(duplicate, duplicate))

        assertThrows(IllegalArgumentException::class.java) {
            CatalogValidator.requireValid(catalog)
        }
    }

    @Test
    fun validatorAcceptsOrderedChapters() {
        val catalog = simpleCatalog(
            listOf(
                lesson(
                    chapters = listOf(
                        LessonChapter(10, "00:10", "Start", "Begin"),
                        LessonChapter(20, "00:20", "Next", "Continue"),
                    ),
                ),
            ),
        )

        CatalogValidator.requireValid(catalog)
    }

    @Test
    fun generatedCatalogHasCompleteWebsiteHierarchyAndThemes() {
        val asset = sequenceOf(
            File("src/main/assets/catalog.json"),
            File("app/src/main/assets/catalog.json"),
            File("android/app/src/main/assets/catalog.json"),
        ).firstOrNull(File::isFile)
        assertTrue("Could not locate generated catalog.json from ${File(".").absolutePath}", asset != null)
        val catalog = Gson().fromJson(requireNotNull(asset).readText(Charsets.UTF_8), DanceCatalog::class.java)

        CatalogValidator.requireValid(catalog)
        assertEquals(2, catalog.schemaVersion)
        assertEquals(795, catalog.lessons.size)
        assertEquals(6, catalog.categories.size)
        assertEquals(34, catalog.courses.size)
        assertEquals(97, catalog.folders.size)
        assertEquals(88, catalog.folders.count { it.directLessonCount > 0 })
        assertEquals(103, catalog.themes.size)
        assertEquals("arctic", catalog.defaultThemeId)
        assertEquals(53, catalog.folders.count { it.presentation != null })
        assertEquals(6, catalog.folders.count { it.presentation?.kind == "week" })
        assertEquals(47, catalog.folders.count { it.presentation?.kind == "lesson-group" })
        assertEquals("Multiply Your Moves", catalog.courses.single { it.title == "Salsa Masterclass" }.presentation?.title)
    }

    @Test
    fun catalogTreeReturnsFoldersBeforeDirectLessonsAndKeepsRollups() {
        val rootFolder = testFolder(
            id = ROOT_FOLDER_ID,
            pathSegments = listOf(TEST_COURSE_TITLE),
            directLessonCount = 1,
            lessonCount = 2,
            childFolderCount = 1,
        )
        val childFolder = testFolder(
            id = CHILD_FOLDER_ID,
            parentId = ROOT_FOLDER_ID,
            pathSegments = listOf(TEST_COURSE_TITLE, "Module 1"),
            directLessonCount = 1,
            lessonCount = 1,
        )
        val nested = lesson(
            id = "d3d19660-b755-4e0b-a3a4-78701b19c2d1",
            title = "Nested lesson",
            folderId = CHILD_FOLDER_ID,
            breadcrumbs = listOf("Module 1"),
            playlistId = "playlist-child",
            catalogOrdinal = 0,
        )
        val direct = lesson(
            id = "3ddb95a0-e94c-40d2-b9f3-17e65e8c0834",
            title = "Direct lesson",
            folderId = ROOT_FOLDER_ID,
            playlistId = "playlist-root",
            catalogOrdinal = 1,
        )
        val catalog = catalogFixture(
            lessons = listOf(direct, nested),
            folders = listOf(rootFolder, childFolder),
        )
        CatalogValidator.requireValid(catalog)
        val tree = CatalogTree(catalog)

        assertEquals(listOf(TEST_CATEGORY_ID), tree.rootNodes.map(BrowseNode::id))
        assertEquals(listOf(ROOT_FOLDER_ID), tree.nodesAt(BrowseLocation.Category(TEST_CATEGORY_ID)).map(BrowseNode::id))
        assertEquals(
            listOf(CHILD_FOLDER_ID, direct.id),
            tree.nodesAt(BrowseLocation.Folder(ROOT_FOLDER_ID)).map(BrowseNode::id),
        )
        assertEquals(listOf(nested.id, direct.id), tree.lessonsUnder(ROOT_FOLDER_ID).map(Lesson::id))
        assertEquals(listOf(ROOT_FOLDER_ID, CHILD_FOLDER_ID), tree.folderBreadcrumb(CHILD_FOLDER_ID).map(CatalogFolder::id))
    }
}

internal fun lesson(
    id: String = "9b0a1d6a-da85-4a75-92f8-8cc8d62abe96",
    title: String = "01 - Syncopation",
    course: String = TEST_COURSE_TITLE,
    categoryId: String = TEST_CATEGORY_ID,
    categoryTitle: String = when (categoryId) {
        "bachata" -> "Bachata"
        "zouk" -> "Zouk"
        "kizomba" -> "Kizomba"
        "salsa-masterclass" -> "Salsa Masterclass"
        "kizomba-masterclass" -> "Kizomba Masterclass"
        else -> "Salsa"
    },
    courseId: String = TEST_COURSE_ID,
    folderId: String = ROOT_FOLDER_ID,
    breadcrumbs: List<String> = emptyList(),
    playlistId: String = "playlist-root",
    catalogOrdinal: Int = 0,
    sortOrdinal: Int = 0,
    chapters: List<LessonChapter> = emptyList(),
): Lesson = Lesson(
    id = id,
    legacyPath = (listOf(course) + breadcrumbs + "$title.mp4").joinToString("/"),
    categoryId = categoryId,
    categoryTitle = categoryTitle,
    courseId = courseId,
    folderId = folderId,
    breadcrumbs = breadcrumbs,
    course = course,
    playlistId = playlistId,
    title = title,
    sortOrdinal = sortOrdinal,
    catalogOrdinal = catalogOrdinal,
    bunnyId = id,
    collectionId = "30595781-8972-4091-8b85-acba26bde7e3",
    rawSummary = "",
    introParagraphs = emptyList(),
    chapters = chapters,
)

private fun simpleCatalog(lessons: List<Lesson>): DanceCatalog = catalogFixture(
    lessons = lessons,
    folders = listOf(
        testFolder(
            directLessonCount = lessons.size,
            lessonCount = lessons.size,
        ),
    ),
)

private fun catalogFixture(
    lessons: List<Lesson>,
    folders: List<CatalogFolder>,
): DanceCatalog = DanceCatalog(
    schemaVersion = 2,
    sourceSha256 = "a".repeat(64),
    pullZoneHost = "vz-example.b-cdn.net",
    lessonCount = lessons.size,
    summaryCount = lessons.size,
    chapterCount = lessons.sumOf { it.chapters.size },
    introParagraphCount = lessons.sumOf { it.introParagraphs.size },
    defaultThemeId = "arctic",
    themes = testThemes(),
    categories = listOf(
        CatalogCategory(
            id = TEST_CATEGORY_ID,
            title = "Salsa",
            sortOrdinal = 0,
            lessonCount = lessons.size,
            courseCount = 1,
            folderCount = folders.size,
        ),
    ),
    courses = listOf(
        CatalogCourse(
            id = TEST_COURSE_ID,
            categoryId = TEST_CATEGORY_ID,
            rootFolderId = ROOT_FOLDER_ID,
            title = TEST_COURSE_TITLE,
            sortOrdinal = 0,
            lessonCount = lessons.size,
            folderCount = folders.size,
            presentation = null,
        ),
    ),
    folders = folders,
    lessons = lessons,
)

private fun testFolder(
    id: String = ROOT_FOLDER_ID,
    parentId: String? = null,
    pathSegments: List<String> = listOf(TEST_COURSE_TITLE),
    directLessonCount: Int = 1,
    lessonCount: Int = 1,
    childFolderCount: Int = 0,
): CatalogFolder = CatalogFolder(
    id = id,
    parentId = parentId,
    categoryId = TEST_CATEGORY_ID,
    courseId = TEST_COURSE_ID,
    name = pathSegments.last(),
    pathSegments = pathSegments,
    sortOrdinal = 0,
    directLessonCount = directLessonCount,
    lessonCount = lessonCount,
    childFolderCount = childFolderCount,
    presentation = null,
)

private fun testThemes(): List<ThemeSpec> = List(103) { index ->
    ThemeSpec(
        id = if (index == 0) "arctic" else "theme-$index",
        name = if (index == 0) "Arctic (Default)" else "Theme $index",
        sortOrdinal = index,
        cssVariables = ThemeCssVariables.required.associateWith { "#123456" },
    )
}

private const val TEST_CATEGORY_ID = "salsa"
private const val TEST_COURSE_ID = "test-course"
private const val TEST_COURSE_TITLE = "Test Salsa Course"
private const val ROOT_FOLDER_ID = "folder-root"
private const val CHILD_FOLDER_ID = "folder-child"
