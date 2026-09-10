package com.deadlywolf.dancelibrary

import android.graphics.Bitmap
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File

/** Evidence from the isolated preview app; never reads a production profile. */
internal fun captureInstrumentationScreenshot(name: String) {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    val context = instrumentation.targetContext
    check(context.packageName.endsWith(".preview"))
    val directory = File(requireNotNull(context.getExternalFilesDir(null)), "instrumentation-screenshots")
    check(directory.isDirectory || directory.mkdirs())
    val bitmap = requireNotNull(instrumentation.uiAutomation.takeScreenshot())
    try {
        File(directory, "${name.replace(Regex("[^A-Za-z0-9._-]"), "-")}.png").outputStream().use {
            check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it))
        }
    } finally { bitmap.recycle() }
}
