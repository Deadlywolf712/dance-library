package com.deadlywolf.dancelibrary.ui

import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties

/** Keep editor actions reachable even when a landscape keyboard leaves very little height. */
@Composable
internal fun EditorDialog(
    title: String,
    onDismissRequest: () -> Unit,
    confirmButton: @Composable () -> Unit,
    dismissButton: (@Composable () -> Unit)? = null,
    icon: (@Composable () -> Unit)? = null,
    content: @Composable (compact: Boolean) -> Unit,
) {
    Dialog(
        onDismissRequest = onDismissRequest,
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
    ) {
        BoxWithConstraints(
            modifier = Modifier.fillMaxSize().safeDrawingPadding().imePadding()
                .pointerInput(onDismissRequest) { detectTapGestures(onTap = { onDismissRequest() }) },
            contentAlignment = Alignment.Center,
        ) {
            val compact = maxHeight < 320.dp
            Surface(
                modifier = Modifier.padding(if (compact) 4.dp else 16.dp)
                    .widthIn(max = 560.dp).fillMaxWidth().heightIn(max = maxHeight)
                    .semantics { paneTitle = title }
                    .pointerInput(Unit) { detectTapGestures(onTap = {}) },
                shape = MaterialTheme.shapes.extraLarge,
                tonalElevation = 6.dp,
            ) {
                Column(Modifier.padding(if (compact) 4.dp else 24.dp), verticalArrangement = Arrangement.spacedBy(if (compact) 4.dp else 16.dp)) {
                    if (compact) {
                        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                            Text(title, Modifier.weight(1f), style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            dismissButton?.invoke()
                            confirmButton()
                        }
                    } else {
                        icon?.let { Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { it() } }
                        Text(title, style = MaterialTheme.typography.headlineSmall)
                    }
                    // Unweighted header/actions are measured first; only the editor body gives up space.
                    Box(Modifier.weight(1f, fill = false).fillMaxWidth()) { content(compact) }
                    if (!compact) {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                            dismissButton?.invoke()
                            confirmButton()
                        }
                    }
                }
            }
        }
    }
}
