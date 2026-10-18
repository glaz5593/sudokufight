# Handoff: Moshe's second device-test list (2026-10-15)

Moshe tested APK 1.0.0 and asked for 12 fixes/changes. On 2026-10-15 he ran out of weekly token budget and asked
to stop at a clean point. **Nothing is committed** (commit only when Moshe asks). **Do not build an APK at the end
of this batch** (Moshe: more changes are coming).

## Files here
- `designs/*.json`: the read-only investigation of every item (summary, root causes, full design, files, tests,
  docs, risks). `designs/DECISIONS.md`: the main session's rulings, incl. Moshe's own rulings. It overrides the
  designs where they differ.
- `implement-reports.json`: what each implementation agent did (files, tests, deviations, open issues,
  `notesForOtherItems`). Read the notes before continuing.
- `implement-workflow.js`: the workflow that ran (INV already points here). To continue, keep only the remaining
  `run(...)` calls (retire, black, grace×3) and pass the done reports as `notes(...)` text instead of promises.

## Done (in the working tree, uncommitted)
1. **Keep screen on**: app-wide while the app is open (`displayConfig.keepScreenOn`, `src/services/keepAwake.ts`,
   expo-keep-awake as a direct dependency). Only visible in a release build.
2. **New-game screen**: ranked 2/3/4 each on its own row, practice vs bot above solo, redrawn robot icon in P2,
   smaller rows so a sixth row ("staged practice", not built) fits. Check on the S22.
3. **Find opponent**: `searching`/`timeout` carry `nextRange` (null = nobody compatible is searching) → the app
   shows "no other players are searching right now" + play vs bot. Needs a server deploy.
4. **Rating refresh**: optimistic new rating at once, `/v1/me` polled until the game is stored, Home focus and app
   foreground re-read (throttled 30 s). Client only.
5. **Wrong-digit penalty** = the points the correct digit would have scored at that moment (§6.4 formula).
   01-SPEC §6.5 + D14 updated as Moshe's decision. Needs a server deploy.
6. **Givens**: fast 45–50, normal 35–40 (seeded, digit-balanced, technique kept); **hard identical to before**
   (verified: same ids and givens). Migration 0007 retires old fast/normal ranked rows (not deleted).

Verified at the stop (2026-10-15): `npm run lint` clean, `npm run typecheck` clean, `npm run i18n:check` 0 errors,
`npx jest` 365 suites / 8374 tests all passing. No adversarial review has been run on these six items yet.

## Remaining, in this order
1. **Penalty clean-up (Moshe's ruling)**: remove the old 2^(k-1) scale COMPLETELY. Today the code still has
   `rules.mistakePenalty: 'missedPoints' | 'doubling'` and `doublingPenalty(k)`. Delete the switch and the
   function, their tests and doc mentions; keep the server refusing unknown rule keys. Old replays without
   `mistakePenalty` data must still render (no penalty line).
2. **Retire rating guards**: `designs/retire.json` + DECISIONS.md "retire".
3. **Black screen**: `designs/black-client.json` + `designs/black-server.json` + DECISIONS.md "black-screen".
4. **Grace period**: `designs/grace.json`, in three steps: engine+protocol → server → mobile+docs. Move the retire
   snapshot to the first loss event (DECISIONS.md "grace").
5. **Integration**: bump ENGINE_VERSION once; `npm run verify`; an adversarial review of every item against
   Moshe's words; fix what is confirmed.
6. **With Moshe's OK only**: `npm run version:bump` → commit → push → deploy staging (server first, then
   migration 0007 runs, then `npm run db:seed-puzzles` against staging) → `npm run apk`.

## Open points reported by the agents (tell Moshe when relevant)
- Wire size: an interference event with a half-point score is 206 bytes (spec §18 targets 200). Accept or re-encode.
- Balance not recalibrated (by decision): mistakes now cost ~6–9 points; fast/normal boards give fewer points per
  move. Bot slow-down (25), level-2 bot interference (15), Comeback (15) and GameType card durations may need
  tuning after test games.
- Device checks: the new-game rows on the S22, the compact-card penalty pips in a 4-player game, the matchmaking
  "alone" notice (STAGE9-10 checks 1/1א rewritten), keep-awake (release APK only).
- DECISIONS-PENDING got 3.22 (matchmaking) and 3.23 (staged practice vs "five options only" in the original §5).

## UPDATE — stopped again 2026-10-15 evening (Moshe at 98% of his weekly quota)
- Workflow wf_abd65f2c-bb0 finished: **penalty clean-up (old scale removed), black screen, retire rating guards**
  (reports: `implement-rest-reports.json`). It was STOPPED during **grace:engine+protocol** → the repo holds
  PARTIAL grace engine/protocol edits. Next session: run `git diff --stat`, finish grace (engine → server → mobile)
  from `designs/grace.json`, then ENGINE_VERSION bump + `npm run verify` + review. No full verify was run after
  these three items.
- **Staged practice (Moshe's "תוספת 1")**: design + plan only, no app code. Files in `staged-practice/`
  (plan.md in Hebrew, brief.md, project/*.dc.html artboards + canvas.json). The final critic/fixer was stopped
  mid-run (some artboards may be half-reviewed). Canvas artifact (empty so far):
  https://claude.ai/artifact/AMPft1sb9u3LaVsmvJCL6N — publish with url + root = staged-practice, canvas.json
  first then Main, then the rest (read every file fully before publishing). Show Moshe; develop only after he
  approves.
