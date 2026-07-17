package com.deadlywolf.dancelibrary

import android.view.KeyEvent as AndroidKeyEvent
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import org.junit.Rule
import org.junit.Test

class DanceLibraryAppTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<MainActivity>()

    @Test
    fun libraryUsesWebsiteCategoryAndCourseHierarchy() {
        composeRule.waitForText("Dance styles")
        composeRule.onNodeWithText("Salsa", useUnmergedTree = true).performClick()
        composeRule.waitForText("Adolfo Indacochea  Tania Cannarsa - Salsa On2 Advanced")
        composeRule.onNodeWithText("Adolfo Indacochea  Tania Cannarsa - Salsa On2 Advanced", useUnmergedTree = true).performClick()
        composeRule.waitForText("01 - Syncopation")
        composeRule.onNodeWithText("01 - Syncopation", useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun notesAndSettingsAreFirstClassDestinations() {
        composeRule.waitForText("Dance styles")
        composeRule.onNodeWithContentDescription("Notes", useUnmergedTree = true).performClick()
        composeRule.waitForText("Bookmarks & notes")
        composeRule.onNodeWithText("Bookmarks & notes").assertIsDisplayed()

        composeRule.onNodeWithContentDescription("Settings", useUnmergedTree = true).performClick()
        composeRule.waitForText("Appearance")
        composeRule.onNodeWithText("Export & import").assertIsDisplayed()
    }

    @Test
    fun lessonExposesPracticeAndTimestampBookmarkTools() {
        openFirstLesson()
        composeRule.waitForText("Bookmarks & notes")
        composeRule.onNodeWithContentDescription("Back 5 seconds").assertIsDisplayed()
        composeRule.onNodeWithText("Set A").assertIsDisplayed()
        composeRule.onNodeWithText("Mirror").assertIsDisplayed()
        composeRule.onNodeWithContentDescription("Enter theater mode").assertIsDisplayed()
        composeRule.waitUntil(timeoutMillis = 30_000L) {
            composeRule.onAllNodesWithText("Add", useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty()
        }
        composeRule.onNodeWithContentDescription("Add bookmark").assertIsEnabled().performClick()
        composeRule.waitForText("Optional note")
        composeRule.onNode(hasSetTextAction()).performTextInput("Rotation checkpoint")
        composeRule.onNodeWithText("Save").assertIsDisplayed()
    }

    @Test
    fun practiceToolsAndPausedLoopSurviveActivityRecreation() {
        openFirstLesson()
        composeRule.waitForText("Set A")

        composeRule.onNodeWithText("1.0×").assertIsEnabled().performClick()
        composeRule.onNodeWithText("Practice · 0.75×").performClick()
        composeRule.onNodeWithText("Mirror").assertIsEnabled().performClick()
        composeRule.onNodeWithText("Set A").assertIsEnabled().performClick()
        composeRule.onNodeWithText("Set B").assertIsEnabled().performClick()
        composeRule.waitForText("Clear A–B")
        composeRule.onNodeWithContentDescription("Pause video").performClick()
        composeRule.onNodeWithContentDescription("Play video").assertIsDisplayed()

        composeRule.activityRule.scenario.recreate()

        composeRule.waitForText("Mirrored")
        composeRule.onNodeWithText("0.75×").assertIsDisplayed()
        composeRule.onNodeWithText("Clear A–B").assertIsDisplayed()
        composeRule.onNodeWithContentDescription("Play video").assertIsDisplayed()

        composeRule.onNodeWithContentDescription("Next lesson").performClick()
        composeRule.waitForText("02 - Syncopation Twist")
        composeRule.onNodeWithText("0.75×").assertIsDisplayed()
        composeRule.onNodeWithText("Mirrored").assertIsDisplayed()
        composeRule.onNodeWithText("Set A").assertIsDisplayed()
    }

    @Test
    fun leavingThePlayerForSettingsKeepsTheLessonPausedOnReturn() {
        openFirstLesson()
        composeRule.waitForContentDescription("Pause video")
        composeRule.onNodeWithContentDescription("Open settings").performClick()
        composeRule.waitForText("Appearance")

        composeRule.activityRule.scenario.onActivity { activity ->
            activity.onBackPressedDispatcher.onBackPressed()
        }

        composeRule.waitForContentDescription("Play video")
        composeRule.onNodeWithContentDescription("Open settings").assertIsDisplayed()
    }

    @Test
    fun physicalKeyboardShortcutsControlPracticeAndOpenGlobalPanels() {
        openFirstLesson()
        composeRule.waitForText("Set A")

        sendKey(AndroidKeyEvent.KEYCODE_M)
        composeRule.waitForText("Mirrored")
        sendKey(AndroidKeyEvent.KEYCODE_LEFT_BRACKET)
        composeRule.waitForText("Set B")
        sendKey(AndroidKeyEvent.KEYCODE_RIGHT_BRACKET)
        composeRule.waitForText("Clear A–B")
        sendKey(AndroidKeyEvent.KEYCODE_B)
        composeRule.waitForText("Optional note")
        composeRule.onNodeWithText("Cancel").performClick()

        sendKey(AndroidKeyEvent.KEYCODE_K, AndroidKeyEvent.META_CTRL_ON)
        composeRule.waitForText("Search all lessons")
        composeRule.onNodeWithText("Close").performClick()
        sendKey(AndroidKeyEvent.KEYCODE_SLASH, AndroidKeyEvent.META_SHIFT_ON)
        composeRule.waitForText("Keyboard shortcuts")
        composeRule.onNodeWithText("Ctrl/Cmd+K").assertIsDisplayed()
    }

    private fun openFirstLesson() {
        composeRule.waitForText("Dance styles")
        composeRule.onNodeWithText("Salsa", useUnmergedTree = true).performClick()
        composeRule.waitForText("Adolfo Indacochea  Tania Cannarsa - Salsa On2 Advanced")
        composeRule.onNodeWithText("Adolfo Indacochea  Tania Cannarsa - Salsa On2 Advanced", useUnmergedTree = true).performClick()
        composeRule.waitForText("01 - Syncopation")
        composeRule.onNodeWithText("01 - Syncopation", useUnmergedTree = true).performClick()
    }

    private fun androidx.compose.ui.test.junit4.AndroidComposeTestRule<*, *>.waitForText(text: String) {
        waitUntil(timeoutMillis = 30_000L) {
            onAllNodesWithText(text, useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty()
        }
    }

    private fun androidx.compose.ui.test.junit4.AndroidComposeTestRule<*, *>.waitForContentDescription(
        description: String,
    ) {
        waitUntil(timeoutMillis = 30_000L) {
            onAllNodesWithContentDescription(description, useUnmergedTree = true)
                .fetchSemanticsNodes()
                .isNotEmpty()
        }
    }

    private fun sendKey(keyCode: Int, metaState: Int = 0) {
        composeRule.activityRule.scenario.onActivity { activity ->
            activity.dispatchKeyEvent(AndroidKeyEvent(0L, 0L, AndroidKeyEvent.ACTION_DOWN, keyCode, 0, metaState))
            activity.dispatchKeyEvent(AndroidKeyEvent(0L, 0L, AndroidKeyEvent.ACTION_UP, keyCode, 0, metaState))
        }
        composeRule.waitForIdle()
    }
}
