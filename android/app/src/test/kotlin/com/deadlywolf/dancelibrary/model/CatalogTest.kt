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
    fun searchIncludesCourseDisplayNameWithoutChangingStableCourse() {
        val stableCourse = "Arthur  Oksana - Zouk Beginner"
        val lesson = lesson(
            course = stableCourse,
            courseDisplayName = "Arthur & Oksana — Zouk Beginner",
        )

        assertEquals(stableCourse, lesson.course)
        assertTrue(lesson.matchesSearch("Arthur & Oksana"))
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
    fun validatorRequiresAReasonForUnavailableMedia() {
        val catalog = simpleCatalog(listOf(lesson(availability = "unavailable")))

        assertThrows(IllegalArgumentException::class.java) {
            CatalogValidator.requireValid(catalog)
        }
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
        assertEquals(3, catalog.schemaVersion)
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

        fun assertStableCourseAlias(stableName: String, displayName: String) {
            val course = catalog.courses.single { it.title == stableName }
            val rootFolder = catalog.folders.single { it.id == course.rootFolderId }
            val lessons = catalog.lessons.filter { it.courseId == course.id }

            assertEquals(displayName, course.displayName)
            assertEquals(stableName, rootFolder.name)
            assertEquals(listOf(stableName), rootFolder.pathSegments)
            assertEquals(displayName, rootFolder.displayName)
            assertTrue(lessons.isNotEmpty())
            assertTrue(lessons.all { it.course == stableName && it.courseDisplayName == displayName })
            assertTrue(lessons.all { it.legacyPath.startsWith("$stableName/") })
        }

        assertStableCourseAlias(
            "Arthur  Oksana - Zouk Beginner",
            "Arthur & Oksana — Zouk Beginner",
        )
        assertStableCourseAlias(
            "Isabelle  Felicien - Beginner",
            "Isabelle & Felicien — Kizomba Beginner",
        )
        assertStableCourseAlias(
            "Pablo  Raquel - Intermediate",
            "Pablo & Raquel — Intermediate/Advanced",
        )

        val carolinaRosaLessons = catalog.lessons.filter { it.course.startsWith("Carolina Rosa") }
        assertEquals(30, carolinaRosaLessons.size)
        assertTrue(carolinaRosaLessons.all { it.categoryId == "bachata" && it.categoryTitle == "Bachata" })
        assertFalse(catalog.lessons.any { it.course.startsWith("Carolina Rosa") && it.categoryId == "salsa" })

        val marcoEspejoLessons = catalog.lessons.filter { it.course.startsWith("Marco Espejo") }
        assertEquals(25, marcoEspejoLessons.size)
        assertTrue(marcoEspejoLessons.all { it.categoryId == "bachata" && it.categoryTitle == "Bachata" })
        assertFalse(catalog.lessons.any { it.course.startsWith("Marco Espejo") && it.categoryId == "salsa" })

        val correctedTurnsLesson = catalog.lessons.single { it.bunnyId == "889ba4f6-8181-495b-9001-ed3b40c701a2" }
        assertEquals("07 - Turns in 1/5", correctedTurnsLesson.title)
        assertEquals("Carolina Rosa - Beginner/07 - Turns in 15.mp4", correctedTurnsLesson.legacyPath)

        val correctedThreeByThreeLesson = catalog.lessons.single { it.bunnyId == "091ce8f2-de17-4eda-a1a1-bb62d048926b" }
        assertEquals("09 - 3X3 Steps", correctedThreeByThreeLesson.title)
        assertEquals("Carolina Rosa - Advanced/09 - 33 Steps.mp4", correctedThreeByThreeLesson.legacyPath)

        val unavailableLessons = catalog.lessons.filterNot(Lesson::isAvailable)
        assertEquals(1, unavailableLessons.size)
        assertEquals(
            "Salsa Masterclass/Week 3/Spot Overturn/Spot Overturn - Explanation On2.mp4",
            unavailableLessons.single().legacyPath,
        )
        assertTrue(unavailableLessons.single().availabilityReason.orEmpty().contains("exact duplicate"))
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
            listOf(TEST_COURSE_DISPLAY_NAME),
            tree.nodesAt(BrowseLocation.Category(TEST_CATEGORY_ID)).map(BrowseNode::title),
        )
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
    courseDisplayName: String = if (course == TEST_COURSE_TITLE) TEST_COURSE_DISPLAY_NAME else course,
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
    availability: String = "available",
    availabilityReason: String? = null,
    catalogOrdinal: Int = 0,
    sortOrdinal: Int = 0,
    chapters: List<LessonChapter> = emptyList(),
    rawSummary: String = "",
): Lesson = Lesson(
    id = id,
    legacyPath = (listOf(course) + breadcrumbs + "$title.mp4").joinToString("/"),
    categoryId = categoryId,
    categoryTitle = categoryTitle,
    courseId = courseId,
    folderId = folderId,
    breadcrumbs = breadcrumbs,
    course = course,
    courseDisplayName = courseDisplayName,
    playlistId = playlistId,
    title = title,
    availability = availability,
    availabilityReason = availabilityReason,
    sortOrdinal = sortOrdinal,
    catalogOrdinal = catalogOrdinal,
    bunnyId = id,
    collectionId = "30595781-8972-4091-8b85-acba26bde7e3",
    rawSummary = rawSummary,
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
    schemaVersion = 3,
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
            displayName = TEST_COURSE_DISPLAY_NAME,
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
    displayName: String = if (parentId == null) TEST_COURSE_DISPLAY_NAME else pathSegments.last(),
    directLessonCount: Int = 1,
    lessonCount: Int = 1,
    childFolderCount: Int = 0,
): CatalogFolder = CatalogFolder(
    id = id,
    parentId = parentId,
    categoryId = TEST_CATEGORY_ID,
    courseId = TEST_COURSE_ID,
    name = pathSegments.last(),
    displayName = displayName,
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
private const val TEST_COURSE_DISPLAY_NAME = "Test Salsa Course Display"
private const val ROOT_FOLDER_ID = "folder-root"
private const val CHILD_FOLDER_ID = "folder-child"
