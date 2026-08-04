# Bunny delivery identity audit

Audit date: 2026-08-03

## Result

Every one of the 795 catalog lessons was compared directly against its corresponding Bunny HLS stream. All 795 aligned with the authoritative offline source; none required review and none failed.

| Check | Result |
| --- | ---: |
| Catalog lessons tested | 795/795 |
| Aligned Bunny/offline pairs | 795 |
| Pairs requiring review | 0 |
| Failed pairs | 0 |
| Minimum frame correlation | 0.998112 |
| Average frame correlation | 0.999649 |
| Maximum mean absolute pixel error | 1.632828 |
| Average mean absolute pixel error | 0.921876 |
| Minimum perceptual-hash similarity | 0.863021 |
| Average perceptual-hash similarity | 0.957888 |

## Method

For each catalog path, the audit fetched the Bunny 480p media playlist, selected a deterministic media segment, downloaded that exact HLS transport-stream segment, and extracted a sequence of ten frames from it. It extracted a matching ten-frame sequence from the corresponding offline source at the same media timestamp, then compared frame correlation, perceptual hash, pixel error, and motion consistency. Twenty-seven lessons were automatically tested at an additional timestamp because their first sample did not satisfy every alignment threshold.

The pass thresholds were frame correlation at least 0.985, perceptual-hash similarity at least 0.86, and mean absolute pixel error no greater than 3.5. Every final sample cleared all three thresholds. The weakest final frame correlation was still 0.998112.

As a negative control, the same comparison was run against a neighboring but incorrect lesson from the same studio. That wrong pairing produced substantially worse measurements (0.9459 correlation, 0.8203 perceptual-hash similarity, and 6.57 mean absolute error) and failed the alignment thresholds. This demonstrates that the test distinguishes lesson identity rather than merely matching a shared studio background.

The reproducible audit tool is `scripts/audit-bunny-frame-parity.mjs`. Its full per-lesson output is intentionally local because it is a large generated evidence file; it contains 795 individual alignment records and is covered by the repository's `audit/*-local.json` ignore rule.

## Scope

This result verifies that each catalog entry resolves to the same video content on Bunny as its authoritative offline source. Title-card and category accuracy are audited separately because a correctly mapped video can still have an inaccurate display label.
