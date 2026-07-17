# Dance Library for Android

This is a native single-activity Android app. It uses Jetpack Compose for the responsive phone/tablet UI, Media3 ExoPlayer for Bunny HLS playback, and Preferences DataStore for favorites, watched lessons, and playback positions. It does not use a WebView.

## Requirements

- Android Studio 2026.1.1 or a compatible newer release
- JDK 17 or newer (Android Studio's bundled JBR works)
- Android SDK Platform 37 and Build Tools 36.0.0+

The app compiles against API 37, targets API 36, supports API 24+, and produces Java 17 bytecode.

## Build

From the repository root, regenerate the checked-in catalog whenever `data.js` or `summaries/` changes:

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

`scripts/export-android-catalog.mjs` reads the repository-controlled JavaScript catalog and summary chunks as strict UTF-8 JSON text; it does not evaluate them. The generated `app/src/main/assets/catalog.json` is deterministic and validated for lesson counts, UUIDs, duplicate paths, chapter order, canonical Bunny URLs, and encoding damage.

Each lesson streams from:

```text
https://<pull-zone>.b-cdn.net/<bunny-video-id>/playlist.m3u8
```

Media3 selects the appropriate HLS rendition, retries bounded network failures, pauses safely when the app backgrounds, and restores the saved position when the lesson is reopened. Video media is never bundled into the APK.

## Signing

Debug builds use the standard local Android debug certificate and are suitable for direct testing or sideloading. A debug APK can update an installed copy only when both were signed by the same debug key; clean GitHub runners generate temporary keys, so their debug artifacts are test packages rather than a durable update channel. For store distribution, configure a private release keystore outside the repository, increase `versionCode` for every release, and keep the key backed up securely. Keystores and signing-property files are intentionally ignored by Git.
