package com.deadlywolf.dancelibrary

import android.os.Bundle
import android.print.PrintAttributes
import android.print.PrintManager
import android.text.TextUtils
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import com.deadlywolf.dancelibrary.ui.DanceLibraryApp

class MainActivity : ComponentActivity() {
    private val viewModel: LibraryViewModel by viewModels()
    private var printWebView: WebView? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            DanceLibraryApp(viewModel)
        }
    }

    fun printDanceLibraryNotes(markdown: String) {
        printWebView?.destroy()
        var printRequested = false
        val webView = WebView(this).also { printWebView = it }
        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView, url: String?) {
                if (printRequested || isFinishing || isDestroyed) return
                printRequested = true
                val printManager = getSystemService(PRINT_SERVICE) as PrintManager
                printManager.print(
                    "Dance Library notes",
                    view.createPrintDocumentAdapter("Dance Library notes"),
                    PrintAttributes.Builder().build(),
                )
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (!request.isForMainFrame || printRequested) return
                Toast.makeText(this@MainActivity, "The notes preview could not be prepared.", Toast.LENGTH_LONG).show()
                view.destroy()
                if (printWebView === view) printWebView = null
            }
        }
        val escaped = TextUtils.htmlEncode(markdown)
        webView.loadDataWithBaseURL(
            null,
            "<html><head><meta charset='utf-8'><style>body{font:16px sans-serif;padding:24px;white-space:pre-wrap;color:#222}</style></head><body>$escaped</body></html>",
            "text/html",
            "UTF-8",
            null,
        )
    }

    override fun onDestroy() {
        printWebView?.destroy()
        printWebView = null
        super.onDestroy()
    }
}
