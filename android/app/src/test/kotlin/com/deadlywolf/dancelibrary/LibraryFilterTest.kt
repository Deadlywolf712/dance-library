package com.deadlywolf.dancelibrary

import com.deadlywolf.dancelibrary.model.lesson
import org.junit.Assert.assertEquals
import org.junit.Test

class LibraryFilterTest {
    private val salsa = lesson(catalogOrdinal = 2, categoryId = "salsa", title = "Salsa turn")
    private val bachata = lesson(
        id = "56f6047d-66f4-4e09-a219-6443ea3244b1",
        catalogOrdinal = 1,
        categoryId = "bachata",
        title = "Bachata turn",
    )

    @Test
    fun favoritesAndCategoryComposePredictably() {
        val result = filterLessons(
            lessons = listOf(salsa, bachata),
            filter = LibraryFilter(category = "Bachata", favoritesOnly = true),
            favorites = setOf(bachata.id),
        )

        assertEquals(listOf(bachata.id), result.map { it.id })
    }

    @Test
    fun catalogOrderIsStableAfterSearch() {
        val result = filterLessons(
            lessons = listOf(salsa, bachata),
            filter = LibraryFilter(query = "turn"),
            favorites = emptySet(),
        )

        assertEquals(listOf(bachata.id, salsa.id), result.map { it.id })
    }
}
