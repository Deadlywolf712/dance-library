# Source duplicate audit

Audit date: 2026-08-03

## Result

All **795/795** offline catalog videos were fingerprinted at three distributed timestamps and compared across the complete catalog. The audit found exactly one duplicate group and no additional perceptual-review candidates:

| Result | Count |
| --- | ---: |
| Videos fingerprinted | 795/795 |
| Decode failures | 0 |
| Exact duplicate groups | 1 |
| Perceptual-review pairs | 1 |
| Additional candidates beyond the exact duplicate | 0 |

The sole pair is:

- `Salsa Masterclass/Week 3/Spot Overturn/Spot Overturn - Demo On1.mp4`
- `Salsa Masterclass/Week 3/Spot Overturn/Spot Overturn - Explanation On2.mp4`

They have the same byte length and the same SHA-256 digest (`b4c928dd47e41dbf69db1bc76c8e28c51c8488ac067875a77d6fa739505308c5`). Their three distributed perceptual fingerprints are also identical. Direct inspection confirms both carry the visible title card **Spot Overturn / Demo On1**.

The intended `Explanation On2` record should remain stable for bookmarks, notes, and future source recovery, but its duplicate media must be marked unavailable until the correct video is supplied. It must not be silently relabeled as a second Demo On1 lesson.

## Method

The reproducible tool is `scripts/audit-source-duplicates.mjs`. It extracts frames at 17%, 53%, and 83% of every offline video, calculates difference-hash fingerprints, and compares duration-compatible pairs across the catalog. It then calculates SHA-256 for every equal-size group. The full generated 795-record evidence is kept locally under the repository's `audit/*-local.json` ignore rule.

The perceptual candidate thresholds are an average hash similarity of at least 0.94, a minimum per-frame similarity of at least 0.88, and a duration difference no greater than the larger of one second or 0.25% of the shorter video. Only the byte-identical Spot Overturn pair crossed those thresholds.
