# Dance Library for Android

This is a native single-activity Android app. It uses Jetpack Compose for the responsive phone/tablet UI, Media3 ExoPlayer for Bunny HLS playback, and Preferences DataStore for bookmarks, notes, favorites, history, resume positions, themes, and settings. It does not wrap the website in a WebView.

## Requirements

- Android Studio 2026.1.1 or a compatible newer release
- JDK 17 or newer (Android Studio's bundled JBR works)
- Android SDK Platform 37 and Build Tools 36.0.0+

The app compiles against API 37, targets API 36, supports API 24+, and produces Java 17 bytecode.

## Build

From the repository root, regenerate the checked-in catalog whenever `data.js`, `summaries/`, `course-taxonomy.js`, `salsa_course.js`, `index.html`, or `style.css` changes:

```sh
npm run export:android-catalog
```

Then run the complete local gate:

```sh
cd android
./gradlew --no-daemon lintDebug testDebugUnitTest assembleDebug assembleRelease
```

On Windows, replace `./gradlew` with `gradlew.bat`. The installable debug APK is created at `app/build/outputs/apk/debug/app-debug.apk`. The release build is intentionally unsigned; assembling it in local and hosted CI verifies the R8 and resource-shrinking path before a release key is configured.

Install it on an attached device with:

```sh
adb install -r -t app/build/outputs/apk/debug/app-debug.apk
```

## Catalog and playback

`scripts/export-android-catalog.mjs` parses the repository-controlled catalog, summary chunks, authoritative course taxonomy, theme definitions, and Salsa Masterclass presentation data as strict UTF-8. The taxonomy and Salsa course data are evaluated only inside locked-down Node `vm` contexts with bounded timeouts; they have no browser, network, module, or filesystem globals. The generated `app/src/main/assets/catalog.json` is deterministic and validated for exact taxonomy coverage, counts, references, folder cycles and rollups, website ordering, theme fields, UUIDs, duplicate paths, chapter order, canonical Bunny URLs, and encoding damage.

Each lesson streams from:

```text
https://<pull-zone>.b-cdn.net/<bunny-video-id>/playlist.m3u8
```

Media3 selects the appropriate HLS rendition, retries bounded network failures, pauses safely when the app backgrounds, and restores the saved position when the lesson is reopened. The native practice player also supports ±5-second seeking, 0.5×–2× speed, mirroring, A–B loops, timestamp bookmarks, notes, and immersive theater mode. Video media is never bundled into the APK.

## Signing

Debug builds use the standard local Android debug certificate and are suitable for direct testing or sideloading. A debug APK can update an installed copy only when both were signed by the same debug key; clean GitHub runners generate temporary keys, so their debug artifacts are test packages rather than a durable update channel. For store distribution, configure a private release keystore outside the repository, increase `versionCode` for every release, and keep the key backed up securely. Keystores and signing-property files are intentionally ignored by Git.
