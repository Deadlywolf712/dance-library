package com.deadlywolf.dancelibrary.ui

import org.junit.Assert.assertEquals
import org.junit.Test

class UiComponentsTest {
    @Test
    fun relativeTimeUsesCompactWebsiteStyleLabels() {
        val now = 1_000_000_000L
        assertEquals("just now", formatRelativeTime(now - 10_000L, now))
        assertEquals("2m ago", formatRelativeTime(now - 120_000L, now))
        assertEquals("3h ago", formatRelativeTime(now - 10_800_000L, now))
        assertEquals("2d ago", formatRelativeTime(now - 172_800_000L, now))
    }
}
