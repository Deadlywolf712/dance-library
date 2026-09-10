# Dance Library for Android

This is a native single-activity Android app. Version 2.0 adds a practice queue, saved segments, explicit completion, and a Notebook combining timestamp notes with lesson reflections. It uses Jetpack Compose, Media3 ExoPlayer, and Preferences DataStore. The website and native app exchange schema-v2 JSON backups; data remains local until the user exports and imports a backup.

Course browsing separates course title, level, and teacher names, orders learning levels within each course group, and shows counts for the current location. The player keeps transport controls together, with compact practice tools on narrow phones. Settings starts with backups; export choices, streaming configuration, reset controls, and help expand when needed.

Timestamp notes, reflections, segments, and global search use an adaptive dialog that keeps actions above the software keyboard. Short landscape windows place actions beside the heading and let the editor content scroll. Lesson cards show a reflection preview; **Edit reflection** opens its editor, retains drafts on Close, and returns to the preview after a successful save.

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
./gradlew --no-daemon --no-parallel --max-workers=2 lintDebug testDebugUnitTest assembleDebug assembleRelease assembleDebugAndroidTest
```

On Windows, replace `./gradlew` with `gradlew.bat`. The installable debug APK is created at `app/build/outputs/apk/debug/app-debug.apk`. It is labeled **Dance Library Preview**, uses application ID `com.deadlywolf.dancelibrary.preview`, and installs alongside the existing app with separate data. Import a copy of your JSON backup to test with your saved practice. The release build uses the production application ID and remains unsigned until a release key is configured.

If the bundled Windows Java runtime reports `Unable to establish loopback connection`, a Java selector may be unable to use the system temporary directory for its Unix-domain wakeup socket. The audited local workaround sets `JAVA_TOOL_OPTIONS` to `-Djdk.net.unixdomain.tmpdir="<existing writable directory>"` only for the build process; it requires no firewall changes.

Install it on an attached device with:

```sh
adb install -r -t app/build/outputs/apk/debug/app-debug.apk
```

## Catalog and playback

`scripts/export-android-catalog.mjs` parses the repository-controlled catalog, summary chunks, authoritative course taxonomy, theme definitions, and Salsa Masterclass presentation data as strict UTF-8. The taxonomy and Salsa course data are evaluated only inside locked-down Node `vm` contexts with bounded timeouts; they have no browser, network, module, or filesystem globals. The generated `app/src/main/assets/catalog.json` is deterministic and validated for exact taxonomy coverage, counts, references, folder cycles and rollups, website ordering, theme fields, UUIDs, duplicate paths, chapter order, canonical Bunny URLs, and encoding damage.

Lesson and course display aliases come from the same authoritative website catalog. Corrected titles and levels appear in browsing and search while original course folders, lesson IDs, routes, and backup keys stay stable. Course headings accept typographic dashes, combined levels, and parenthesized levels used by these aliases.

Each lesson streams from:

```text
https://<pull-zone>.b-cdn.net/<bunny-video-id>/playlist.m3u8
```

Media3 selects the appropriate HLS rendition, retries bounded network failures, pauses when the app backgrounds, and restores the saved position. Practice tools support ±5-second seeking, 0.25×–2× speed, mirroring, A–B loops, named saved segments, timestamp notes, and theater mode. Catalog entries with a known incorrect recording show an explanation and retain their personal notes without playing the wrong video. Video media is not bundled into the APK.

## Notes and backups

Timestamp notes support 2,000 characters; reflections support 10,000. Editors keep separate on-device drafts, check the saved revision before replacing text, and close only after a successful save. Undo restores the last deleted timestamp note after reopening the app. Completion is deliberate and separate from viewing history.

Full schema-v2 backups include queue order, segments and speeds, completion timestamps, reflections, and the legacy note/favorite/history fields. Unknown practice paths and extension metadata are retained. Unsupported versions and malformed practice data are rejected before a write. Lesson-only exports omit opaque library-level metadata because its lesson ownership cannot be determined. Drafts are local recovery records: save them before exporting a normal backup, or copy their text from the editor.

Android releases before 2.0 do not retain the new practice fields when exporting again. Preserve the original backup when transferring to an older release. There is no automatic cloud synchronization.

## Signing

Debug builds use the standard local Android debug certificate and are suitable for direct testing or sideloading. A debug APK can update an installed copy only when both were signed by the same debug key; clean GitHub runners generate temporary keys, so their debug artifacts are test packages rather than a durable update channel. For store distribution, configure a private release keystore outside the repository, increase `versionCode` for every release, and keep the key backed up securely. Keystores and signing-property files are intentionally ignored by Git.
