package com.deadlywolf.dancelibrary.ui

internal data class CourseDisplay(val title: String, val teacher: String = "", val level: String = "") {
    val heading: String get() = listOf(title, level).filter(String::isNotBlank).joinToString(" · ")
    val levelRank: Int get() = when {
        level.equals("Beginner", ignoreCase = true) -> 1
        level.startsWith("Beginner", ignoreCase = true) -> 2
        level.equals("Intermediate", ignoreCase = true) -> 3
        level.startsWith("Intermediate", ignoreCase = true) -> 4
        level.equals("Advanced", ignoreCase = true) -> 5
        else -> 6
    }
}

internal val courseDisplayOrder: Comparator<CourseDisplay> = compareBy<CourseDisplay, String>(String.CASE_INSENSITIVE_ORDER) { it.teacher }
    .thenBy(String.CASE_INSENSITIVE_ORDER) { it.title }
    .thenBy { it.levelRank }

// Presentation only: catalog IDs, paths, ordering, and backup keys remain unchanged.
internal fun courseDisplay(name: String, category: String = ""): CourseDisplay {
    val separator = Regex("\\s+[-–—]\\s+").find(name) ?: return CourseDisplay(name)
    val teacher = name.substring(0, separator.range.first).replace(Regex("\\s{2,}"), " & ")
    val description = name.substring(separator.range.last + 1).trim()
    // Aliases supplied by the catalog can correct a raw folder's level. Accept
    // their typographic separators without changing the stable catalog names.
    val levelMatch = Regex("(?:\\(|\\b)(Beginner(?:\\s*[-–—/]?\\s*Intermediate)?|Intermediate(?:\\s*[-–—/]?\\s*Advanced)?|Advanced|Open\\s+Level)\\)?$", RegexOption.IGNORE_CASE).find(description)
    val level = levelMatch?.groupValues?.get(1).orEmpty().replace(Regex("\\s*[-–—/]?\\s*(Intermediate|Advanced)", RegexOption.IGNORE_CASE), "–$1").removePrefix("–")
    val title = (levelMatch?.range?.first?.let { description.substring(0, it).trim() } ?: description)
        .ifBlank { category.ifBlank { "Course" } }
    return CourseDisplay(title, teacher, level)
}
