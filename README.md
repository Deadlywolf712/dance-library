# Dance Library

A dance practice library available as both a build-free GitHub Pages site and a native Android app. Both clients use the same 795-lesson catalog and stream adaptive HLS video directly from Bunny CDN.

The website includes focused playback controls, chapter jumps, bookmarks and notes, favorites, watch history, import/export, and a large theme collection. The Android app adds a native phone/tablet interface, Media3 playback, chapter seeking, favorites, watched state, and durable resume positions without wrapping the website in a WebView.

## Run locally

Serve the repository root with any static web server so service workers and streamed media behave like production:

```sh
python -m http.server 4176
```

Then open `http://127.0.0.1:4176/`.

## Project structure

- `index.html` — static app shell and dialogs
- `style.css` — themes, components, and responsive layouts
- `app.js` — catalog navigation, player, storage, dialogs, and hash routing
- `playback-core.js` — tested resume and seek safety helpers
- `data.js` — compact lesson metadata needed at startup
- `summaries/` — lesson-analysis chunks loaded only when a lesson is opened
- `salsa_course.js` — Salsa Masterclass course metadata
- `sw.js` — offline shell and runtime asset cache
- `scripts/validate-site.mjs` — deterministic pre-deploy checks
- `tests/mobile-playback.spec.mjs` — mobile playback, resume, recovery, and source-race tests
- `scripts/split-catalog.mjs` — repeatable catalog/summary splitter
- `android/` — native Kotlin, Jetpack Compose, and Media3 application
- `scripts/export-android-catalog.mjs` — deterministic web-catalog to Android-asset exporter
- `scripts/stage-pages.mjs` — strict web-only GitHub Pages package builder

The app uses relative URLs and `#video=...` routes so it works from the `/dance-library/` GitHub Pages project path without a framework or build step.

## Validate a release

```sh
npm install
npx playwright install chromium
npm test
```

The release gate checks the complete lesson and summary inventory, duplicate HTML IDs, relative Pages assets, PWA scope, cache-version alignment, HLS pinning/integrity, accessible contrast correction for every theme, and continuous playback in a mobile browser. Playback tests also cover valid and stale resume positions, rapid lesson changes, stale HLS callbacks, and bounded media recovery.

When a full catalog containing inline `summary` fields is available in `data.js`, regenerate the compact catalog and lazy chunks with:

```sh
node scripts/split-catalog.mjs
```

The command is deterministic and safe to repeat against the generated compact catalog.

## Android app

The native app targets Android 7.0 and newer. It is built with AGP 9.2.1, Gradle 9.4.1, Jetpack Compose, DataStore, and Media3 ExoPlayer. No Bunny API key is stored in the APK; playback URLs contain only the public pull-zone hostname and lesson video ID.

Regenerate the bundled Android catalog and build a debug APK:

```sh
npm run export:android-catalog
cd android
./gradlew lintDebug testDebugUnitTest assembleDebug assembleRelease
```

On Windows, use `gradlew.bat`. The APK is written to `android/app/build/outputs/apk/debug/app-debug.apk`. See `android/README.md` for Android Studio, command-line, and installation details.

## Deployment

Pushes to `main` run the validation gate and deploy an allowlisted web-only package through `.github/workflows/deploy.yml`. Native source, tests, package tooling, and build output are excluded from the Pages artifact. Android changes run a separate lint/test/APK workflow in `.github/workflows/android.yml`.

Progress, bookmarks, notes, favorites, theme choice, and playback positions stay in the browser's local storage. Video media is streamed and intentionally excluded from the service-worker cache.
