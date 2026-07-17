package com.deadlywolf.dancelibrary

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import com.deadlywolf.dancelibrary.ui.DanceLibraryApp
import com.deadlywolf.dancelibrary.ui.theme.DanceLibraryTheme

class MainActivity : ComponentActivity() {
    private val viewModel: LibraryViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            DanceLibraryTheme {
                DanceLibraryApp(viewModel)
            }
        }
    }
}
