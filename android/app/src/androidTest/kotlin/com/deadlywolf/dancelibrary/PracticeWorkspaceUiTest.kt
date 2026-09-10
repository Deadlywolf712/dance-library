package com.deadlywolf.dancelibrary

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.espresso.Espresso.closeSoftKeyboard
import com.deadlywolf.dancelibrary.data.PracticeRepository
import com.deadlywolf.dancelibrary.data.PracticeSnapshot
import java.util.UUID
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.After
import org.junit.rules.TestName

/** Rendered app flows using seeded notes and an unavailable source; no CDN playback. */
class PracticeWorkspaceUiTest {
    @get:Rule val composeRule = createAndroidComposeRule<MainActivity>()
    @get:Rule val scenarioName = TestName()

    @After fun captureScreen() = captureInstrumentationScreenshot("PracticeWorkspaceUiTest-${scenarioName.methodName}")

    private fun repository(): PracticeRepository {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        check(context.packageName.endsWith(".preview")) { "These fixtures belong only in the preview application." }
        return PracticeRepository(context)
    }

    @Test
    fun notebookRetainsMultilineDraftAcrossRecreationAndSavesTwoThousandCharactersWithUndo() {
        val repository = repository()
        val marker = "Notebook instrumentation ${UUID.randomUUID()}"
        val bookmark = runBlocking {
            val nextPosition = (repository.snapshot.first().bookmarks[UNAVAILABLE_ID].orEmpty().maxOfOrNull { it.positionMs } ?: 7_250L) + 10_000L
            requireNotNull(repository.addBookmark(UNAVAILABLE_ID, nextPosition, marker).bookmark)
        }
        val prefix = "$marker\nKeep the shoulders quiet.\n"
        val longNote = prefix + "x".repeat(2000 - prefix.length)
        openNotebook(marker)
        scrollTo(hasContentDescription("Edit note"))
        composeRule.onNodeWithContentDescription("Edit note").performClick()
        waitForText("Optional note")
        composeRule.onNode(hasSetTextAction() and hasText("Optional note")).performTextReplacement(longNote)
        waitForSnapshot(repository) { it.noteDrafts[bookmark.id]?.text == longNote }
        composeRule.onNodeWithText("Close").assertIsDisplayed().performClick()
        waitForNotebook()
        composeRule.activityRule.scenario.recreate()
        waitForNotebook()
        scrollTo(hasContentDescription("Edit note"))
        composeRule.onNodeWithContentDescription("Edit note").performClick()
        waitForText("Optional note")
        composeRule.onNode(hasSetTextAction() and hasText("Optional note")).assert(hasText(longNote))
        composeRule.onNodeWithText("Save").assertIsDisplayed().performClick()
        waitForSnapshot(repository) { snapshot ->
            snapshot.bookmarks[UNAVAILABLE_ID].orEmpty().any { it.id == bookmark.id && it.note == longNote } && bookmark.id !in snapshot.noteDrafts
        }
        waitForFeedbackToClear("Note updated.")
        scrollTo(hasContentDescription("Delete bookmark"))
        composeRule.onNodeWithContentDescription("Delete bookmark").performClick()
        waitForSnapshot(repository) { snapshot -> snapshot.bookmarks[UNAVAILABLE_ID].orEmpty().none { it.id == bookmark.id } }
        waitForFeedbackToClear("Bookmark deleted.")
        scrollTo(hasText("Undo deleted bookmark"))
        composeRule.onNodeWithText("Undo deleted bookmark").performClick()
        waitForSnapshot(repository) { snapshot -> snapshot.bookmarks[UNAVAILABLE_ID].orEmpty().any { it.id == bookmark.id && it.note == longNote } }
        scrollTo(hasText(longNote))
        composeRule.onNodeWithText(longNote).assertIsDisplayed()
    }

