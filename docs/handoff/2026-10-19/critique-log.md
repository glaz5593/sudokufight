# Critique log, 2026-10-20 (assembler pass)

This log is for the next Claude session. It records what the assembler checked, applied, adjusted or rejected after the adversarial critique of the four section files. Moshe reads `plan.md`. This file stays in English.

Originals are not kept in the repo; the edits were made in place to:
`levels-content.md`, `levels-ui.md`, `friends-room.md`, `stealth-bot.md`. The new files are `plan.md` (Hebrew, for Moshe) and this log.

## Verification method

The cited facts were spot-checked against the repo before applying anything. These checks held:
- `docs/01-SPEC.md` §24 has D49 as "✓ החלטת משה 2026-10-17", which is Moshe's decision, not the original spec.
- `apps/mobile/src/__tests__/levelsSpecDocs.test.ts:110` pins D1..D65. Line 234 pins 'כ־171KB'. Line 317+ pins item 2.19 as D50–D63.
- `apps/server/src/telemetry/schema.ts:59` checks `kind` with `z.enum(LEVEL_KINDS)`. `packages/protocol/src/telemetry.ts` says a bad prop refuses the whole batch, and that since 1.0.2 unknown event *names* are skipped.
- `packages/engine/src/levels/index.ts` exports only spec, stars, progress, transform, find and findHost.
- About 24 mobile test files mention level ids. `levelSession.test.ts:60-63` pins L001 as find and L012 as race, among others.
- `apps/mobile/src/__tests__/levelsDocs.test.ts:64-95` pins KIND_NAMES and PLAN_SCREENS. In `apps/admin/src/strings.ts:430`, `levelKind.find` is 'מציאת מקום'.
- `docs/MOSHE-TODO.md:333,340` shows C1 decided: stay on `sudoku-fight-prod.fly.dev`.
- In `apps/server/src/progress/practice.ts`, `practiceXpUsedOn` sums only practice_results and level_xp_days.
- In `GameRoom.ts`: line 334 is `this.roomId = this.code`, line 368 is `alreadyInRoom`, and `remoteGameHost.ts:623` keeps the reconnection token in memory.
- `ModesRanked.test.tsx` and `ranked.e2e.test.tsx` assert the `rating-ranked*` chip. HomeAccount.test.tsx does **not**, so the critic's claim is partly wrong there.
- `apps/mobile/scripts/build-apk.mjs:333` nativeInputs has no server host.
- Original spec §18 is titled "אייקונים ותגובות" ("לשחקן יהיה לחצן אייקון", lines 491-493), and §24 is at lines 636-640.
- `terms.ts:96` says a restart ends running ranked games with no rating change. `privacy.ts:152` says "מוצגים לשחקנים אחרים", which confirms the critic's misquote finding.
- `progress/router.ts` uses `z.strictObject`. The app has no help/FAQ route.
- `Lv-Find.dc.html:77` says "the rest is dimmed", so the dimming *was* drawn.
- `levels.config.ts:266` has `BOSS.pace = 0.9`, multiplied onto the chapter bot's pace. The boss bot really is 10% faster than the chapter's regular bot.
- Last drizzle migration: `0008_user_levels.sql`.
- `expo-updates` is installed but not configured (no OTA anywhere in docs), so every release is an APK.

## Numbering

- Kept blocks: levels-content D66–D74, levels-ui D75–D79, friends-room D80–D89, stealth-bot D90–D99. They are already contiguous from D66 to D99, so no renumbering was needed.
- One D number is one §24 row. When a topic has several separately answerable questions, they get letter suffixes: D66a/b, D70a/b/c, D75a/b/c, D78a/b, D80a/b, D81a/b, D84a/b, D85a/b/c, D97a/b.
- D69 (row/col engine path) and D86 (code format) are technical, with no question to Moshe. They are listed in the plan table.
- "Draw before build" is a process question with no D number. There is one for levels and one for friends.
- The old levels-ui D77 question ("when to say you beat the boss") was dropped. The engine verdict decides it (see below).
- The old friends Q9 (production domain) was dropped, because C1 already decided it.

