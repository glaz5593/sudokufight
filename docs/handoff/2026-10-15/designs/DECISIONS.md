# Main-session decisions for Moshe's 2026-10-15 batch

These override the "recommendedDefault" in each item's design JSON where they differ.
Everything else: take the design's recommended default. Every tunable value goes into rules/config (not literals),
so Moshe can change it later.

## All items
- Moshe asked for every item explicitly in this session (2026-10-15). Where a change replaces a rule of the original
  spec (penalty §13), record it in docs/01-SPEC.md as Moshe's decision: the section text + the §24 table row with
  status "✓ החלטת משה 2026-10-15". NEVER edit docs/00-original-spec-v1.md.
- New D-numbers: grace period = D42. Puzzle givens = D43 (only if a new row is needed; otherwise amend D5).
  Penalty amends D14 (row becomes ✓, the cap is obsolete). Retire rating amends D32/D8. Others: no new D-number.
- Do NOT bump ENGINE_VERSION / PROTOCOL_VERSION in your item; the final integration step bumps ENGINE_VERSION once.
- No APK, no native build, no deploy, no commit, nothing against staging/production.

## penalty
- Penalty = points the correct digit would have scored at that moment (§6.4 formula on the board before the
  entry). MOSHE (2026-10-15, explicit): "no need to keep it in the settings, it was an illogical calculation" →
  REMOVE the old 2^(k-1) scale completely (no 'doubling' option, no mistakePenalty rules switch). Remove the D14 cap.
  Write the new rule into 01-SPEC as Moshe's decision.
- Replay shows the penalty explanation line for wrong moves (only for games played under the new rule).
- Applies to all modes (solo, bot, ranked). Do not recalibrate bot/comeback thresholds now.

## matchmaking
- Recommended defaults as in the design (nextRange in `searching`/`timeout`, null → "no other players are searching
  right now" + "play vs bot meanwhile" + the existing cancel; D6 widening unchanged; 60 s timeout stays with its own
  wording for the alone case; no jump).

## newgame-screen (+ keep awake)
- Order: ranked 2p, ranked 3p, ranked 4p (each its own full-width row), then practice vs BOT, then practice solo.
- Rows: the smallest reduction that lets a SIXTH row (future "staged practice") fit without scrolling on 360×780 dp
  with 3-button navigation, footnote kept. Prefer title 18 (sheetTitle) with tighter padding; fall back to 16 bold
  only if 18 cannot fit. Keep the ScrollView as fallback. No placeholder card for staged practice.
- Bot icon: redrawn robot (bigger eyes, a mouth), in P2 colour, in a P2-tinted frame, as on the design board
  (Modes.dc.html / DS-Components). Note the exception in docs/design/components.md. Check TimeoutView's use.
- Keep awake: app-wide while the app is open, `displayConfig.keepScreenOn` (default true), no settings toggle.
  Add expo-keep-awake as a direct dependency of apps/mobile (same version as the installed transitive one).

## rating-refresh
- As designed (client-only): show the server-computed new rating at once (in memory), re-read /v1/me with backoff
  until the games count for that rating key increases (give up after 2 min), then refresh progress/card;
  Home focus + app foreground re-read /v1/me throttled to 30 s (immediately if the profile came from cache).
  Android back on results: unchanged.

## black-screen (two designs: black-client.json and black-server.json — implement them together)
- Client: online non-board-complete ends hold the final board ONLINE_END_HOLD_MS = 600 ms (200 ms with Reduced
  Motion) before opening results, and the navigation is scheduled OUTSIDE the WebSocket/host callback.
  Practice ends: also never navigate synchronously inside a host callback.
- Replace the lock ring / seconds pill Reanimated `exiting` layout animations with a navigation-independent fade
  (same 240 ms; 200 ms or none under Reduced Motion).
- Close every native Modal (report sheet, block dialog, any Sheet) and wait for it before navigating to results.
- Every terminal null/empty render (app/game.tsx, app/match/index.tsx, MatchScreen 'cancelled', GameScreen missing
  card) gets a visible fallback with a way home. Add a watchdog: if results did not open N s after the end
  (config), show a fallback with "to results" / "home".
- After the game is over, stop the reconnect loop (no reconnect against a finished room).
- Release diagnostics: send host/matchmaking log lines as Crashlytics breadcrumbs in release (never tokens/PII) and
  report swallowed listener exceptions as non-fatal errors.
- Server: keep a finished room alive (up to the existing closeAfterGameMs 60 s) while a player who has not
  received the end is away — reserve his seat after the end; close immediately as today when everyone got it.
- NOT now: the server 'stored' message (rating-refresh polls instead), fetching results from history for a player
  who returns after the room closed.