    @Test
    fun queueReordersAndRemovesWhileUnavailableLessonStillSupportsCompletionAndSearchableReflection() {
        val repository = repository()
        val suffix = UUID.randomUUID().toString().take(8)
        val firstTitle = "Fixture first $suffix.mp4"
        val secondTitle = "Fixture second $suffix.mp4"
        val firstPath = "Instrumentation/$firstTitle"
        val secondPath = "Instrumentation/$secondTitle"
        val marker = "Open unavailable lesson $suffix"
        val before = runBlocking { repository.snapshot.first() }
        runBlocking {
            assertTrue(repository.toggleQueued(firstPath))
            assertTrue(repository.toggleQueued(secondPath))
            val nextPosition = (before.bookmarks[UNAVAILABLE_ID].orEmpty().maxOfOrNull { it.positionMs } ?: 18_125L) + 10_000L
            assertTrue(repository.addBookmark(UNAVAILABLE_ID, nextPosition, marker).succeeded)
        }
        openDestination("Queue")
        waitForText("Practice queue")
        scrollTo(hasContentDescription("Move $secondTitle up"))
        composeRule.onNodeWithContentDescription("Move $secondTitle up").performClick()
        waitForSnapshot(repository) { it.workspace.queue.indexOf(secondPath) + 1 == it.workspace.queue.indexOf(firstPath) }
        scrollTo(hasContentDescription("Remove $firstTitle from queue"))
        composeRule.onNodeWithContentDescription("Remove $firstTitle from queue").performClick()
        waitForSnapshot(repository) { firstPath !in it.workspace.queue && secondPath in it.workspace.queue }
        waitForFeedbackToClear("Removed from queue.")
        runBlocking { assertTrue(repository.removeQueued(secondPath)) }

        openNotebook(marker)
        scrollTo(hasText(marker))
        composeRule.onNode(hasText(marker) and !hasSetTextAction()).performClick()
        waitForText("Correct source unavailable")
        composeRule.onNodeWithContentDescription("Pause video").assertDoesNotExist()
        val completionAction = hasText(if (UNAVAILABLE_PATH in before.workspace.completed) "Completed" else "Mark complete") and hasClickAction()
        scrollTo(completionAction)
        composeRule.onNode(completionAction).performClick()
        waitForSnapshot(repository) { (UNAVAILABLE_PATH in it.workspace.completed) != (UNAVAILABLE_PATH in before.workspace.completed) }
        waitForFeedbackToClear("Completion updated.")
        assertEquals(before.watched.contains(UNAVAILABLE_ID), runBlocking { repository.snapshot.first() }.watched.contains(UNAVAILABLE_ID))

        val reflection = "Reflection instrumentation $suffix\nSmaller final step"
        scrollTo(hasText("Edit reflection"))
        composeRule.onNodeWithText("Edit reflection").performClick()
        waitForText("Your reflection")
        composeRule.onNode(hasSetTextAction() and hasText("Your reflection")).performTextReplacement(reflection)
        waitForSnapshot(repository) { it.reflectionDrafts[UNAVAILABLE_PATH]?.text == reflection }
        composeRule.activityRule.scenario.recreate()
        waitForDetail()
        waitForText("Your reflection")
        composeRule.onNode(hasSetTextAction() and hasText("Your reflection")).assert(hasText(reflection))
        composeRule.onNodeWithText("Save reflection").assertIsDisplayed().performClick()
        waitForSnapshot(repository) { it.workspace.reflections[UNAVAILABLE_PATH]?.text == reflection && UNAVAILABLE_PATH !in it.reflectionDrafts }
        composeRule.waitUntil(30_000L) { composeRule.onAllNodes(hasSetTextAction() and hasText("Your reflection")).fetchSemanticsNodes().isEmpty() }
        composeRule.activityRule.scenario.onActivity { it.onBackPressedDispatcher.onBackPressed() }
        openNotebook("Reflection instrumentation $suffix")
        // Notebook is ready now; the transient Snackbar may already have expired.
        waitForFeedbackToClear("Reflection saved.", requireVisible = false)
        scrollTo(hasText(reflection))
        composeRule.onNodeWithText(reflection).assertIsDisplayed()
        scrollTo(hasText("Open reflection"))
        composeRule.onNodeWithText("Open reflection").performClick()
        waitForDetail()
        scrollTo(hasText("Edit reflection"))
        composeRule.onNodeWithText("Edit reflection").performClick()
        waitForText("Your reflection")
        composeRule.onNode(hasSetTextAction() and hasText("Your reflection")).assert(hasText(reflection))
    }

    private fun openNotebook(query: String) {
        openDestination("Notebook")
        waitForNotebook()
        composeRule.onNode(hasSetTextAction()).performTextReplacement(query)
        closeSoftKeyboard()
    }

    private fun openDestination(description: String) {
        composeRule.waitUntil(30_000L) { composeRule.onAllNodesWithContentDescription(description, useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty() }
        val destination = composeRule.onNodeWithContentDescription(description, useUnmergedTree = true)
        if (composeRule.activity.resources.configuration.screenWidthDp >= 840) destination.performScrollTo()
        destination.performClick()
    }

    private fun waitForNotebook() {
        // The search field stays composed while draft cards can be below a restored scroll offset.
        composeRule.waitUntil(30_000L) {
            composeRule.onAllNodesWithText("Clear bookmarks").fetchSemanticsNodes().isNotEmpty() &&
                composeRule.onAllNodes(hasSetTextAction()).fetchSemanticsNodes().size == 1
        }
    }

    private fun waitForDetail() {
        composeRule.waitUntil(30_000L) { composeRule.onAllNodesWithContentDescription("Open settings").fetchSemanticsNodes().isNotEmpty() }
    }

    private fun scrollTo(matcher: SemanticsMatcher) {
        // Wide layouts retain a library list beside the detail pane. The final
        // scroll container is the current notebook/queue/detail workspace.
        composeRule.onAllNodes(hasScrollToNodeAction() and SemanticsMatcher.keyIsDefined(SemanticsProperties.VerticalScrollAxisRange)).onLast().performScrollToNode(matcher)
        // A lazy item can exceed a landscape pane's height. Bring the actual
        // child control into the viewport before using a normal pointer click.
        composeRule.onAllNodes(matcher).onLast().performScrollTo()
    }

    private fun waitForText(text: String) {
        composeRule.waitUntil(30_000L) { composeRule.onAllNodesWithText(text, useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty() }
    }

    private fun waitForSnapshot(repository: PracticeRepository, predicate: (PracticeSnapshot) -> Boolean) {
        composeRule.waitUntil(15_000L) { runBlocking { predicate(repository.snapshot.first()) } }
    }

    private fun waitForFeedbackToClear(message: String, requireVisible: Boolean = true) {
        // Scaffold snackbars overlay controls at the bottom of a long note.
        // Wait for the visible acknowledgement before the next pointer action.
        if (requireVisible) waitForText(message)
        composeRule.waitUntil(15_000L) { composeRule.onAllNodesWithText(message, useUnmergedTree = true).fetchSemanticsNodes().isEmpty() }
    }

    companion object {
        private const val UNAVAILABLE_ID = "b1eef9cf-dcd4-4a86-8026-f30ddfcb416a"
        private const val UNAVAILABLE_PATH = "Salsa Masterclass/Week 3/Spot Overturn/Spot Overturn - Explanation On2.mp4"
    }
}