## levels-content.md

Applied:
1. **D68 status (major).** D68 is now recorded as Moshe's own request of 2026-10-19 ("צריך יותר זמן") that updates D49 for 4 kinds. 60 s is the build default and only the number is open (45 s is the alternative). The "ממתינה לאישור / build per D49" wording and option ג are removed. §13 now says D49 keeps its ✓ status and gets an "updated 2026-10-19 (D68)" note.
2. **Puzzle blind dragging (major). Adjusted.**
   - D71 default is now *no lock* in all chapters. Lock is kept as config and alternatives: chapters 1–3 only, or 1–10.
   - D70c default is now a +5 s penalty (not the critic's +3 s) for a swap that leaves neither swapped box in its place, as `LEVEL_RULES.puzzleSwapPenaltyMs`. It counts as `mistakes`.
   - Math for the 3-cycle: a blind swapper without lock needs 6 swaps on average and has a median of about 14 s at 1.5 s per swap with a 5 s penalty. So with only 3 moving boxes (chapters 1–3, which Moshe explicitly asked for) guessing cannot be prevented. The section now says this honestly.
   - New rule: a "blind swapper" Monte Carlo must not reach ★★★ from chapter 4 on (validate rule plus test).
   - **Corrected after the build (2026-10-20 review):** "never ★★★" cannot hold with 4 moving boxes and ★★★ at 36 s (a blind 4-cycle is ★★★ about 25% of the time). The rule as built: from 4 moving, ★★★ in under 35% of 200 runs (`BLIND_SWAPPER.maxThreeShare = 0.35`). Measured on the shipped levels: 22–30% with 4 moving (chapters 4–7), 3–8% with 5, 0–2% with 6. The spec, levels-content §5.3/§5.7 and plan §7 now say this; reported to Moshe in build-report.md.
   - §5.3 thresholds were recomputed without lock, with thinking at 4.5 s per box: 1–3: 26/36/45, 4–6: 36/48/60, 7–10: 44/54/60, 11–15: 40/52/60, 16–30 unchanged.
   - The view never reports `placed` when the lock is off. Progress is now `{used, mistakes}`.
3. **Id-pinned mobile tests (major).** Added lane ו (same step as the rebuild, lane ד), which moves those tests to a `firstLevelOf(kind)` helper, and a matching test bullet.
4. **levelsSpecDocs.test + DECISIONS-PENDING (major).** Added lane ז (docs plus that test), a new DECISIONS-PENDING item 2.20 for D66–D79, the size string, `kindMaxMs`, and the D49 status.
5. **bossTraits contract (major).** One exact union type in levels-content §6: `firstBot | faster | overlord | moreCells` (moreCells only under D72 ב). `hardBoard` was dropped, because the boss board is the same tier as stages 7–9 (spec §5.3.3), so it is not a real difference. This also covers the levels-ui "hardBoard chip" finding.
   - Adopted `puzzleConflicts: 'none' | 'firstStages' | 'always'`, with `puzzleConflictsFirstStages = 3`.
   - Added `levelOutcome().bossBeaten` (engine verdict). The UI reads it.
6. **Telemetry and deploy order (major).**
   - Server before APK, stated in §0, §7, §11 and §12.
   - `rev` needs `packages/protocol/src/telemetry.ts`, `apps/server/src/telemetry/schema.ts` (+test) and `legal/privacy.ts`, which are now in lane ה.
   - Shared files with friends are listed, with a fixed order (levels first).
   - §27 → §22 for the event list; §27 is kept for the admin filter.
7. **Engine exports (minor).** Lane א owns `levels/index.ts` and adds export lines plus stub files for puzzle, puzzleHost, localLevelHost and boss. New `levels/catalog.ts` exports kindOfLevel, levelRev, LEVEL_REV_BASE and BOSS.
8. **Simulation, calibration and samples (minor). Adjusted.**
   - The fill-region and puzzle simulation is now a Monte Carlo over the same per-cell model, with a `profiles.test` check against the "זמן משוער" columns.
   - Calibration uses only `reason = completed`; timeUp is treated as a lower bound.
   - **The D74 default changed:** calibrate from Moshe's existing chapter-1 staging data, build 1.0.3, then retune from his 1.0.3 play in the 1.0.4 APK, which friends needs anyway. This means no extra build, which matters because drive C is nearly full. The 8-sample staging build is the alternative, and the section says it means one extra APK, via `config/testing.ts`.
9. **Missing tests (minor).** Added:
   - puzzle tests: deadline boundary, paused, after levelOver, penalty, no `placed` without lock, `puzzleExplainSteps`.
   - puzzleHost tests: `react` refused.
   - validate tests: not one cycle, not stepwise, lockOnCorrect mismatch, transposed fillRow, blind swapper.
   - analyticsProps tests: `rev` and puzzle `mistakes`.
   - device checks: D65 freeze in a puzzle, and the 60 s bar on row and column.
   - New engine function `puzzleExplainSteps` in lane ג.

Also reconciled: one "איך משחקים" per kind for fillRow and fillCol (the earlier "one tutorial for both" conflicted with HowToPlayPanels.test, which needs 3 pictures per kind). The first boss (L010) gets the race tutorial with a 4th boss panel instead of two tutorials in a row.

## levels-ui.md

Applied:
1. **Panel goal and transposition (major).** Panel and result goals carry no region index (`goals.fillBox/fillRow/fillCol` say "in one box/row/column"). HUD wording comes from the played target (`fillRegionOf` on the attempt). levels-content D69 already keeps row and column untransposed. Added a test that attempt 2 of fillRow is still a row.
2. **"You beat the boss" (major).** Now from engine `bossBeaten`, and `bossBeatenStars` is removed. Added the test "race boss, 2 vs 3 spots, one star → 'הבוס ניצח הפעם'".
3. **Answer frame (major).** It gets its own look: a dark ring with a white keyline and the digit in a dark chip, drawn on Lv-Focus. It is added to the contrast list, with a test and a device check.
4. **Chapter-1 boss pinned to 5 vs 4 (major).** Rewritten against `bossTraits` and `level.bot`. The medallion appears only under D72 ב.
5. **Incomplete break list (major).**
   - Added to the plan: levelsDocs.test.ts, LEVELS-DEVICE-CHECKS.md, QA-CHECKLIST.md, components.md:851 (new lane UI-5), HowToPlayPanels.test.tsx (UI-4), the admin name (levels-content lane ה, now part of D79), and levelsSpecDocs (levels-content lane ז).
   - Corrected: howToPlayFixtures is not exhaustive. LevelKind lives in the engine's spec.ts, and LevelTutorialKind is derived from it.
6. **Ready per kind (minor).** Table added. The race shows no spot or digit. Ready waits for `attemptOf`; on failure both Ready and the session use attempt 1, with a test.
7. **Contrast (minor).** The denied lock uses `board.wrongDigit` (not `color.danger`). The P1 frames get a `lockEdge` keyline. P2 tint on focusCell/focusCellAlt was added to the contrast checks.
8. **Refusals and TalkBack (minor).** Chose "always call the host and react to `boxFixed`". Drops outside the board or onto the same slot make no call. Each slot gets `onAccessibilityAction('activate')`, with a test.
9. **useStageShell (minor).** UI-3 copies it for PuzzleLevelScreen. Moving TapLevelScreen and GameScreen onto it is a later separate step owned by UI-1.
10. **"Built without a board" (minor).** The sentence was corrected: the dimming was drawn. The colours now get a device check before approval. *Rejected:* a staging-only A/B switch, to keep scope small.
11. **Map boss mark (minor).** Arena corners replace the gold ring, which means "current". Added a LevelTile test.
12. **Plain boss definition (minor).** One sentence in §0 and §3.1. No "hard board" chip.
13. **Wording (minor).**
    - New `hud.subFind` key, so the shared `hud.sub` is untouched.
    - `gate.footnote` is owned by UI-4.
    - Plural keys `_one/_two/_other`, plus `hud.puzzle.allMove` (not `_zero`, which is not a Hebrew CLDR form).

## friends-room.md

Applied:
1. **Link → card (blocker).** The default is now D88 א: the link opens the room directly, as Moshe asked. The card is the alternative. `/v1/rooms/resolve` is built only for the alternative.
2. **10-minute close (blocker).** Away seats are held for 6 h (`lobbyAwayHoldMs`, config safety net), and the host role is kept. A room closes only when everyone left on purpose, all seats expired, or the server restarted. Added a device check where the host waits 15+ min in WhatsApp. *Adjusted:* the critic offered 2–3 h; 6 h was chosen as closer to "no limit", and it is still config.
3. **Category name (major).** Shown as his quote, the proposal and why, as D80b.
4. **XP cap feasibility (major).**
   - Lane S3 now has `game_players.xp`, migration `0009_friends.sql`, `practiceXpUsedOn` summing friends XP, and an xp-row lock in `recordGameEnd`. Tests in practice and persistence cover both orders.
   - The stealth-bot migration became `0010`.
5. **Seat takeover (major).** The same account re-joining takes over its seat (away, or connected elsewhere) and keeps host. The app stores the current room code and returns on a cold start. Tests and a device check were added.
6. **C1 (major).** The domain question was removed. The production link is stated per C1.
7. **Start counts away players (major).** The button counts only connected players. The host confirms "להתחיל בלי Avi?" (D83 is now a question, with 3 options).
8. **GameRoom changes (major).** The five hooks are listed explicitly (roomId, auto-start, lobby drop/alreadyInRoom, lobby payload, config/recorder). The existing GameRoom and ranked tests must pass unchanged. Composition is noted as the alternative. A test checks that roomId is not the code.
9. **D-number repeats (minor).** Every question has its own id (see Numbering).
10. **Chip tests and count (minor).** `ModesRanked.test.tsx` and `ranked.e2e.test.tsx` are added to M2. *Rejected:* HomeAccount.test.tsx, because grep shows it does not assert the ranked chip. The D7-A trade-off is stated. The count is reconciled: 6 rows (8 with the two group titles) → 8 entries.
11. **Telemetry compatibility (minor).** Corrected: a 1.0.2+ server skips unknown names, and only an older server refuses the batch. Added §22, §23 and DECISIONS-PENDING 2.8 to the docs list.
12. **build-apk (minor).** Added to M3: the host joins `nativeInputs`, and there is no `autoVerify` for the local http server, with a test.
13. **"סעיף 12" wording (minor).** Fixed: "§5 במקור … הפירוט בסעיף 12 של המסמך הזה".
14. **Missing tests (minor).** Added:
    - Jest: roomId ≠ code; the production config refuses the public debug-key SHA-256; rate limit on start/setGameType/kick; `+not-found`; Reduced Motion on the toast and seat join.
    - Device: §6.6 (a link during ranked, search, frozen practice); app killed; host waits 15 min; block inside the lobby.
    - The behaviour of a block inside the lobby is now defined: the blocked player leaves with a neutral "יצאת מהחדר".
15. **Block leak (minor).** D85c default: the blocked player sees `notFound`, like a wrong code; the blocker sees "חסמת שחקן שנמצא בחדר הזה". Options are listed.
16. **Shared files (minor).** Added a "shared with other plans" block covering both levels and stealth, with a fixed order.

Version change: friends now ships as **1.0.4** (after the 1.0.3 levels fixes). `sed` changed the version mentions in the file. A note in the header says that "1.0.2" in the text means any old app.

## stealth-bot.md

Applied:
1. **"אייקונים" = reactions (blocker).** Read per original §18. D97b default is no reactions (`reactions: {}`). The temperament table is kept only as the alternative. §0, §1, §3.4, §5.5, §9, the tests and device check 2 were updated. §9 asks Moshe to say so if he meant only a bot badge.
2. **Retaliation window (major).** If blocked, the bot retries every second only until end+20 s, then skips. The section says plainly that this is a small change from his request. D98 options were rewritten. Tests: never after T+20000, and no points means no retaliation. Device check 3 was reworded.
3. **D96 practice pace (major).** The default is now ranked-only, measured on the server, with the §21/D58 rationale. Added a per-player guard: a personal paceScale steps down after more than 65% wins in the last 10 stealth games.
4. **Strict schema (major).** No app change in v1. §13 documents the future path: a separate endpoint, or a server that accepts unknown fields shipped first; clamp, never reject. It lists router.ts, practiceQueue.ts and session.ts.
5. **D95 hides "nobody" for unreachable players (major).** `nextRange` is withheld only when a free persona is reachable within the player's max range. Otherwise `null` is sent, as today (3.22 behaviour kept). Added a server test and device check 11.
6. **Kill switch (major).** A runtime admin toggle stored in the DB (`stealth/switch.ts`) is in v1 scope. The env var stays as the master switch. §8 explains why a restart is not acceptable.
7. **FAQ does not exist (major).** Disclosure now goes in the terms (reachable from Settings) and the reviewer notes. FAQ is a future server page. The 2.3.1 end-user clause is stated honestly in §3.3 and D93.
8. **Device check 9 (minor).** Rewritten for ranked (no D65 freeze): soft phase, then freeze. Added a test that the retaliation timer pauses only while frozen.
9. **Original §24 (minor).** Added to §2 and the §14 table. "Retaliation only" is recorded against original §20 in the D98 row.
10. **Privacy misquote (minor).** The row was rewritten. It no longer quotes "to whoever plays with you".
11. **Persona tells (minor).**
    - A 0.3–1.5 s ready delay.
    - Lazy persona creation, so the "playing since" dates spread naturally.
    - The friends-tab vs leaderboard gap is named in §6 and D99.
    - A name reset gives a new invented name.
    - Selection excludes suspended, deleted and nameResetRequired personas.
    - Tests for all of these.
12. **Interference kinds (minor).** The persona declares all kinds, so the room's kinds equal the human's. The retaliation kind is drawn from the room kinds unlocked at the persona's level. Added a server test.
13. **Public seed (minor).** The bot RNG is seeded from an HMAC of a server secret and the game id, stored server-side. Added a test.
14. **Circular self-check (minor).** Replaced with a closed-loop test: a human model → movePace → stealthBotLevel → the bot. The bot's mean per move must be within ±10% of the model's raw mean. The "כמוך" claim now says this is a target that must be calibrated (`cellChoiceTemperature`).
15. **"Before approval" (minor).** §10 now says "after you approve the plan, before D90".

## Cross-file reconciliation

- **Kind ids** match in both levels files: find (UI name "מיקום מדויק" / Pinpoint), fillBox, fillRow, fillCol, puzzle, findDuel, duel, spotError, chain, pointHunter.
- **Chapter-1 boss** is a race against Pip at ×1.1 in both files. The no-bot medallion and moreCells appear only under D72 ב.
- **Puzzle view and events** match: slots {id, state movable|fixed|placed-only-with-lock}, swaps, mistakes, minSwaps, lockOnCorrect, conflicts; `boxesSwapped{from,to,penaltyMs}`; refusals boxFixed/badCell/paused/over; `GameHost.swapBoxes`; `session.swap`.
- **Lane order:**
  1. levels-content lane א.
  2. Lanes ב and ג, with ה in parallel.
  3. Lanes ד and ו together (rebuild plus id-pinned tests), followed by levels-ui step 0 (exhaustive switches).
  4. UI-1 to UI-4, then UI-5 (docs) after the boards are approved.
  5. Friends after 1.0.3 for the shared files. Stealth server work after friends (GameRoom, records, schema). The stealth engine lane can run any time.
- **Migrations:** 0009_friends, then 0010_stealth_bot.

## Open risks the next session should keep in mind

- The puzzle thresholds and the blind-swapper bound are model estimates. The validator/simulation must confirm them, and the report goes to Moshe before freezing.
- **The 6 h away-seat hold** keeps Colyseus rooms (and `allowReconnection` timers) alive for hours. Check memory and timer behaviour on the single Fly machine during S1.
- **A seat takeover while a game is live** is ranked-path behaviour; only lobby takeover is specified. Confirm during S1 that the in-game reconnection path is unchanged.