## retire (rating guards)
- Defaults as designed: judged at the moment of the connection loss for abandonment (rules.rating.abandonJudgedAt
  = 'disconnect'), at the moment of surrender for surrender; tie → leaver loses nothing, stayer (if he moved) gets
  the full win; the game still counts in `games`; XP/stats unchanged; no minimum-moves threshold; "move" = a digit
  entry (correct or wrong); abandonPenalty waived when guard (a) holds; clamp semantics.
- The grace-period item (implemented AFTER you) will introduce a soft disconnect (playerConnectionLost) before
  playerDisconnected; write the snapshot so it is easy to take at the first loss event. Leave a clear note.

## givens
- MOSHE (2026-10-15, explicit): "HARD must not change — keep what exists today. Add givens only to normal and fast."
  → Hard puzzles are left EXACTLY as they are (all of them, including those with 22–23 or 29 givens): same givens,
  same ids, no drop, no backfill, no rule range enforced for hard (document hard as "as today, ~22–29").
- Fast 45–50, normal 35–40: seeded, digit-balanced fill that preserves the technique grade; fast/normal puzzles
  that can't fit are dropped and backfilled with the generator to keep ≥2000 ranked per type (and ≥200 offline per
  type); old fast/normal ranked rows retired via a migration column (not deleted — old games/history/replay still
  point at them); offline file regenerated; old practice history/replays must keep working.
- Seed only into a local PGlite DB for testing. Never run seeding against staging/production.
- Leave GameType card durations as they are; update the "in practice" sentence in 01-SPEC §6.4.

## grace (implemented last, in three steps: engine+protocol → server → mobile)
- Defaults as designed: softGraceMs 10 s, then the existing 15 s hard grace (abandonment ≈25 s); offline move lost
  only if the cell isn't free for him on return, no penalty, short message; soft-phase moves still count if he
  returns before abandonment; no interference at a soft-offline player; his server lock keeps running; deliberate
  leave = hard at once; surrender disabled while offline; a locally selected cell without a digit is re-selected
  on return if free; mark = amber dot + wifi icon, avatar not dimmed.
- The retire snapshot ("judged at the moment of the connection loss") must be taken at the FIRST loss event
  (playerConnectionLost when soft), kept through the hard phase, cleared on reconnect.

## interference improvements (Moshe 2026-10-17) — designs: interference-rules.json + interference-ui.json
Implement AFTER the grace item + its review are done (shared files: engine interfere/view, PlayerCard ⚡ slot,
GameScreen, i18n game.json). Where the two designs differ, these rulings apply:
- Known-bot games: INTERFERENCES_BY_MODE = { solo: false, bot: false, ranked: true }; bot never interferes;
  reword BotSelect level copy that mentions interfering. (Staged practice: none either.)
- Button: an icon button on EACH OPPONENT'S card (original §10 "אצל היריב: לחצן הפרעה"), same size as the smiley
  reactions button, label only "הפרעה" / "Interfere", no price on it. Disabled → dim; a tap shows a short toast with
  the reason + light haptic.
- Activation: two taps (button → type in the popup), NO DRAG (replaces original §16 by Moshe's explicit decision,
  record in 01-SPEC as his decision 2026-10-17; never edit the original). 3–4 players: the target is the card whose
  button was tapped; the popup header shows "אני ← <name>" with avatar/colour/shape, no target switching inside
  (original §17). 250 ms input guard after the popup opens (config). Remove all drag code, tests, design docs
  (delete docs/design/screens/Interference-Drag.dc.html; mark Arsenal/Interference-Target as old in components.md).
- Popup: compact 3×2 grid, all six types visible without scrolling on 360×780, each with icon, name and a clear
  price chip (‎−N, isolated). Locked types stay in the grid, dimmed, with "רמה N". No "coming soon" row in-game
  (it stays on the Interferences collection screen).
- New types now (3): `scramble` "מספרים מתערבלים" (board digits roll as obviously-fake digits in the sender's colour,
  ~30% show the truth each step, ≤2.5 changes/s; reduced motion: static "?"), `keypad` "מקלדת מתערבלת" (keys swap
  places every 1.5 s, each key always enters the digit printed on it; touch/move guards; reduced motion: one
  permutation with a fade), `ink` "דיו" (blots that fade). Earthquake, fog, bubbles, torch: later.
- Unlock (original §15 "נפתחות בהדרגה"): the three existing ones open from the start; scramble at level 2,
  ink at level 3, keypad at level 4 (config). Cost stays 2^n by order (D10). Duration 5 s (original §15).
- Darken: a common dim layer over the BOARD ONLY for every hit, 60% (config), for the whole 5 s; Reduced Motion:
  static dim; screen reader: announce.
- Mixed app versions: an old app (1.0.0) crashes on an unknown kind → each app declares its supported kinds when it
  joins matchmaking; a room allows only kinds every player's app supports (no declaration = the old three).
  Deploy the server before the app.
- New D-numbers: take the next free ones in 01-SPEC §24 at implementation time (the design suggested D44–D47);
  D18 (drag a11y alternative) becomes obsolete; update D17/D40.
