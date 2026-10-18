# המשך עבודה בסשן חדש

**למשה:** בסשן החדש כתוב רק: "קרא את docs/handoff/NEXT-SESSION.md ותמשיך".
**חשוב:** לסשן הבא צריך להודיע לפני כל קומפילציה, commit, דיפלוי או העלאה לחנות. כל אלה רק באישור שלך.

---

# Instructions for the next Claude session (written 2026-10-17)

## 0. Ground rules learned the hard way
- **Every message to Moshe in Hebrew**, including one-line status notes between tool calls and the first reply
  after a resume. He gets upset at English (memory: hebrew-only.md).
- **Tokens are scarce.** Moshe ran out of weekly quota on 2026-10-15. Keep workflows lean: few agents, one
  reviewer per item, one skeptic per finding; don't re-investigate what is already designed (designs are in
  `docs/handoff/2026-10-15/designs/`). Read big results from files with node one-liners, not whole.
- **Never `cd` into another directory in Bash** (it moves the session cwd, and workflow agents then start in the
  wrong folder). Use absolute paths.
- Workflow prompts must say Moshe asked explicitly (otherwise agents refuse), and that mid-run chat messages are
  for the main session.
- No APK, no native build, no deploy, no commit unless Moshe asks (CLAUDE.md). Moshe said: no APK until he says.
- Several agents in one working tree: each edits only its files, never reverts others' changes, prettier only on
  its own files (docs/ is prettier-ignored).

## 1. Where everything is
- `docs/handoff/2026-10-15/README.md`: history of this batch.
- `docs/handoff/2026-10-15/designs/`: one investigated design per item (`*.json`) + `DECISIONS.md` (all
  rulings, incl. Moshe's own — they override the designs).
- `docs/handoff/2026-10-15/implement-reports.json`, `implement-rest-reports.json`, `implement-final-reports.json`
  (if present): what each implementation agent changed (`filesChanged`, `notesForOtherItems`, `openIssues`).
- `docs/handoff/2026-10-15/staged-practice/`: the staged-practice plan (`plan.md`, Hebrew) and the design
  canvas files (`project/*.dc.html`, `canvas.json`), published at
  https://claude.ai/artifact/AMPft1sb9u3LaVsmvJCL6N (version 8).

## 2. State of Moshe's second device-test batch (all UNCOMMITTED in the working tree)
Done and tested by their agents:
1. Keep screen on (app-wide; release builds only).
2. New-game screen: ranked 2/3/4 one per row, bot above solo, new robot icon, smaller rows.
3. Matchmaking: `nextRange` in `searching`/`timeout`; "no other players searching" notice.
4. Rating refresh after a ranked game (optimistic + `/v1/me` polling + focus/foreground refresh).
5. Wrong-digit penalty = the points the correct digit would have scored (old 2^(k-1) scale removed completely).
6. Givens: fast 45–50, normal 35–40, hard unchanged; migration 0007 retires old fast/normal ranked rows.
7. Black screen at the end of online games (hold before results, no navigation inside the socket callback, modal
   closing, fallbacks, watchdog, Crashlytics breadcrumbs, server keeps a finished room for an away player).
8. Retire rating guards (leaver not hurt if the opponent had no lead or he made no move; stayer gains nothing if
   he made no move or the leaver led).
9. Grace period engine + protocol (D42 soft phase 10 s → existing 15 s hard phase).

10. Grace period server + mobile + docs (offline play with queued moves, "unstable" mark, D42 in 01-SPEC).

**FINISHED 2026-10-17 (workflow wf_221675c8-f73):** all 10 items done; ENGINE_VERSION bumped once; a reviewer per
item found 16 issues, 12 confirmed by an independent skeptic and FIXED with tests. Final `npm run verify`: lint,
typecheck, i18n clean; Jest 372 suites / 8644 tests all passing; prettier clean. Reports (incl. every finding
and verdict): `docs/handoff/2026-10-15/implement-final-reports.json`. Still uncommitted.
Remaining device-only checks are listed in docs/STAGE7-DEVICE-CHECKS.md (new 2ג) and docs/QA-CHECKLIST.md.

## 3. Next work, in order
1. (Done.) Suggest to Moshe to commit the finished batch before starting new work (only if he agrees).
2. **Interference improvements in the real game** (Moshe 2026-10-17). Designs: `designs/interference-rules.json`
   + `designs/interference-ui.json`; rulings: the last section of `designs/DECISIONS.md` (no interferences in
   known-bot games; icon button "הפרעה" on each opponent's card; two taps, NO DRAG — record as Moshe's decision
   replacing original §16, never edit the original; 3–4 players: target = the tapped card; compact 3×2 picker,
   clear prices; new kinds scramble / keypad / ink unlocking at levels 2/3/4; 60% board dim; old-app safety:
   rooms only use kinds every app supports). Moshe saw these choices in Hebrew; if he changed any, follow him.
   Implement in one lean workflow (engine+protocol+server → mobile+docs), then `npm run verify` and a short
   review.
   **DONE 2026-10-18 (workflow wf_e750eff6-7ae):** lanes core → mobile-picker + mobile-effects, docs in
   parallel; verify; one reviewer per lane, one skeptic per finding: 12 findings, 11 confirmed and fixed. Final
   `npm run verify` green: Jest 380 suites / 8891 tests. D-numbers: D44 no bot interferences, D45 two taps,
   D46 board dim 60%, D47 scramble/ink/keypad + unlock 2/3/4 + room kinds (old apps get the old three).
   Reports (every lane, finding, verdict, fix, open device checks): `docs/handoff/2026-10-15/interference-reports.json`.
   Open for Moshe: placeholder sounds hit_scramble/hit_ink/hit_keypad; no design boards for the new picker/effects
   (Arsenal/Interference-Target boards marked old); store listing still names only the old three (still true);
   torch added to the "coming later" list next to earthquake/fog/bubbles.
3. **Staged practice ("אימון בשלבים")**: WAIT for Moshe's approval of the plan (canvas v8 + `plan.md`, 20 open
   questions with recommended defaults). When he approves: write a development plan (CLAUDE.md: plan + test list
   first), then build. Rulings so far: no interferences; every level ≤30 s; difficulty from speed/logic, not
   quantity; 300 levels / 30 chapters; unlock after playing the previous level; ≥20★ of 30 in the previous chapter
   to open the next; the sixth row on the new-game screen is Moshe's decision (original §5 said five options).
4. **Only with Moshe's OK:** `npm run version:bump` → commit → push → deploy staging (server FIRST: migration
   0007 runs; then `npm run db:seed-puzzles` against staging) → `npm run apk` (see docs/BUILD-APK.md; check free
   space on C: first).

## 4. Open points to tell Moshe when relevant
- Wire/snapshot sizes slightly over spec §18 targets (an interference event with a half-point score 206 B; a
  worst-case 4-player snapshot 4105 B). Accept or slim.
- Balance not recalibrated: mistakes cost ~6–9 points now; fast/normal boards give fewer points per move; bot
  slow-down (25), level-2 bot interference (15), Comeback (15), GameType card durations — tune after test games.
- Device checks after the next APK: new-game rows on the S22, 4-player penalty pips, the matchmaking "alone"
  notice, keep-awake, the black-screen fix (surrender / opponent leaves while a lock is held), the grace period
  (airplane mode 5 s / 14 s / 30 s).
- Server changes (penalty, matchmaking, givens, retire rating, grace, black screen) work only after a staging
  deploy; deploy the server before handing out the APK.
