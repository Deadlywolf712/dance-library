# Practice workspace redesign — September 2026

The website and native Android app now provide a practice workspace with an ordered queue, timestamp notes, named video segments, lesson reflections, explicit completion, and schema-v2 backup exchange. Personal practice data remains local, with recoverable drafts, conflict checks, and explicit import/export.

## Design and interaction

- A responsive lesson layout aligns video, controls, actions, and the lesson guide across desktop and phone widths.
- Browse courses opens a searchable directory with style filters, concise course titles, teacher names, and learning levels. Existing folder and lesson links remain valid.
- Notebook is a dedicated workspace. Advanced practice controls and occasional queue actions use disclosures, and Settings leads with backups.
- Native Android uses Compose layouts for phones and tablets. Notes, reflections, search, and segment editors reserve visible actions above the keyboard, including short landscape windows.
- Native video controls own their playback keys; open web dialogs prevent background player shortcuts.

## Integration with the published catalog

The publication preserves the existing 795-lesson catalog, including 402 audited lesson title corrections and 29 course display aliases already present on GitHub. Raw lesson paths, video IDs, saved-data keys, and the known unavailable-source quarantine remain intact. Both interfaces understand the audited display names without replacing canonical identities.

The website uses asset version 28. Android's bundled catalog is regenerated from the same sources. Existing audit records and their content-validation gate remain part of the repository.

## Validation

The preceding UI review passed 70 web module/data tests and all 103 then-current browser cases across full and targeted runs. It included desktop, narrow phone, tablet, and short landscape layouts; light/dark themes; real-stream checks; and long-note persistence. The initial browser run had two timing failures that passed unchanged on targeted reruns; this was not a single uninterrupted all-passing run.

The reviewed Android preview passed 88 unit tests, lint, debug/test builds, and a minified release build. Broader emulator suites covered persistence, backups, playback, navigation, and the practice workspace. Final affected editor cases passed on phone, tablet-sized, and landscape-sized viewports, with an additional strict offline Notebook check. Actual pointer input with the Android keyboard open verified note, search, reflection, and segment actions. The temporary emulator was restored and stopped.

Publication adds focused regressions for the audited course aliases: the integrated suite contains 71 web module/data cases, 106 browser cases, and 90 Android unit tests. The content audit passed for all 795 lessons; all 22 targeted browser cases passed across the batch and focused rerun. The fresh Android publication build passed all 90 unit tests, lint with zero errors, debug/test APK assembly, and release/R8 assembly. GitHub Actions verifies the integrated branch before deployment. The pull request and Actions runs record the full publication results.

## Android preview and limits

The Android 2.0 preview installs as `com.deadlywolf.dancelibrary.preview`, alongside the production application with separate storage. Import a copy of a JSON backup to transfer saved practice. The prerelease is debug-signed for direct testing; the stable release remains separately available.

Testing used a single API 37 emulator with synthetic phone/tablet/landscape sizes. Physical phones, older Android versions, all themes, every video stream, and third-party document providers were not exhaustively tested. The recorded checks establish the tested behavior, not perfection on every device. Offline Notebook editing does not imply offline video availability. There is no automatic synchronization between the website and Android app.
