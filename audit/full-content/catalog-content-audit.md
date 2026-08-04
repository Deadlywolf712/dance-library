# Complete Dance Library content audit

Audit date: 2026-08-03

## Verdict

All **795/795** catalog lessons were checked with direct source-video evidence, direct Bunny/offline frame-sequence comparison, and a catalog-wide duplicate scan. The audit found no broader pattern of wrong dance categories or swapped Bunny uploads.

It did find one genuinely wrong media asset: `Spot Overturn - Explanation On2` is an exact duplicate of `Spot Overturn - Demo On1`. That record is now visibly quarantined on both the website and Android app; playback is disabled without deleting its stable lesson ID, notes, favorites, or future recovery path.

The review also found many presentation defects caused by filesystem-safe names: missing ampersands and punctuation, raw URL-style filenames, spelling errors, duplicated sequence numbers, and flattened instructor/course labels. The implementation applies **402 lesson-title corrections** and **29 course-display aliases** while preserving every legacy path and Bunny ID.

## Exact coverage

| Assigned category | Lessons checked |
| --- | ---: |
| Salsa | 165 |
| Bachata | 319 |
| Zouk | 60 |
| Kizomba | 59 |
| Salsa Masterclass | 127 |
| Kizomba Masterclass | 65 |
| **Total** | **795** |

| Verification | Result |
| --- | ---: |
| Direct perceptual source records | 795/795 |
| Bunny/offline frame-sequence alignments | 795/795 |
| Offline videos cross-catalog fingerprinted | 795/795 |
| Bunny mappings requiring review | 0 |
| Bunny mapping failures | 0 |
| Exact duplicate groups | 1 |
| Other near-duplicate candidates | 0 |
| Lesson title corrections applied | 402 |
| Course display aliases applied | 29 |

## Findings and resolution

### One wrong source asset, quarantined

`Salsa Masterclass/Week 3/Spot Overturn/Spot Overturn - Explanation On2.mp4` and `Spot Overturn - Demo On1.mp4` have identical byte length, identical distributed perceptual fingerprints, and identical SHA-256 (`b4c928dd47e41dbf69db1bc76c8e28c51c8488ac067875a77d6fa739505308c5`). Both visibly say **Spot Overturn / Demo On1**.

No correct Explanation On2 copy was found on the currently mounted Desktop, Downloads, Documents, or Videos locations; the previously used PortableSSD `H:` was not mounted during recovery. The application keeps the intended Explanation On2 label and stable ID but presents a clear “Correct source unavailable” state. It does not stream the duplicate, mark it watched, or show the duplicate's incorrect generated chapter analysis.

### Fifteen course-level mismatches, corrected

Every source card in the 15-lesson stable folder `Pablo  Raquel - Intermediate` says **Intermediate/Advanced – Sensual Bachata**. The user-facing label is now **Pablo & Raquel — Intermediate/Advanced** on web and Android. The folder key stays unchanged for compatibility.

### Two exact-title limitations, documented

These two videos visibly confirm the expected Salsa course/instructors/content, and their Bunny streams align with their offline sources, but neither exposes a reliable exact lesson title in the inspected windows. Their authoritative source filenames remain the display basis:

- `Fernando Sosa  Tatiana Bonaguro - Sosa Style Upgrade/15 - Body Conversation.mp4`
- `Salsa Masterclass/Wrap-Up/Multiply Your Moves - Outro & Ideas for Continuing Your Training.mp4`

These are evidence limitations, not suspected wrong assets or category problems.

## Identity accounting

| Source-level status | Lessons | Resolution |
| --- | ---: | --- |
| Confirmed | 777 | Verified |
| Course-label mismatch | 15 | Corrected with display-only alias |
| Wrong-media mismatch | 1 | Quarantined; playback disabled |
| Exact-title ambiguity | 2 | Documented; source filename retained |
| **Total** | **795** | **No unresolved category or swap finding** |

## Compatibility

The corrections do not rename, move, delete, or re-upload media. They preserve:

- all 795 legacy paths;
- all Bunny video and collection IDs;
- summary keys;
- watched-state keys;
- bookmark and note keys;
- Android lesson IDs and backup compatibility.

Course aliases are display-only metadata. Lesson corrections use optional display titles in `data.js`. Android receives the same titles, aliases, and availability state through its generated catalog.

## Evidence boundary

Every lesson received identifying/title-window and independent content-frame inspection, with denser scanning where a title card was not immediately visible. This is a full per-video bounded perceptual audit, not a claim that every minute of all 795 videos was watched or every spoken sentence transcribed.

The machine-readable per-lesson evidence is in `catalog-content-audit.json`. Reproducible validators and media checks are in `scripts/validate-content-audit.mjs`, `scripts/audit-bunny-frame-parity.mjs`, and `scripts/audit-source-duplicates.mjs`.
