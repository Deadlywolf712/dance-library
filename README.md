# Dance Library

The redesigned practice workspace brings the video and notebook together, adds an ordered practice queue, named video segments, lesson reflections, explicit completion, and durable navigation, and moves personal collections into a shared repository with conflict protection and recovery.

A dance practice library available as both a build-free GitHub Pages site and a native Android app. Both clients use the same 795-lesson catalog and stream adaptive HLS video directly from Bunny CDN.

Both clients include the website’s category/course/folder organization, focused playback controls, chapter jumps, timestamp bookmarks and notes, searchable favorites and history, compatible import/export, durable resume positions, and the complete theme collection. Android implements those features with a native phone/tablet Compose interface and Media3 rather than wrapping the website in a WebView.

[Download the latest Android APK](https://github.com/Deadlywolf712/dance-library/releases/latest/download/Dance-Library-Android.apk) (Android 7.0 or newer).

The redesigned native workspace is available separately as the [Android 2.0 preview](https://github.com/Deadlywolf712/dance-library/releases/tag/v2.0.0-preview.20260910). It installs as **Dance Library Preview** alongside the production app. See [the redesign review](docs/REWORK-REVIEW.md) for scope and validation.

## Run locally

Serve the repository root with any static web server so service workers and streamed media behave like production:

```sh
npm run dev
```

Then open `http://127.0.0.1:4178/`. This preview has its own browser storage; data from the live website is not automatically copied here.

## Project structure

- `index.html` — static app shell and dialogs
- `style.css` — themes, components, and responsive layouts
- `app.js` — catalog navigation, player, storage, dialogs, and hash routing
- `library-core.js` — indexed catalog, consistent token search, and route parsing/formatting
- `practice-store.js` — validated transactions, Web Locks, cross-tab updates, recovery snapshots, and practice-data merges
- `practice-workspace.js` — queue, completion, saved segments, reflections, and recoverable drafts
- `workspace.css` — responsive practice workspace and navigation using the existing themes
- `lesson-workspace.css` — video-first lesson layout, practice overview, and queue disclosures
- `settings.css` / `settings-design.js` — backup-first Settings and shortcuts to the existing theme controller
- `course-browser.css` / `course-browser.js` — searchable course directory, style filter, and current-course navigation
- `playback-core.js` — tested resume and seek safety helpers
- `notes-core.js` — bookmark normalization, Android-compatible merge rules, and recoverable storage writes
- `notebook.css` — notebook workspace and editor styles
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

The app uses relative URLs and hash routes so it works from the `/dance-library/` GitHub Pages project path without a framework or build step. Existing `#video=...` links remain valid; `&t=seconds` adds a timestamp. Folder routes encode a JSON path array in `#folder=...`; `#view=notes` and `#view=queue` open the Notebook and Practice queue.

The September 10 publication uses asset version 28 and preserves the source-audited lesson titles and course names already on GitHub. The sidebar provides lesson search, Browse courses, workspace destinations, six style shortcuts, and utility links. Browse courses opens a wide searchable directory with a style filter and current-course highlighting. Opening it pauses playback and retains the lesson position; canceling keeps the player intact and does not automatically resume it. Choosing a course opens its exact existing folder route. The previous nested sidebar tree remains hidden and inert while its controller hooks stay compatible. Course display titles, teachers, and levels are separated without changing saved folder or lesson identities. A single responsive lesson grid keeps the video, controls, and actions aligned beside the guide, with a centered maximum width on large displays. The Notebook is a full page; the lesson workspace provides immediate timestamped note capture and start/end capture for segments. Advanced practice tools and occasional queue actions use keyboard-accessible disclosures. Expanded phone queue controls now use the full card width. Settings leads with full-library backup, including when opened during a lesson. Native video controls own their playback keys, and dialogs prevent background player shortcuts.

## Validate a release

```sh
npm install
npx playwright install chromium
npm run export:android-catalog
npm test
```

The release gate checks the complete lesson and summary inventory, duplicate HTML IDs, relative Pages assets, PWA scope, cache-version alignment, HLS pinning/integrity, accessible contrast correction for every theme, and continuous playback in a mobile browser. Playback tests also cover valid and stale resume positions, rapid lesson changes, stale HLS callbacks, and bounded media recovery.

Notebook regression tests cover long multiline notes, explicit save/cancel, draft retention, corrupt original data, failed writes and imports, previous-Undo preservation, instructor search, and lesson-scoped export. Playback tests use a simulated HLS runtime; they do not replace real-device streaming and offline-upgrade checks before publishing.

The suite covers module/data behavior and browser interactions. Workspace coverage includes durable navigation, multi-tab favorites and bookmark identity, imported note revisions, queue ordering, explicit completion, segment playback, reflection conflicts and recovery, versioned backups, storage denial, offline note editing, theater keyboard focus, and desktop/phone/landscape layouts. Failed rollback places the personal-data repository in recovery mode to protect the original snapshot; recovery downloads are diagnostic bundles rather than normal import files.

When a full catalog containing inline `summary` fields is available in `data.js`, regenerate the compact catalog and lazy chunks with:

```sh
node scripts/split-catalog.mjs
```

The command is deterministic and safe to repeat against the generated compact catalog.

## Android app

The native 2.0 preview includes the queue, saved segments, completion, and reflections. Both clients import and export schema-v2 JSON backups containing `practiceData` alongside legacy notes, favorites, history, and resume fields. Data transfers by explicit backup import/export; there is no automatic cloud synchronization. Android releases before 2.0 drop the newer practice fields when exporting, so retain the original backup when using an older release. The debug preview installs as **Dance Library Preview** with separate app storage; the 2.0 prerelease supplies the separate preview APK while the latest stable download remains version 1.1.2.

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
