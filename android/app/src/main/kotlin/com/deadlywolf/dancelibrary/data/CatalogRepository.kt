package com.deadlywolf.dancelibrary.data

import android.content.Context
import com.deadlywolf.dancelibrary.model.DanceCatalog
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

    fun requireValid(catalog: DanceCatalog) {
        require(catalog.schemaVersion == 1) { "Unsupported catalog schema ${catalog.schemaVersion}" }
        require(hostname.matches(catalog.pullZoneHost)) { "Catalog pull zone is not a Bunny CDN hostname" }
        require(catalog.lessonCount == catalog.lessons.size) { "Catalog lesson count does not match payload" }
        require(catalog.lessons.isNotEmpty()) { "Catalog contains no lessons" }

        val ids = HashSet<String>(catalog.lessons.size)
        catalog.lessons.forEach { lesson ->
            require(runCatching { UUID.fromString(lesson.id) }.isSuccess) { "Invalid lesson id: ${lesson.id}" }
            require(lesson.id == lesson.bunnyId) { "Lesson id and Bunny id diverged: ${lesson.id}" }
            require(ids.add(lesson.id)) { "Duplicate lesson id: ${lesson.id}" }
            require(lesson.title.isNotBlank() && lesson.course.isNotBlank()) { "Lesson metadata is incomplete: ${lesson.id}" }
            require(lesson.legacyPath.isNotBlank()) { "Lesson path is missing: ${lesson.id}" }
            require(lesson.chapters.zipWithNext().all { (a, b) -> a.seconds < b.seconds }) {
                "Lesson chapters are not strictly ordered: ${lesson.id}"
            }
        }
    }
}
