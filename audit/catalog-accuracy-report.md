# Dance Library catalog accuracy audit

Audit date: 2026-08-02

> This static-metadata audit is retained as the first correction pass. The later 795-video perceptual and Bunny-delivery audit in `audit/full-content/catalog-content-audit.md` supersedes its visual-evidence boundary and records all subsequent corrections.

## Result

The catalog contains 795 lessons across 34 courses. The media mappings are intact, but the audit confirmed two source-data problems:

1. Four Bachata courses (55 lessons) were categorized as Salsa because the application inferred style from instructor names.
2. Six Carolina Rosa display titles lost meaningful characters when their source titles were converted to filesystem-safe filenames.

Both problems are corrected without renaming a lesson path, Bunny ID, collection ID, or summary key. Existing watched state, bookmarks, notes, and Android lesson identity therefore remain compatible.

## Confirmed taxonomy corrections

| Course | Lessons | Previous category | Correct category |
| --- | ---: | --- | --- |
| Carolina Rosa - Advanced | 10 | Salsa | Bachata |
| Carolina Rosa - Beginner | 10 | Salsa | Bachata |
| Carolina Rosa - Intermediate | 10 | Salsa | Bachata |
| Marco Espejo - Marco Espejo Style | 25 | Salsa | Bachata |

The website and Android exporter now consume one exact, 34-course taxonomy instead of duplicating instructor-keyword rules.

Corrected category totals:

| Category | Lessons | Courses |
| --- | ---: | ---: |
| Salsa | 165 | 8 |
| Bachata | 319 | 16 |
| Zouk | 60 | 5 |
| Kizomba | 59 | 3 |
| Salsa Masterclass | 127 | 1 |
| Kizomba Masterclass | 65 | 1 |

## Catalog-wide verification

| Check | Result |
| --- | --- |
| Catalog paths vs. authoritative offline lesson paths | 795/795 exact matches |
| Unique Bunny video IDs | 795/795 |
| Bunny HLS master playlists reachable and measurable | 795/795 |
| Local/Bunny duration pairs within tolerance | 795/795 |
| Maximum absolute duration difference | 0.219 seconds |
| Median absolute duration difference | 0.048 seconds |
| Summaries present and uniquely keyed | 795/795 |
| Summary chapter timestamps within media duration | 795/795 |
| Web/Android lesson-path and metadata parity | 795/795 |
| Exact course taxonomy coverage | 34/34 courses |
| Duplicate Bunny IDs | 0 |
| Cross-course Bunny collection reuse | 0 |
| Confirmed issues after correction | 0 |
| Suspected static-analysis issues after correction | 0 |

Twenty additional offline files were found in an `Alex  Désirée - Beginner copy` folder. Every one has the same filename, byte size, and duration as its cataloged counterpart after removing the folder's ` copy` suffix. They are duplicate local media, not missing or conflicting catalog lessons.

## Carolina Rosa visual source audit

All 30 Carolina Rosa Bunny streams were opened and checked at their source title cards. Every card identifies the expected lesson and labels its course level as **Traditional Bachata**. All 30 also match their corresponding local duration within 0.203 seconds. No swapped IDs, shifted upload order, mixed collection, or wrong lesson was found in these courses.

`01 - Basics on the site` is source-exact and intentionally remains unchanged.

Six display-only corrections were confirmed from the on-screen source cards:

| Stable legacy path | Source-exact display title |
| --- | --- |
| `Carolina Rosa - Advanced/09 - 33 Steps.mp4` | `09 - 3X3 Steps` |
| `Carolina Rosa - Beginner/02 - Punta Talón Point  Heel.mp4` | `02 - Punta Talón (Point & Heel)` |
| `Carolina Rosa - Beginner/05 - Engaño Trick.mp4` | `05 - Engaño (Trick)` |
| `Carolina Rosa - Beginner/07 - Turns in 15.mp4` | `07 - Turns in 1/5` |
| `Carolina Rosa - Beginner/08 - Diagonals in 1  Chachas in 3 4.mp4` | `08 - Diagonals in 1 & Chachas in 3, 4` |
| `Carolina Rosa - Intermediate/05 - Twist and Tikitiki.mp4` | `05 - Twist & Tikitiki` |

## Regression protection

- The static catalog audit checks exact taxonomy coverage, web/Android parity, unique identifiers, summary integrity, title overrides, numbering, and conservative style evidence.
- Site validation rejects missing or unknown taxonomy courses and invalid display-title overrides.
- Browser tests verify that Carolina Rosa and Marco Espejo appear only in Bachata.
- Browser and Android tests verify that corrected display titles retain their original stable paths.
- The taxonomy file is versioned with the application shell, included in the Pages artifact, and triggers both Pages and Android builds when changed.

The machine-readable static result is in `audit/catalog-accuracy-static-report.json` and can be reproduced with `npm run audit:catalog`.

## Evidence boundary

The first pass did not perceptually verify the 765 non-Carolina lessons. That limitation was subsequently closed with direct per-video source inspection, 795/795 Bunny/offline frame-sequence alignment, and a 795-video cross-catalog duplicate scan. See `audit/full-content/catalog-content-audit.md` for the current result, including the quarantined Spot Overturn duplicate and all display corrections. No stable media path or Bunny ID was renamed during either audit.
