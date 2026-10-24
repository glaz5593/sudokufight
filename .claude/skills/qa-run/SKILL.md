---
name: qa-run
description: Run a QA test run on Android phones over ADB and record results in the server's QA module, or read/handle QA bugs. Use ONLY when Moshe asks to run tests ("תריץ בדיקות", "תפתח תהליך בדיקות", "תבדוק את …") or asks about/fixes QA bugs. Never start a run on your own: it costs many tokens.
---

# QA run (server QA module)

The catalog (categories → subcategories → tasks, Hebrew) is `apps/server/data/qa-catalog.json`. A run is a
snapshot of it on the server. The API is `/admin/api/qa`. Plan: `docs/handoff/2026-10-23/qa-module/plan.md`.

Tools (from the repo root; `--server staging` is the default, `--server local` for a dev server):
- `npm run qa -- <command>` (`apps/server/scripts/qa.ts`, see its header): runs, open, run, task, mark, fix, bugs, close, catalog.
- `npm run adb -- <command>` (`apps/server/scripts/adb.ts`, see its header): devices, ui, tap, swipe, type, key, shot, launch, stop, link, version, reset.
- Staging is open (QA_OPEN, Moshe's decision 2026-10-24): no key needed. A local key file, `%USERPROFILE%\.sudoku-fight\qa-agent.token`, is sent if it exists (the local `.env` has the same key). Never print it, never pass it on a command line, never copy it into the repo, a doc or memory.

## When Moshe says to run tests
1. **Check the setup.** Run `npm run adb -- devices` (pick one with `--device <serial>` if several). Run `npm run adb -- version` for the app version. If no phone, tell Moshe in Hebrew and stop.
2. **Open a run.** Name it as Moshe said, or `<date> · <categories> · Claude`:
   `npm run qa -- open --title "..." --app-version <version> --device "<model>" --platform android --who claude [--categories a,b]`
   Only the categories he asked for; `npm run qa -- catalog` lists them.
3. **For each task** in `npm run qa -- run <id> --todo`:
   - Read it with `npm run qa -- task <id> <taskId>`.
   - Do the steps with `adb`. Read the screen with `ui` (text, cheap). Take a `shot` (then Read the PNG) only when the look itself is what the task checks.
   - Every expected line seen → `npm run qa -- mark <id> <taskId> pass --note "<device> <version>"`.
   - Otherwise → `fail` or `partial` with `--actual "<what actually happened, in Hebrew, concrete>"`.
   - It needs Moshe (judgement of feel, sound or haptics, Hebrew typing, iOS, WhatsApp, Google popup), or a precondition you can't reach → leave it untested: `mark … untested --note "נשאר למשה: <why>"`.
4. **At the end:**
   - Run `npm run adb -- reset`.
   - Leave the run open, so Moshe can do his tasks and the "both" ones.
   - Report to Moshe in Hebrew: the counts, and every fail or partial (task id, title, what happened).

## Rules on the phone
- **Ask Moshe first** before anything that destroys data: uninstall, clearing app data, signing out an account he uses, factory settings.
- Airplane mode cuts wireless adb. Use USB, or skip.
- Never use `adb reverse` in disconnect tests (STAGE7).
- `type` is ASCII only. Names in agent runs are English, for example Fake1.
- The fake client (`npm run fake-client`) on staging needs a real Firebase ID token (`--token`). Without one, use a second phone, or leave the task for Moshe.
- **Save tokens.** Prefer `ui`; don't re-dump a screen you just read; don't screenshot every step.

## Bugs (when Moshe asks, or while fixing)
1. `npm run qa -- bugs` lists the active bugs: open and reopened, each with steps, expected and what happened. Add `--status all` to see every bug.
2. After the fix is in the code:
   `npm run qa -- fix <runId> <taskId> --fix-note "<what was done, Hebrew>" --fixed-in "<app version> (<short sha>)"`
   For a server-only fix, use `--fixed-in "שרת <sha>"`.
3. Moshe verifies a fix on the run's screen. V marks it "אומת"; "לא עבר" marks it "נפתח מחדש".
4. A long Hebrew text can go in a UTF-8 file in the scratchpad, passed with `--actual-file`, `--note-file` or `--fix-note-file`.
