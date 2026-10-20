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
   **2026-10-18: Moshe said "start, version 1.0.2" (all 20 §9 defaults taken).** Workflow wf_5d968442-e66 wrote
   `staged-practice/dev-plan.md` (Hebrew dev plan + test list, D48–D64, 12 sub-stages 2א–2יב) and
   `staged-practice/dev-lanes.json` (13 build lanes, no shared file owners); 2 critics, 44 findings, revised.
   WAIT for Moshe's OK on dev-plan §5.3 (9 questions with defaults); then build lane by lane per dev-lanes.json.
   **BUILT 2026-10-19 (uncommitted):** build workflow wf_bfeaaf0e-b13 (13 lanes) + finish workflow wf_80944165-46a
   (practice freeze D65 in solo/bot, chain D64 back to pending with 'accept' default + staging-only "בדיקה" switches
   for chain penalty and "unlock all stages", levels.json ~171 KB accepted, 3 focused reviewers: 3 real findings fixed).
   Final `npm run verify` green: 444 suites / 10015 tests; format:check clean. app.json 1.0.2, ENGINE_VERSION 0.3.0.
   Device checks: docs/LEVELS-DEVICE-CHECKS.md. Next, only with Moshe's OK: commit → push → staging server deploy
   (migration 0008; no puzzle seed needed) → APK 1.0.2 (one ABI; C: has ~11 GB free).
   **2026-10-19 (Moshe: "go 1+2+3"):** commit 00c3249 pushed; staging deployed (health engine 0.3.0, /v1/me/levels
   answers 401 without auth); APK 1.0.2 built against staging (see apps/mobile/apk/). Next: Moshe tests on devices.
   **2026-10-19/20 Moshe's 1.0.2 device feedback (7 items) + 2 new features.** Plan workflow wf_994f1f85-721 wrote
   `docs/handoff/2026-10-19/` (plan.md for Moshe, levels-content.md, levels-ui.md, friends-room.md, stealth-bot.md,
   critique-log.md; decisions D66–D99). Moshe (2026-10-20): "את הסעיפים הממוספרים תבצע בלי לשאול" → items 1–7 BUILD with
   every recommended default (D66–D79); friends room (D80–D89) and stealth bot (D90–D99) PLAN ONLY, wait for his answers.
   Build workflow wf_59df1b94-5d3 (lanes A → B/C/E/UI-4 → content rebuild → UI-1/2/3 + docs → integrate → 3 reviewers +
   skeptics → fix) writes `docs/handoff/2026-10-19/build-report.md` at the end. Uncommitted. Next, only with Moshe's OK:
   commit → staging server deploy FIRST (new kinds in telemetry) → version:bump 1.0.3 → APK (no native change).
   **BUILT 2026-10-20:** all 7 items; 13 review findings, 12 confirmed and fixed. Re-checked by the main session:
   `npm run verify` exit 0 (462 suites / 10,619 tests), format:check clean. Then the main session changed the
   staged-practice tagline to "שלבים קצרים · עד 3 כוכבים" / "Short stages · up to 3 stars" (fill/puzzle are 60 s now;
   app + 2 tests + 01-SPEC §5.1 + QA-CHECKLIST + components.md; those tests pass). Details: build-report.md.
   Waiting for Moshe: device test after his OK for commit/deploy/APK; answers on D80–D99 (friends room, stealth bot).
   **2026-10-20 Moshe: "כן כן כן לך עם ברירות המחדל, תמשיך לבנות"** (D80a, D90, D92 yes; D80–D99 defaults). The 1.0.3
   tree was snapshotted as `refs/checkpoints/levels-1.0.3` (commit object 4cb18cc, not on a branch, not pushed). Build
   workflow wf_eb8a2cf6-51d built the friends room (1.0.4, needs a NEW native build: expo-clipboard + intent filters;
   migration 0009) and the stealth bot (server only, OFF by default; migration 0010; switch-on steps in
   build-report-features.md §6, only on Moshe's word). 12 review findings, 11 confirmed and fixed. Report:
   `docs/handoff/2026-10-19/build-report-features.md` (release order §7). Still uncommitted. Moshe must give the EAS
   SHA-256 (App Links for EAS-signed APKs). C: had 8.2 GB free on 2026-10-20.
   **2026-10-20 Moshe: "יש אישור. תסיים הכל. תכין לי APK DEBUG".** Done: app.json 1.0.4; commits a61c8fe (1.0.3 levels)
   and f5d160f (friends + stealth OFF + 1.0.4) pushed; staging deployed f5d160f (health engine 0.4.0, migrations
   0008–0010, log "stealth bot off", /r/123456 page and assetlinks with the RN debug key OK). Debug APK: clean prebuild
   with EXPO_PUBLIC_SERVER_* = staging (intent filter host sudoku-fight-staging.fly.dev), `gradlew assembleDebug
   -PreactNativeArchitectures=arm64-v8a`, copied to apps/mobile/apk/debug/. It loads JS from Metro (`npm run mobile`
   on the PC; .env.local points at staging). Next: Moshe's two-phone test (docs/FRIENDS-DEVICE-CHECKS.md,
   docs/LEVELS-DEVICE-CHECKS.md 12–19); the stealth bot is switched on only when he says (build-report-features.md §6).
   **2026-10-20 Moshe: "להדליק".** f7b9090: STEALTH_BOT_ENABLED="true" in fly.toml (staging only; deploy.test enforces
   production without it); STEALTH_BOT_SECRET set as a fly secret (never printed). Deployed: log "stealth bot available:
   the admin switch decides". The admin switch (admin site → "בוט סמוי" → "המתג") is Moshe's click (audited; admin login
   is his Google account). Production: still without the bot.
4. **Only with Moshe's OK:** `npm run version:bump` → commit → push → deploy staging (server FIRST: migration
   0007 runs; then `npm run db:seed-puzzles` against staging) → `npm run apk` (see docs/BUILD-APK.md; check free
   space on C: first).
   **2026-10-18 (Moshe asked before sleeping):** version 1.0.1, commit b0efb9f pushed, APK built:
   `apps/mobile/apk/sudoku-fight-1.0.1-b0efb9f-staging.apk` (68 MB, clean tree).
   **Later on 2026-10-18 Moshe ran both himself: staging deployed (engine 0.2.0, health passing) and the seed
   printed fast/normal/hard 2000 each, 2000 retired in fast and normal. Batch 2 + interferences are LIVE on
   staging.** Next: Moshe tests APK 1.0.1 on devices. (History:) The staging DEPLOY and the
   staging puzzle seed were first blocked: Claude Code's permission classifier blocked `fly deploy`. Moshe runs them
   (or allows them): from the repo root `fly deploy --ha=false --env GIT_SHA=b0efb9f`, then in PowerShell
   `$env:DATABASE_URL = (fly ssh console -a sudoku-fight-staging -C "printenv DATABASE_URL").Trim()`;
   `npm run db:seed-puzzles`; `Remove-Item Env:DATABASE_URL`. No restart needed (the server queries puzzles per
   game). Until then the new APK still matchmakes (the old server ignores the new join field; only the old three
   interference kinds appear), but penalty/grace/black-screen/givens/retire server changes are not live.

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
