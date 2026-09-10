@file:androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)

package com.deadlywolf.dancelibrary

import android.view.KeyEvent as AndroidKeyEvent
import android.view.View
import android.view.ViewGroup
import android.util.Log
import androidx.media3.common.Player
import androidx.media3.ui.PlayerView
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasScrollToNodeAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.semantics.SemanticsProperties
import org.junit.Rule
import org.junit.Test
import org.junit.After
import org.junit.rules.TestName
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import kotlin.math.abs

class DanceLibraryAppTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<MainActivity>()
    @get:Rule val scenarioName = TestName()

    @After fun captureScreen() = captureInstrumentationScreenshot("DanceLibraryAppTest-${scenarioName.methodName}")

    @Test
    fun libraryUsesWebsiteCategoryAndCourseHierarchy() {
        openFirstCourse()
        composeRule.waitForText("01 - Syncopation")
        composeRule.onNodeWithText("01 - Syncopation", useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun notesAndSettingsAreFirstClassDestinations() {
        composeRule.waitForContentDescription("Notebook")
        val notebook = composeRule.onNodeWithContentDescription("Notebook", useUnmergedTree = true)
        if (composeRule.activity.resources.configuration.screenWidthDp >= 840) notebook.performScrollTo()
        notebook.performClick()
        composeRule.waitForText("Search lessons and notes")
        composeRule.onNodeWithText("Search lessons and notes").assertIsDisplayed()

        val settings = composeRule.onNodeWithContentDescription("Settings", useUnmergedTree = true)
        if (composeRule.activity.resources.configuration.screenWidthDp >= 840) settings.performScrollTo()
        settings.performClick()
        composeRule.waitForText("Export & import")
        composeRule.onNodeWithText("Export & import").assertIsDisplayed()
        scrollSettingsTo("Save JSON backup")
        composeRule.onNodeWithText("Save JSON backup").assertIsDisplayed()
        scrollSettingsTo("Choose what to export")
        composeRule.onNodeWithText("Choose what to export").performClick()
        scrollSettingsTo("Whole library")
        composeRule.onNodeWithText("Whole library").assertIsDisplayed()
        scrollSettingsTo("Streaming server")
        composeRule.onNodeWithText("Streaming server").performClick()
        scrollSettingsTo("Save server")
        composeRule.onNodeWithText("Save server").assertIsDisplayed()
    }

    @Test
    fun lessonExposesPracticeAndTimestampBookmarkTools() {
        openFirstLesson()
        composeRule.waitForContentDescription("My notes")
        composeRule.onNodeWithContentDescription("Back 5 seconds").assertIsDisplayed()
        composeRule.onNodeWithContentDescription("Set A").assertIsDisplayed()
        composeRule.onNodeWithContentDescription("Mirror").assertIsDisplayed()
        composeRule.onNodeWithContentDescription("Enter theater mode").assertIsDisplayed()
        val transportRows = listOf("Previous lesson", "Back 5 seconds", "Forward 5 seconds", "Next lesson")
            .map { composeRule.onNodeWithContentDescription(it).fetchSemanticsNode().boundsInRoot.center.y }
        assertTrue("Transport controls must share one row", transportRows.max() - transportRows.min() < 2f)
        composeRule.waitForContentDescription("Add bookmark")
        composeRule.onNodeWithContentDescription("Add bookmark").assertIsEnabled().performClick()
        composeRule.waitForText("Optional note")
        composeRule.onNode(hasSetTextAction() and hasText("Optional note")).performTextInput("Rotation checkpoint")
        composeRule.onNodeWithText("Save").assertIsDisplayed()
    }

    @Test
    fun practiceToolsAndPausedLoopSurviveActivityRecreation() {
        openFirstLesson()
        composeRule.waitForContentDescription("Set A")

        composeRule.onNodeWithText("1.0×").assertIsEnabled().performClick()
        composeRule.onNodeWithText("Practice · 0.75×").performClick()
        composeRule.onNodeWithContentDescription("Mirror").assertIsEnabled().performClick()
        composeRule.onNodeWithContentDescription("Set A").assertIsEnabled().performClick()
        composeRule.onNodeWithContentDescription("Set B").assertIsEnabled().performClick()
        composeRule.waitForContentDescription("Clear A–B")
        composeRule.onNodeWithContentDescription("Pause video").performClick()
        composeRule.onNodeWithContentDescription("Play video").assertIsDisplayed()

        composeRule.activityRule.scenario.recreate()

        composeRule.waitForContentDescription("Mirrored")
        composeRule.onNodeWithText("0.75×").assertIsDisplayed()
        composeRule.onNodeWithContentDescription("Clear A–B").assertIsDisplayed()
        composeRule.onNodeWithContentDescription("Play video").assertIsDisplayed()

        composeRule.onNodeWithContentDescription("Next lesson").performClick()
        composeRule.waitForText("02 - Syncopation Twist")
        composeRule.onNodeWithText("0.75×").assertIsDisplayed()
        composeRule.onNodeWithContentDescription("Mirrored").assertIsDisplayed()
        composeRule.onNodeWithContentDescription("Set A").assertIsDisplayed()
    }

    @Test
    fun leavingThePlayerForSettingsKeepsTheLessonPausedOnReturn() {
        openFirstLesson()
        composeRule.waitForContentDescription("Pause video")
        composeRule.onNodeWithContentDescription("Open settings").performClick()
        composeRule.waitForText("Export & import")

        composeRule.activityRule.scenario.onActivity { activity ->
            activity.onBackPressedDispatcher.onBackPressed()
        }

        composeRule.waitForContentDescription("Play video")
        composeRule.onNodeWithContentDescription("Open settings").assertIsDisplayed()
    }

    @Test
    fun physicalKeyboardShortcutsControlPracticeAndOpenGlobalPanels() {
        openFirstLesson()
        composeRule.waitForContentDescription("Set A")

        sendKey(AndroidKeyEvent.KEYCODE_M)
        composeRule.waitForContentDescription("Mirrored")
        sendKey(AndroidKeyEvent.KEYCODE_LEFT_BRACKET)
        composeRule.waitForContentDescription("Set B")
        sendKey(AndroidKeyEvent.KEYCODE_RIGHT_BRACKET)
        composeRule.waitForContentDescription("Clear A–B")
        sendKey(AndroidKeyEvent.KEYCODE_B)
        composeRule.waitForText("Optional note")
        composeRule.onNodeWithText("Close").performClick()

        sendKey(AndroidKeyEvent.KEYCODE_K, AndroidKeyEvent.META_CTRL_ON)
        composeRule.waitForText("Search all lessons")
        composeRule.onNodeWithText("Close").performClick()
        sendKey(AndroidKeyEvent.KEYCODE_SLASH, AndroidKeyEvent.META_SHIFT_ON)
        composeRule.waitForText("Keyboard shortcuts")
        composeRule.onNodeWithText("Ctrl/Cmd+K").assertIsDisplayed()
    }

    @Test
    fun realStreamRendersAndAdvancesThenRestoresPausedPosition() {
        openFirstLesson()
        composeRule.waitUntil(timeoutMillis = 60_000L) {
            composeRule.runOnUiThread {
                val player = findPlayerView(composeRule.activity.window.decorView)?.player
                player != null && player.playbackState == Player.STATE_READY && player.currentPosition >= 6_000L && player.videoSize.width > 0
            }
        }
        val first = composeRule.runOnUiThread { requireNotNull(findPlayerView(composeRule.activity.window.decorView)?.player).currentPosition }
        composeRule.waitUntil(timeoutMillis = 10_000L) {
            composeRule.runOnUiThread { (findPlayerView(composeRule.activity.window.decorView)?.player?.currentPosition ?: 0L) >= first + 1_000L }
        }
        composeRule.runOnUiThread {
            val view = requireNotNull(findPlayerView(composeRule.activity.window.decorView))
            val player = requireNotNull(view.player)
            Log.i("PlaybackEvidence", "Decoded video ${player.videoSize.width}x${player.videoSize.height}; position=${player.currentPosition}; duration=${player.duration}; playing=${player.isPlaying}")
            view.hideController()
        }
        captureInstrumentationScreenshot("native-live-video-frame")
        composeRule.onNodeWithContentDescription("Pause video").performClick()
        val paused = composeRule.runOnUiThread { requireNotNull(findPlayerView(composeRule.activity.window.decorView)?.player).currentPosition }
        composeRule.activityRule.scenario.recreate()
        composeRule.waitUntil(timeoutMillis = 60_000L) {
            composeRule.runOnUiThread {
                val player = findPlayerView(composeRule.activity.window.decorView)?.player
                player != null && player.playbackState == Player.STATE_READY && player.currentPosition > 0
            }
        }
        composeRule.runOnUiThread {
            val player = requireNotNull(findPlayerView(composeRule.activity.window.decorView)?.player)
            assertFalse(player.playWhenReady)
            assertTrue("Paused position $paused should restore, got ${player.currentPosition}", abs(player.currentPosition - paused) < 1_500L)
            Log.i("PlaybackEvidence", "Recreated paused position=${player.currentPosition}; expected=$paused; playing=${player.isPlaying}")
        }
    }

    private fun openFirstLesson() {
        openFirstCourse()
        scrollLibraryTo("01 - Syncopation")
        composeRule.onNodeWithText("01 - Syncopation", useUnmergedTree = true).performClick()
    }

    private fun openFirstCourse() {
        composeRule.waitForContentDescription("Notebook")
        scrollLibraryTo("Salsa")
        composeRule.onNodeWithText("Salsa", useUnmergedTree = true).performClick()
        val course = "Adolfo Indacochea  Tania Cannarsa - Salsa On2 Advanced"
        composeRule.onAllNodes(hasScrollToNodeAction() and SemanticsMatcher.keyIsDefined(SemanticsProperties.VerticalScrollAxisRange)).onFirst().performScrollToNode(hasContentDescription(course))
        composeRule.onNodeWithContentDescription(course).performClick()
    }

    private fun scrollLibraryTo(text: String) {
        composeRule.onAllNodes(hasScrollToNodeAction() and SemanticsMatcher.keyIsDefined(SemanticsProperties.VerticalScrollAxisRange)).onFirst().performScrollToNode(hasText(text))
    }

    private fun scrollSettingsTo(text: String) {
        composeRule.onNode(hasScrollToNodeAction() and SemanticsMatcher.keyIsDefined(SemanticsProperties.VerticalScrollAxisRange)).performScrollToNode(hasText(text))
        composeRule.onNodeWithText(text).performScrollTo()
    }

    private fun findPlayerView(view: View): PlayerView? {
        if (view is PlayerView) return view
        if (view is ViewGroup) for (index in 0 until view.childCount) findPlayerView(view.getChildAt(index))?.let { return it }
        return null
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
