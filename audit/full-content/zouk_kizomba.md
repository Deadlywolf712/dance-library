# Zouk and Kizomba full-content audit

## Verdict

All **184/184** in-scope source videos were matched to the current catalog and perceptually reviewed. No Salsa, Bachata, unrelated instructor, category swap, duplicate file, or probable near-duplicate was found in the 60 Zouk, 59 Kizomba, or 65 Kizomba Masterclass lessons.

The content identities are sound. The actionable findings are display/source-fidelity corrections: missing instructor ampersands, flattened course separators, raw URL/filename punctuation, duplicate counters, and several title-card wording differences. The machine-readable companion records every lesson, including evidence timestamps and confidence.

## Exact coverage

| Assigned category | Catalog lessons | Source files found | Perceptually reviewed | Confirmed identity | Mismatch |
| --- | ---: | ---: | ---: | ---: | ---: |
| Zouk | 60 | 60 | 60 | 60 | 0 |
| Kizomba | 59 | 59 | 59 | 59 | 0 |
| Kizomba Masterclass | 65 | 65 | 65 | 65 | 0 |
| **Total** | **184** | **184** | **184** | **184** | **0** |

- 736 distributed opening/content frames were decoded and reviewed (four per lesson).
- The 119 Vdance lessons received an additional 2,971-frame first-50-second scan; visible source cards were transcribed rather than inferred from filenames.
- 33 high-resolution secondary title-card frames resolved Kizomba Advanced and Kizomba Technique Junkies wording.
- SHA-256 checks among equal-size sources found **0 exact duplicate groups**. Duration-gated multi-frame perceptual hashes found **0 probable near-duplicate pairs**.
- Exact decoded source coverage: **184/184**. Blockers: **none**.

## Course and instructor display corrections

Stable keys and relative source paths should remain unchanged; these recommendations are display-only.

| Stable key | Recommended display | Source evidence |
| --- | --- | --- |
| `Arthur  Oksana - Zouk Advanced` | Arthur & Oksana — Zouk Advanced | ARTHUR & OKSANA lower-third; ADVANCED source course |
| `Arthur  Oksana - Zouk Beginner` | Arthur & Oksana — Zouk Beginner | ARTHUR & OKSANA lower-third; BEGINNER source cards |
| `Arthur  Oksana - Zouk Beginner-Intermediate` | Arthur & Oksana — Zouk Beginner–Intermediate | ARTHUR & OKSANA lower-third; BEGINNER - INTERMEDIATE source cards |
| `Arthur  Oksana - Zouk Intermediate` | Arthur & Oksana — Zouk Intermediate | ARTHUR & OKSANA lower-third; INTERMEDIATE source cards |
| `Arthur  Oksana - Zouk Intermediate-Advanced` | Arthur & Oksana — Zouk Intermediate–Advanced | ARTHUR & OKSANA lower-third; INTERMEDIATE - ADVANCED source course |
| `Isabelle  Felicien - Advanced` | Isabelle & Felicien — Kizomba Advanced | ISABELLE & FELICIEN lower-third; ADVANCED - KIZOMBA source cards |
| `Isabelle  Felicien - Beginner` | Isabelle & Felicien — Kizomba Beginner | ISABELLE & FELICIEN lower-third; KIZOMBA - BEGINNERS source cards |
| `Isabelle  Felicien - Intermediate` | Isabelle & Felicien — Kizomba Intermediate | ISABELLE & FELICIEN lower-third; INTERMEDIATE - KIZOMBA source cards |

## Noteworthy lesson-title corrections

These are the cases most likely to confuse users. The JSON also contains routine punctuation/casing cleanup and readable replacements for all 43 raw Kizomba Harmony filenames.

| Audit # | Relative source path | Current title | Recommended display title |
| ---: | --- | --- | --- |
| 49 | `Arthur  Oksana - Zouk Intermediate/11 - 10 Rotisserie  Frango Assado.mp4` | 11 - 10 Rotisserie  Frango Assado | 11 - Rotisserie / Frango Assado |
| 62 | `Isabelle  Felicien - Advanced/02 - Lets criss cross side to side.mp4` | 02 - Lets criss cross side to side | 02 - Let's Criss Cross Side to Side |
| 69 | `Isabelle  Felicien - Advanced/09 - Contratiempos  Sincopated steps.mp4` | 09 - Contratiempos  Sincopated steps | 09 - Contratiempos & Sincopated Steps |
| 100 | `Isabelle  Felicien - Intermediate/01 - COMBO 1 shoulder impulse quick steps  partner rotation.mp4` | 01 - COMBO 1 shoulder impulse quick steps  partner rotation | 01 - Combo 1: Shoulder Impulse, Quick Steps & Partner |
| 101 | `Isabelle  Felicien - Intermediate/02 - COMBO 2 stairs touch steps  cross.mp4` | 02 - COMBO 2 stairs touch steps  cross | 02 - Combo 2: Stairs, Touch Steps & Cross-Rotation |
| 110 | `Isabelle  Felicien - Intermediate/11 - Saida fundations with footwork and a sit.mp4` | 11 - Saida fundations with footwork and a sit | 11 - Saida Foundations with Footwork and a Sit |
| 119 | `Isabelle  Felicien - Intermediate/20 - Weird saida and couples isolation.mp4` | 20 - Weird saida and couples isolation | 20 - Weird Saida and Couple's Isolation |
| 124 | `Kizomba Masterclass/Kizomba Harmony/Follower/05_Ballance Step (Follow)_1.mp4` | 05_Ballance Step (Follow)_1 | 05 - The Balance Step |
| 144 | `Kizomba Masterclass/Kizomba Harmony/Level 2/07_Triangle Box Step Variation (L2)_6.mp4` | 07_Triangle Box Step Variation (L2)_6 | 07 - Triangle Box Step Variations |
| 151 | `Kizomba Masterclass/Kizomba Harmony/Level 3/01_02_Open Position Techniques Part 2 (L3)_2.mp4` | 01_02_Open Position Techniques Part 2 (L3)_2 | 02 - Open Position Techniques 2 |
| 155 | `Kizomba Masterclass/Kizomba Harmony/Level 3/06_Female Saida with Cha Cha (L3)_6.mp4` | 06_Female Saida with Cha Cha (L3)_6 | 06 - Female Saida with Cha Cha Step |
| 163 | `Kizomba Masterclass/Kizomba Technique Junkies/Module 1 Kizomba Technique Foundations/Module I Technique Foundations, Lesson 1 Body Movement.m4v` | Module I Technique Foundations, Lesson 1 Body Movement | 01 - Body Movement |
| 172 | `Kizomba Masterclass/Kizomba Technique Junkies/Module 3 Dissociation/Module 3 Dissociation, Lesson 10 Leg and Foot Slides.m4v` | Module 3 Dissociation, Lesson 10 Leg and Foot Slides | 10 - Leg/Foot Slides & Lifts |
| 182 | `Kizomba Masterclass/Styling_Body Movement Videos/6 Kizomba Quadradinha .mp4` | 6 Kizomba Quadradinha  | 06 - Kizomba Quadradinha |

## Confidence and limitations

123 lessons have a readable on-screen lesson title in the sampled evidence and are marked high confidence. The remaining 61 retain their authoritative source filename as the title basis and are marked medium confidence after instructor/course, hierarchy, early-frame, and distributed content verification. This is not a suspected mismatch; each such record explicitly carries `no_readable_on_screen_lesson_title_in_sampled_frames`.

The audit is visual/perceptual and file-identity based. It does not claim an audio transcript of every spoken lesson. No catalog or application source was edited by this audit.
