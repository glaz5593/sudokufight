# Staged practice 1.0.3: build report (for the next Claude session)

> **Date:** 2026-10-20. **What:** the 7 numbered items of Moshe's device feedback on staged practice 1.0.2
> (his message of 2026-10-19), built from the written plan with every recommended default, because Moshe wrote
> "את הסעיפים הממוספרים תבצע בלי לשאול". Plan: [plan.md](plan.md) §1 and §5, [levels-content.md](levels-content.md),
> [levels-ui.md](levels-ui.md), corrections in [critique-log.md](critique-log.md).
>
> **Not built, plan only:** the friends waiting room ([friends-room.md](friends-room.md)) and the stealth bot
> ([stealth-bot.md](stealth-bot.md)). Nothing of them is in the code.
>
> **State of the tree:** everything is uncommitted on `main` (on top of `00c3249`, 1.0.2). No commit, no version
> bump (app.json is still 1.0.2), no deploy, no APK. All of these wait for Moshe's OK.
>
> **Reply to Moshe in Hebrew** (CLAUDE.md, memory). This file is English for the sessions only.

---

## 1. What was built, per Moshe's item

| # | Moshe wrote | Built |
|---|---|---|
| 1 | The stage is called "where's the 7" and the example shows 6 | `find` is named **"מיקום מדויק" / `Pinpoint`** everywhere outside the stage (map, panel, node label, "איך משחקים", gate, result, admin site). "איפה ה־6?" appears only inside the stage and on "מוכן?", with the digit of the board actually played (also on "שוב"). The tutorial's pictures and its first line take the digit from one constant (`TUTORIAL_FIND_DIGIT`). **Fix lane:** the scope words in the Pinpoint target card ("בריבוע 5", "בשורה D") are now emphasized (plan §2.5, D75). |
| 2 | Only 2 kinds in the first 10 stages | Chapter 1: Pinpoint, fill box, puzzle, fill row, and a race boss against Pip. All 10 kinds by chapter 5 (`FIRST_CHAPTERS`), three patterns in rotation from chapter 6 (`CHAPTER_PATTERNS`). Never two consecutive stages of one kind (a test over all 300). |
| 3 | Fill the box is too hard, needs more time | `FILL_ROWS`: 2 missing cells on a full board in chapter 1, up to 9 missing with every digit missing at least once outside (`minDigitGaps`) by chapter 14, then difficulty by technique. Fill kinds and the puzzle get up to 60 s (`LEVEL_RULES.kindMaxMs`, `maxMsOf`), the others stay at 30 s. The ladder never gets easier (test). |
| 4 | Puzzle | New kind: a pure engine (`levels/puzzle.ts`, `puzzleHost.ts`, `GameHost.swapBoxes`), builder and validator (`builder/puzzle.ts`: one valid arrangement counted in full, solvable step by step, one cycle), screen (`PuzzleLevelScreen`, `PuzzleBoard`, `PuzzleHud`, `useStageShell`). 3 moving boxes in chapters 1–3, up to 6 moving and 3 fixed. A wrong swap costs +5 s. No lock on a box that reaches home. Drag, and tap-then-tap for everyone. **Fix lane:** one finger only on the drag (`maxPointers(1)`), the real lock and P1 frame in the tutorial pictures, and the blind-swapper rule corrected (section 4, finding F1). |
| 5 | Unclear which box is the region | One region look for every kind and shape: cream inside (`board.focusCell`), blue-grey outside (`board.outCell`), a gold frame between dark keylines (`RegionFrame`), a short spotlight on open (<1 s, `LEVEL_UI.regionIntro`), and a small map on "מוכן?" (`MiniRegion`, `LEVEL_UI.readyRegion`). Coordinate rails are off (`LEVEL_UI.regionRails = false`). |
| 6 | Did not understand what a boss is | The boss is stage 10 of every chapter, always against a named bot (chapter 1: a race against Pip, 10% slower). A 3 s boss opening instead of "מוכן?" (`BossIntro`, chips from the engine's `bossTraits`), a boss band, arena corners around the board (`BossFrame`), a crown on the bot's avatar, and a result headline from the engine's `levelOutcome().bossBeaten`. The first boss merges its tutorial into the race's card (a fourth panel). **Fix lane:** the bot row of a boss result now takes its verdict from `bossBeaten` too (a tie says "תיקו: הבוס נשאר"). |
| 7 | Add fill the row and fill the column | `fillRow` and `fillCol` share the fill-box path in the engine (`fillRegionOf`, D69); a row stays a row on "שוב". The five kinds Moshe never met (race, duel, spot the error, point hunter, chain) now come in chapters 1–5. |

**Compatibility (D73):** all 300 levels were rebuilt at `rev` 2 (`LEVEL_REV_BASE`). Stars stay by id, even when
the kind changed. The best ("השיא שלי") starts over on a new rev (`mergeBest` with the rev; the map panel now
hides an old rev's best with `bestMetricAt`). Attempts are numbered per rev (fix lane: the first attempt at a
rebuilt level is the stored board). Level telemetry carries `rev`; the admin "שלבים" page counts only each level's
rev now by default, with a "גרסת השלבים: כל הגרסאות" switch (`?allRevs=1`). `ENGINE_VERSION` is 0.4.0. The app's
`levels.json` is 163,805 B (limit 180 KB).

---

## 2. Decisions as built (D66–D79, all at the recommended default)

| # | As built | Where |
|---|---|---|
| D66a | Bot stages: chapter 1 only the boss (race vs Pip); chapter 2 two races and a race boss, no duel; chapter 3 a race, two duels and a duel boss; from chapter 4 exactly one race, one duel and the boss | `FIRST_CHAPTERS`, `CHAPTER_PATTERNS` (`levels.config.ts`) |
| D66b | Chapter 1: four kinds (Pinpoint, box, puzzle, row) and a race boss | `FIRST_CHAPTERS[1]` |
| D67 | 9 missing with every digit missing outside from chapter 14, then technique (hidden single, pointing, pairs) | `FILL_ROWS`, `minDigitGaps` |
| D68 | Up to 60 s for fillBox, fillRow, fillCol and puzzle; 30 s for the rest (updates D49) | `LEVEL_RULES.kindMaxMs`, `maxMsOf` |
| D69 | Row and column: one engine path, no transpose on "שוב" | `fillRegionOf`, `builder/fillRegion.ts` |
| D70a | 3 moving boxes in chapters 1–3, up to 6 moving and 3 fixed at the end | `PUZZLE_ROWS` |
| D70b | Any valid arrangement is accepted; the builder ensures exactly one exists | `builder/puzzle.ts` (`countArrangements`) |
| D70c | Wrong swap +5 s, counted as a mistake | `LEVEL_RULES.puzzleSwapPenaltyMs = 5000` |
| D71 | A box at home never locks and is never marked | `lockOnCorrect = false` (stored in each level) |
| D72 | Boss always against a bot; chapter 1 a race vs Pip, 10% slower | `BOSS`, `FIRST_BOSS`, `boss.ts`, `bossBeaten` |
| D73 | Stars kept by id; best resets on a new rev | `LEVEL_REV_BASE = 2`, `mergeBest`, `bestMetricAt`, admin rev filter |
| D74 | Calibrate from Moshe's times without another APK; retune in 1.0.4. **No staging data in this run:** every time-model number is an ASSUMPTION, marked in code | `levels.config.ts`, `builder/profiles.ts` (`modelNumbers()`, all `calibrated: false`) |
| D75a | Cream inside, blue-grey outside, gold frame with dark keylines | `tokens.json`, `RegionFrame` |
| D75b | Spotlight on open, under a second | `LEVEL_UI.regionIntro = true` |
| D75c | Coordinate rails off | `LEVEL_UI.regionRails = false` |
| D76 | "מוכן?" shows where (map + the attempt's digit), except in a race | `LEVEL_UI.readyRegion = true` |
| D77 | Boss opening 3 s | `LEVEL_UI.bossReadyMs = 3000`, `mergeFirstBossTutorial = true` |
| D78a | Tap-then-tap for everyone | `LEVEL_UI.puzzleTapSwap = true` |
| D78b | Never mark duplicate digits in the puzzle | `LEVEL_RULES.puzzleConflicts = 'none'` |
| D79 | English name `Pinpoint` | i18n `levels` and admin `levelKind.find` |
| Process | "Draw the boards first" (Lv-Focus, Lv-Puzzle, Lv-Boss): **skipped**, as Moshe said to build without asking. The look is from tokens and the plan; Moshe judges on the phone. `docs/design/screens` and `canvas.json` are not updated. | — |

The spec's §24 rows D66–D79 are ✓ with "משה: 'תבצע בלי לשאול' (2026-10-20)".

---

## 3. Simulation report (time model = assumptions, D74)

`npm run levels:build -- --sim-only` on the shipped `levels.json`, 100 runs a level, 57 s. Stars per chapter
(of 30) on first attempts, against the targets (`TARGET_STARS` in `builder/profiles.ts`; tolerance 3):

| Chapters | Casual (target) | Good (target) | Excellent (target) |
|---|---|---|---|
| 1–5 (act 1) | 20.2 (26) | 27.3 (29) | 29.6 (30) |
| 6–10 (act 2) | 15.3 (22) | 25.8 (27) | 29.3 (30) |
| 11–15 (act 3) | 9.2 (18) | 22.1 (25) | 29.1 (29) |
| 16–20 (act 4) | 4.2 (14) | 17.7 (23) | 28.3 (28) |
| 21–25 (act 5) | 1.7 (10) | 13.6 (21) | 27.1 (27) |
| 26–30 (act 6) | 1.3 (7) | 12.7 (19.5) | 24.6 (26) |

Per chapter (casual / good / excellent): ch1 22.7/29.4/29.9, ch2 23.7/29.5/30.0, ch3 19.1/26.6/29.8, ch4
18.9/26.5/29.7, ch5 16.5/24.3/28.8, ch6 18.5/26.5/29.5, ch7 16.1/25.4/29.2, ch8 15.6/26.2/29.4, ch9 13.4/24.9/29.1,
ch10 12.7/25.8/29.4, ch11 12.6/23.5/29.2, ch12 10.7/23.8/29.5, ch13 7.9/21.0/28.8, ch14 7.4/22.1/29.1, ch15
7.3/20.2/29.1, ch16 5.4/21.2/29.3, ch17 4.7/18.0/28.1, ch18 4.2/16.5/28.5, ch19 3.0/16.3/27.7, ch20 3.5/16.6/28.1,
ch21 2.6/14.1/27.7, ch22 1.1/12.8/27.2, ch23 1.4/15.3/26.9, ch24 2.4/14.1/28.4, ch25 0.9/11.9/25.4, ch26
1.3/14.3/27.6, ch27 1.0/12.6/25.3, ch28 0.9/11.5/23.1, ch29 0.9/12.7/23.4, ch30 2.2/12.6/23.8.

**Reading it:**
- **Excellent** is on target everywhere (within tolerance; ch28–30 are 2–3 under).
- **Good** is within tolerance in chapters 1–4, 6–12, 14 and 16 (chapter 1: 29.4 of 29), 4–5 under in ch5, ch13
  and ch15, and 5–9 under in every chapter from 17.
- **Casual** is under target from chapter 1 (−3.3) and far under from chapter 3 (−7 to −11). In the kind table the
  fill kinds and the puzzle drop to ~0 for casual from act 3–4, and the bot kinds (race, duel) fall for good from act
  4. The profile order (excellent ≥ good ≥ casual) holds in every chapter.
- **21 stages too hard for good** (0 stars in over 60% of runs), all races or duels in chapters 20–30: L200, L218,
  L220, L230, L240, L242, L248, L250, L260, L265, L268, L270, L272, L278, L280, L282, L286, L290, L295, L298, L300.
  Their difficulty comes from the bot settings, not from the 1.0.3 time model.
- The report warns, it never fails the build. **Every profile number is an assumption (D74).** Calibrate from
  Moshe's 1.0.3 times (and, with the new admin switch, his 1.0.2 times) before trusting any of this; the retune is
  planned for 1.0.4.

**Blind swapper (puzzle, ★★★ share of 200 runs):** 3 moving (ch1–3) 64–72%; 4 moving (ch4–7) 22–30%; 5 moving
(ch8–16) 3–8%; 6 moving (ch17–30) 0–2%. See finding F1.

---

## 4. Review findings and what this lane did

All findings below were confirmed by the verify pass (with the corrections noted); every one is fixed.

| ID | Sev. | Finding | Verdict | Fixed how |
|---|---|---|---|---|
| engine F1 | medium | The blind-swapper rule (`BLIND_SWAPPER.maxThreeShare = 0.5`) was much weaker than the docs' promise "a blind swapper never reaches ★★★ from 4 moving boxes" | Confirmed (L034/L048/L054/L061 at 22–30%) | Option (b): kept 4 moving (a content decision) and set the rule to the measured level with a margin: **★★★ in under 35% of runs from 4 moving** (`maxThreeShare: 0.35`). Corrected 01-SPEC §5.3.2 and §5.3.9, levels-content §5.3/§5.7/§11, plan.md §7, critique-log, LEVELS-DEVICE-CHECKS check 15, and the build script's report line. Tests: puzzle.test (rule = 0.35, the 4-moving share between 10% and 35%), profiles.test (`< BLIND_SWAPPER.maxThreeShare`). **Tell Moshe** (critique-log requires it): with 4 moving, a guesser gets ★★★ about 1 time in 4. Stricter options: 5 moving from chapter 4 (rebuild), or a growing penalty. |
| engine F2 / compat F2 | low / medium | Attempts were numbered across revs (`COUNT(*)` by level id, max with `plays`), so a player with 1.0.2 plays never got attempt 1 (the stored board) on a rebuilt level, and admin "first try" data missed those plays | Confirmed; both suggested fixes were wrong (plays is cumulative) | `attemptOf(owner, levelId, rev)`; `nextAttempt = max(attempts at this rev, plays − attempts at other revs) + 1`, so a server-restored row (plays, no attempts) still counts. The rev flows through `levelAttemptOf(id, rev)`, `LevelSessionDeps.attemptOf(id, rev)` and play.tsx (`readRunAttempt` reads `attemptOf(id, level.rev)`). Tests: levelsRepo (3 rev-1 plays → rev 2 starts at 1, then 2; plays stay 5 for stars and sync; restored row), appLevels, levelStagePuzzle (called with the rev), server contract test. |
| engine F3 | low | No test hit `puzzleProblems`' "it does not solve step by step" branch | Confirmed | New puzzle.test case with the verifier's real fixture (fixed [5, 7], one 7-cycle): `countArrangements` 1, `solvesStepByStep` false, `puzzleProblems` = exactly that sentence. |
| UI-1 | medium | Two fingers on the puzzle board sent the swap to the wrong box (Android x/y average vs translation of the last pointer) | Confirmed in RNGH source; "no cancel test" refuted (one exists) | `.maxPointers(1)` on the Pan: a second finger cancels the drag, the box goes home, no swap. Test: the gesture's `config.maxPointers` is 1. |
| UI-2 | medium | The puzzle's "how to play" pictures had no lock (line 2 says "a box with a lock is fixed"), and the held and target frames looked the same (RegionFrame ignores `tone`) | Confirmed | New `PuzzleMarks.tsx` (`GoldFrame`, `MeFrame`, `PuzzleLockMark`, shared styles; `PuzzleBoard` uses them). The tutorial fixture has `locks` (the 6 fixed boxes) and a frame `look: 'me'`; `HowToPlayPanels` draws the real lock and P1 frame. Tests: locks on boxes 1,2,3,5,6,7 in pictures 1–2, none in 3; held frame P1 ring vs gold target. (The marks live apart from PuzzleBoard so the panels do not import the sound/haptics service.) |
| UI-3 | low | A tied boss could say "הבוס ניצח הפעם" above and "תיקו" in the bot row | Confirmed | `levelPlayedOf`: for a boss the row's verdict comes from `bossBeaten` (true → won; false → lost, or the new `bossTie` "תיקו: הבוס נשאר" / "A tie: the boss holds" on equal places). A quit while ahead is "lost" too. Tests in LevelResultView.test (tied race boss 2–2 at time up; a regular race keeps "tie"; quit while ahead). |
| UI-4 | low | The a11y audit lacked the puzzle, fillRow, fillCol and the race boss | Confirmed | Added the four stage cases plus "איך משחקים" of the puzzle; tutorials marked seen; any boss waits 3.5 s (its opening). |
| UI-5 | low | Plan §2.5: the scope words in the Pinpoint card were not emphasized | Confirmed | `hud.find.where` is now `<scope>{{scope}}</scope> · …` (he/en) through `Trans`; the scope is `rowTitle` in `color.text`, the rest stays the muted label; up to 2 lines. Test in TapLevelScreen.test. |
| compat F1 | medium | The map panel showed a rev-1 best on a rev-2 level (wrong unit after a kind change); `bestMetricAt` was never called | Confirmed | `MapRecords` carries `rev`; `panelSelection` uses `bestMetricAt(record, level.rev)`. Test in LevelMapScreen.test (rev 1 → stars only; same rev → the best). |
| compat F3 | low | Docs said every chapter has a race, a duel and a boss; the screen-reader example "שלב 7, מיקום מדויק" names a stage that is now a puzzle | Confirmed | Wording per the data (ch1 boss only; ch2 two races + race boss; ch3 race, two duels, duel boss; from ch4 exactly three) in 01-SPEC §5.3.4 and D66, DECISIONS-PENDING D66, device check 13. Example now "שלב 5, מיקום מדויק" (L005 is a find) in 01-SPEC (3×), components.md, QA-CHECKLIST row 28, device checks 6 and 12, `LevelNode.tsx`; doc tests updated and pin that L005 is a find. |
| compat F4 | low | `/levels` had no way to reach `allRevs`; after the server deploy the 1.0.2 plays vanish from the admin page | Mostly confirmed (raw install events still show them) | Server: `levelsQuerySchema` (`allRevs` = `1`/`true`/`0`/`false`, else 400) → `getLevels(…, { allRevs })`. Admin site: a "גרסת השלבים" select (current version only / all versions), `#/levels?allRevs=1`, `api.levels(days, allRevs)`, a hint for each mode (he/en). Spec §27.3 mentions the switch. Tests: server levels.test, admin router.test and LevelsPage.test. |

Device checks updated for these fixes: 12 (scope emphasis), 15 (blind-swapper numbers, two fingers, tutorial
lock and frames), 17 (boss tie), 19 (first attempt on a rebuilt level is the stored board; the admin switch).

---

## 5. Open issues

- **Deferred refactor (UI-1 lane, levels-ui §11):** `TapLevelScreen` and `GameScreen` are not on `useStageShell`
  yet; only `PuzzleLevelScreen` uses it, so the shell code (exit confirm, D65 pause, live region, results
  watchdog) is duplicated. A separate step.
- **D74 calibration pending.** No staging data in this run; all time-model numbers are assumptions (marked
  ASSUMPTION/D74 in `levels.config.ts` and `builder/profiles.ts`). The simulation (section 3) shows casual far
  under target, good under target from chapter 13, and 21 late race/duel stages too hard for good. Retune from
  Moshe's 1.0.3 times (and 1.0.2's via the new admin switch) for 1.0.4.
- **Blind swapper:** report the measured 22–30% (4 moving) to Moshe and ask whether that is enough (F1).
- **BossFrame is not in `PuzzleLevelScreen`.** No puzzle is a boss (`bossKindOf` gives only findDuel or duel). If
  one is ever added, wrap `PuzzleBoard` as `TapLevelScreen` does.
- **Boards not drawn** (process row skipped by Moshe's instruction): `docs/design/screens` and `canvas.json` do not
  show Lv-Focus, Lv-Puzzle or Lv-Boss.
- **Attempt numbering, edge case:** a row restored from the server keeps its plays as a floor (its rev is unknown),
  so a fresh install restoring rev-1 plays from another phone starts a rev-2 level at plays + 1. Rare (staging
  accounts only).
- **The Pinpoint card's "where" line** may now wrap to 2 lines on a narrow phone; check the card's layout on
  Moshe's 360 dp phone.
- A pre-existing `act(...)` console.error in `levelGameScreen.test.tsx` (tests pass; not from this batch's fixes).
- **Device checks to do (Moshe):** [`docs/LEVELS-DEVICE-CHECKS.md`](../../LEVELS-DEVICE-CHECKS.md) checks 12–19
  (one per item, plus the server/stars check), and 1–11 with their 1.0.3 changes.
- **Not done, by the ground rules:** commit, version bump to 1.0.3, server deploy, APK.

---

## 6. Tests at the end of this run

- `npm run verify` (eslint `--max-warnings 0`, typecheck = routes:types + `tsc -b`, i18n:check, jest): **exit 0.**
- `npm run format:check`: all files use Prettier style.
- i18n: 2436 app keys, 391 admin keys, 0 errors, 0 warnings.

**Jest, whole repo: 462 suites passed of 462; 10,619 tests passed of 10,619; 22 snapshots passed** (491 s).
Before this lane: 462 suites, 10,599 tests (INTEGRATE's run); this lane added 20 tests. The engine project alone:
58 suites, 1,709 tests. Edits after that run (the build script's report line, device checks, this file) were
checked on their own: `tsc -b` exit 0, eslint on the script, and the doc tests (levelsDocs, levelsSpecDocs:
157 passed).

---

## 7. Release order (only with Moshe's OK)

1. **Server first:** deploy the 1.0.3 server (and admin site) to **staging**, and check
   `https://sudoku-fight-staging.fly.dev/health` answers `"engine":"0.4.0"`. An old server refuses the telemetry of
   the new kinds (puzzle, fillRow, fillCol): the whole batch gets a 400, so the times needed for D74 would be lost.
2. **Then the 1.0.3 APK** against staging (no native change: a JS-only build; bump the version to 1.0.3 then).
3. Moshe runs the device checks; his times feed the D74 retune (1.0.4, together with the friends room).

Nothing of this happens without Moshe's explicit OK: no commit, no deploy, no APK.
