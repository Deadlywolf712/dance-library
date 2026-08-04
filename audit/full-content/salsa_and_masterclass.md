# Salsa and Salsa Masterclass perceptual audit

Audited **292 lessons**: 165 Salsa and 127 Salsa Masterclass. Every lesson received an early/title-window inspection plus a separate mid-content frame inspection.

## Result

- Confirmed identities: **289**
- Confirmed wrong assets: **1**
- Exact-title ambiguities: **2**
- Bachata/category swaps seen in this scope: **0**

The inspected Salsa and Salsa Masterclass videos are Salsa content in the expected course/instructor families. One served/local Salsa Masterclass asset is definitely wrong: `Salsa Masterclass/Week 3/Spot Overturn/Spot Overturn - Explanation On2.mp4` is byte-identical to `Spot Overturn - Demo On1.mp4`, the Bunny sequence aligns with that local duplicate, and both visibly carry the Demo On1 title card. Preserve the intended Explanation On2 record but flag its media unavailable/duplicate until a correct source is recovered; do not change its label to legitimize the duplicate.

## Confirmed mismatch

| legacyPath | expectedTitle | observedTitle | identityStatus |
| --- | --- | --- | --- |
| Salsa Masterclass/Week 3/Spot Overturn/Spot Overturn - Explanation On2.mp4 | Spot Overturn - Explanation On2 | Spot Overturn / Demo On1 | mismatch |

## Exact-title ambiguities

| legacyPath | expectedTitle | identityStatus |
| --- | --- | --- |
| Fernando Sosa  Tatiana Bonaguro - Sosa Style Upgrade/15 - Body Conversation.mp4 | 15 - Body Conversation | ambiguous |
| Salsa Masterclass/Wrap-Up/Multiply Your Moves - Outro & Ideas for Continuing Your Training.mp4 | Multiply Your Moves - Outro & Ideas for Continuing Your Training | ambiguous |

## Top-level display corrections

The folder keys must remain unchanged for lookup compatibility. The display layer should replace the instructors’ missing conjunction with `&` for the eight Adolfo/Tania and Fernando/Tatiana course labels. Exact recommendations are in `topLevelDisplayCorrections` in the JSON.

## Interpretation and limits

“Source-fidelity” means the asset is correct but the source card uses clearer wording, punctuation, or a section heading. “Ambiguous” means the inspected frames confirmed Salsa/course identity but did not expose a reliable exact lesson title. The audit sampled identifying and mid-content frames; it did not watch all 292 videos end to end.

The canonical per-lesson evidence, timestamps, confidence, recommended display titles, mismatch fields, and issues are in [salsa_and_masterclass.json](./salsa_and_masterclass.json).
