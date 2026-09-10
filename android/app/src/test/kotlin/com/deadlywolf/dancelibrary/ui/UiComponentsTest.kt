package com.deadlywolf.dancelibrary.ui

import com.deadlywolf.dancelibrary.LibraryUiState
import com.deadlywolf.dancelibrary.model.BrowseNode
import com.deadlywolf.dancelibrary.model.CatalogCategory
import com.deadlywolf.dancelibrary.model.lesson
import org.junit.Assert.assertEquals
import org.junit.Test

class UiComponentsTest {
    @Test
    fun coursesKeepTeacherGroupsAndAdvanceThroughLearningLevels() {
        val names = listOf("Zoe - Salsa Beginner", "Ana - Salsa Advanced", "Ana - Salsa Intermediate Advanced", "Ana - Salsa Beginner", "Ana - Salsa Intermediate", "Ana - Salsa Beginner Intermediate")
        val sorted = names.map { courseDisplay(it) }.sortedWith(courseDisplayOrder)
        assertEquals(listOf("Beginner", "Beginner–Intermediate", "Intermediate", "Intermediate–Advanced", "Advanced", "Beginner"), sorted.map(CourseDisplay::level))
        assertEquals(listOf("Ana", "Ana", "Ana", "Ana", "Ana", "Zoe"), sorted.map(CourseDisplay::teacher))
    }

    @Test
    fun courseLabelsKeepTeachersSeparateFromTitleAndLevel() {
        val display = courseDisplay("Fernando Sosa  Tatiana Bonaguro - Sosa Style Beginner")
        assertEquals("Sosa Style · Beginner", display.heading)
        assertEquals("Fernando Sosa & Tatiana Bonaguro", display.teacher)
        assertEquals("Bachata · Beginner–Intermediate", courseDisplay("Teachers - Bachata Beginner Intermediate").heading)
        assertEquals("Bachata · Advanced", courseDisplay("Carolina Rosa - Advanced", "Bachata").heading)
        assertEquals("Salsa Masterclass", courseDisplay("Salsa Masterclass").heading)
        assertEquals("", courseDisplay("Salsa Masterclass").teacher)
    }

    @Test
    fun catalogAliasesPreserveCorrectedLevelsAndSeparateTeacherNames() {
        val corrected = courseDisplay("Pablo & Raquel — Intermediate/Advanced", "Bachata")
        assertEquals("Pablo & Raquel", corrected.teacher)
        assertEquals("Bachata · Intermediate–Advanced", corrected.heading)
        assertEquals(4, corrected.levelRank)
        assertEquals("Smooth Bachata · Intermediate–Advanced", courseDisplay("Pablo & Raquel — Smooth Bachata Intermediate/Advanced", "Bachata").heading)
        assertEquals("Zouk · Beginner–Intermediate", courseDisplay("Arthur & Oksana — Zouk Beginner–Intermediate", "Zouk").heading)
        assertEquals("Bachata · Beginner–Intermediate", courseDisplay("Korke & Judith — Beginner/Intermediate", "Bachata").heading)
    }

    @Test
    fun parenthesizedLevelsKeepTheDistinctiveCourseTitle() {
        assertEquals("Fundamentals of Bachata Sensual · Beginner", courseDisplay("Korke & Judith — Fundamentals of Bachata Sensual (Beginner)", "Bachata").heading)
        assertEquals("Bachata Sensual 2025: New Techniques and Cadences · Intermediate–Advanced", courseDisplay("Korke & Judith — Bachata Sensual 2025: New Techniques and Cadences (Intermediate/Advanced)", "Bachata").heading)
        assertEquals("Marco Espejo Style · Open Level", courseDisplay("Marco Espejo — Marco Espejo Style (Open Level)", "Bachata").heading)
        assertEquals("Bachata Sensual Combinations", courseDisplay("Kike & Nahir — Bachata Sensual Combinations", "Bachata").heading)
    }

    @Test
    fun browseCountUsesVisibleLessonRollupsInsteadOfTheWholeCatalog() {
        val styleNodes = listOf(
            BrowseNode.Category(CatalogCategory("salsa", "Salsa", 0, 165, 8, 8)),
            BrowseNode.Category(CatalogCategory("bachata", "Bachata", 1, 319, 15, 15)),
        )
        assertEquals("484 lessons", browseSubtitle(LibraryUiState(browseNodes = styleNodes)))
        assertEquals("1 lesson", browseSubtitle(LibraryUiState(browseNodes = listOf(BrowseNode.Lesson(lesson())))))
        assertEquals("0 lessons", browseSubtitle(LibraryUiState()))
    }

    @Test
    fun searchHeaderReportsMatchesRatherThanCategoryRollups() {
        val matches = listOf(BrowseNode.Lesson(lesson()))
        assertEquals("1 search result", browseSubtitle(LibraryUiState(query = "syncopation", browseNodes = matches)))
        assertEquals("0 search results", browseSubtitle(LibraryUiState(query = "no match")))
    }

    @Test
    fun relativeTimeUsesCompactWebsiteStyleLabels() {
        val now = 1_000_000_000L
        assertEquals("just now", formatRelativeTime(now - 10_000L, now))
        assertEquals("2m ago", formatRelativeTime(now - 120_000L, now))
        assertEquals("3h ago", formatRelativeTime(now - 10_800_000L, now))
        assertEquals("2d ago", formatRelativeTime(now - 172_800_000L, now))
    }
}
