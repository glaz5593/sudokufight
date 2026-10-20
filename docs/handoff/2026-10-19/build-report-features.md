# Friends room and stealth bot (1.0.4): build report (for the next Claude session)

> **Date:** 2026-10-20. **What:** the two features of plan [plan.md](plan.md) §1 ("שני הפיצ'רים"), built on top of
> the staged-practice 1.0.3 batch ([build-report.md](build-report.md)), because Moshe wrote on 2026-10-20, after
> reading the plan and its decision table: **"כן כן כן לך עם ברירות המחדל, תמשיך לבנות"**. That is an explicit
> "yes" to the three decisions that contradict the original spec (D80a, D90, D92) and every other decision
> D80b–D99 at its recommended default.
>
> Plans: [friends-room.md](friends-room.md) (§3–§7 behaviour, §10 tests, §11 lanes, §12 docs) and
> [stealth-bot.md](stealth-bot.md) (§4–§8 behaviour, §12 tests, §13 lanes, §14 docs). Corrections:
> [critique-log.md](critique-log.md).
>
> **State of the tree:** everything is uncommitted on `main`, on top of `00c3249` (1.0.2) and the uncommitted
> 1.0.3 batch (snapshot: `refs/checkpoints/levels-1.0.3`). There is no commit, no version bump (`app.json` is
> still 1.0.2), no deploy, no APK and no native build. All of these wait for Moshe's OK.
>
> **The stealth bot is built OFF in every environment** (D90's default). Switching it on in staging waits for
> Moshe's word (section 6).
>
> **Reply to Moshe in Hebrew** (CLAUDE.md, memory). This file is in English for the sessions only.

---

## 1. What was built

### 1.1 Friends room (1.0.4: server, protocol and app; needs a NEW native build)

- **Protocol** (`packages/protocol/src/friends.ts`): the `/v1/rooms` contract (create, join, ticket, error codes
  with `FRIENDS_ERROR_STATUS`, `FRIEND_CODE_PATTERN`, `normalizeFriendCode`, `extractFriendCode`, `roomLink`), the
  lobby messages and commands (`start`, `setGameType`, `kick`), `roomClosed` reasons, `LobbyPlayer` fields
  (`room.ts`), `history.ts` `friends`, and analytics generation 3 (`telemetry.ts`: `friends_room_open`,
  `friends_room_join`, `friends_invite_share`, `friends_room_start`, `friends_room_close`, `friends_link_open`;
  never a code or an id). `PROTOCOL_VERSION` stays 1.
- **Server**
  - `apps/server/src/friends/`: `codes.ts` (6 digits from a crypto RNG, unique among open rooms, 30-minute
    cool-down after a room closes, the code is never the Colyseus room id), `lobby.ts` (seats, reservations,
    away hold 6 h, host hand-over, kick, start with or without away seats), `service.ts` (create/join ending in a
    seat reservation; suspension, block and kick checks), `router.ts` (`POST /v1/rooms`, `POST /v1/rooms/join`,
    rate limits per account and per IP), `links.ts` (`GET /r/:code` browser page in he/en, and
    `/.well-known/assetlinks.json` / `apple-app-site-association`), `options.ts` (`FRIENDS_RULES`), `store.ts`.
  - `rooms/FriendsRoom.ts`: the Colyseus room (lobby, countdown, then the game through `GameRoom`'s hooks). A
    friends game is unrated (`games.mode = 'friends'`); its XP shares practice's daily cap through
    `game_players.xp` (migration **0009**).
  - Admin site: "חדרים" page (`admin/rooms.ts`, `apps/admin/src/pages/RoomsPage.tsx`; open rooms, never codes),
    counts in the overview, a `friends` filter in the games list.
- **App**
  - Net/state: `src/api/roomsApi.ts`, `src/net/friends.ts` (createRoom, joinByCode, host commands, leave,
    cancel, the room view), `src/net/friendsDevice.ts`, and `remoteGameHost.ts` / `onlineSession.ts` /
    `gameStore.ts` (lobby phase, background, `roomClosed`, the way back without a token).
  - Screens: `app/friends/room.tsx`, `app/friends/join.tsx`, `app/room/[code].tsx`, and
    `src/screens/friends/*` (`FriendsRoomScreen`, `JoinCodeScreen`, `CodeInput`, `RoomSeatRow`, `friendsModel`,
    `roomPhase`), with `locales/{he,en}/friends.json`. "משחק חדש" has the "עם חברים" group with "צור חדר" and
    "הצטרף עם קוד" (`ModesScreen`).
  - Links: `app/+native-intent.tsx`, `app/+not-found.tsx`, `src/auth/pendingInvite.ts` (pending invite 60 min,
    the current room 6 h), `src/auth/InviteLinkPrompt.tsx` (§6.6 questions), `src/config/links.ts`,
    `auth/redirect.ts` and `auth/useAuthGate.ts` (after sign-in or registration, straight into the room; at a
    start, back to the room the app was closed in).
  - Native: `app.config.ts` adds the Android `intentFilters` for `https://<server>/r/` (with `autoVerify` only
    over TLS) and the iOS `associatedDomains`; `expo-clipboard ~57.0.2` in `apps/mobile/package.json`;
    `scripts/build-apk.mjs` counts the server URL among the native inputs.
- **Design boards** (the plan's "draw the boards first" row): `docs/design/screens/Friends-Room.dc.html` and
  `Friends-Join.dc.html`. Drawn, but nothing waited for their approval (Moshe said to build).

### 1.2 Stealth bot (server only; no app change, no APK)

- **Engine** (`packages/engine/src/bot/`): `stealth.ts` (`STEALTH_BOT_CONFIG`, `stealthBotLevel`), `pace.ts`
  (`movePace`, `paceFromHistory`, `stealthGuardScale`), a `retaliate` policy in `levels.ts` / `brain.ts`
  (`decideRetaliation`), and `runner.ts` taking any `BotHost`. A closed-loop simulation test calibrates it against
  a modeled player. `ENGINE_VERSION` stays 0.4.0 (the 1.0.3 value).
- **Server** (`apps/server/src/stealth/`): `personas.ts` (invented unique names, countries weighted like the real
  players, made only when needed, pool max 1,000), `match.ts` (when the bot comes in and as which persona; D95),
  `seat.ts` (a seat with no connection, "ready" after 0.3–1.5 s, a private HMAC seed), `pace.ts` (each person's
  pace from his ranked games; the farming guard), `switch.ts` (the admin switch, stored in `server_settings`).
  Matchmaking and `GameRoom` seat it; `persistence` stores `games.stealth` and each person's pace (migration
  **0010**: `users.kind`, `personas`, `games.stealth`, `game_players.pace_*`, `server_settings`).
- **Wiring** (INTEGRATE lane): `app.ts` `serverStealth()` builds one switch, the matcher (only when
  `STEALTH_BOT_ENABLED`) and the rooms' secret. Before that lane, `createAppServer` did not wire the bot at all.
- **Admin site**: the stealth page and switch (`apps/admin/src/pages/StealthPage.tsx`), share of games, the
  player win rate against it (target 45–55%), waits, reports, "close calls" (`STEALTH_CLOSE_CALL_SECONDS = 60`),
  a tag and filter in the games list, the personas list. Personas are left out of counts and leaderboards.
- **Legal and store text** (D93): a line in the terms (`legal/terms.ts`, he/en), the privacy line about the
  stored pace (`legal/privacy.ts`), and reviewer notes in `docs/store/LISTING-{APPLE,GOOGLE}.md`,
  `APP-PRIVACY.md`, `DATA-SAFETY.md`.

---

## 2. Decisions as built (D80–D99, every one at its recommended default)

| # | As built | Where |
|---|---|---|
| D80a | **Yes from Moshe (contradicts original §5 "five options only").** A third group on "משחק חדש" with one row: "צור חדר" and "הצטרף עם קוד". The ranked rows lost the "דירוג · מהיר" chip | `FRIENDS_UI.modesGroup = true`, `rankedChip = false` (`src/config/friends.ts`) |
| D80b | The group is called "עם חברים" | `FRIENDS_UI.groupName = 'short'` ('moshe' gives "חברים אמיתיים בזמן אמת") |
| D81a | No rating; XP within practice's daily cap | `games.mode = 'friends'`, `game_players.xp`, `practiceXpUsedOn` |
| D81b | Friends show in "recent opponents" | `progress/` opponents, leaderboard "חברים" tab |
| D82 | The host picks the game type in the room; default "רגיל", or my last type | `FRIENDS_DEFAULT_GAME_TYPE`, `setGameType` |
| D83 | "התחל" counts connected seats; with someone away the host confirms "להתחיל בלי Avi?"; who was left out sees "המשחק התחיל בלעדיך" (also after a killed app: fix F5) | `FRIENDS_UI.startWithoutAway = 'confirm'`, `roomPhase.ts` |
| D84a | No time limit; an away seat is held 6 h (safety net) | `FRIENDS_RULES.lobbyAwayHoldMs = 6 h`, `lobbyMaxMs = null` |
| D84b | The host role passes to the earliest seat; the code stays | `lobby.ts` |
| D85a | Kick: host only, before the start; a kicked account cannot come back to that room | `FRIENDS_UI.kick = true`, `lobby.kick` |
| D85b | An unverified email may join | `service.ts` (no email check) |
| D85c | Blocked by someone in the room: `notFound`, exactly like a wrong code; I blocked someone: `cantJoin`. A block in the lobby puts the blocked one out with "יצאת מהחדר". **During the game a block only mutes reactions, and both players always get back in** (fix below) | `service.ts` join, `FriendsRoom.watchLobbyBlocks`, `GameRoom.watchBlocks` |
| D86 | 6 digits, crypto RNG, unique, 30 min cool-down; rate limits 10 creates/h, 20 joins/10 min per account, 60 per IP | `FRIENDS_RULES`, `FRIENDS_CREATES_PER_HOUR`, `FRIENDS_JOINS_PER_10_MIN(_PER_IP)` |
| D87 | Everyone in the room can share the link | `FRIENDS_UI.shareBy = 'everyone'` |
| D88 | A link opens the app straight in the room (no card, no question) | `+native-intent.tsx`, `app/room/[code].tsx` |
| D89 | "Again with the same friends": not built (stage C, after the phone test) | plan |
| process | Boards drawn before building (room, join); nobody waited for approval | `docs/design/screens/Friends-*.dc.html` |
| D90 | **Yes from Moshe (contradicts original §5.3, §7, §24).** Built, OFF in every environment: `STEALTH_BOT_ENABLED` defaults to false and is absent from both fly files (enforced by `deploy.test.ts`); even when enabled, it waits for the admin switch | `config.ts`, `stealth/switch.ts`, `app.ts serverStealth` |
| D91 | An invented name that looks real (never a real player's) | `stealth/personas.ts` |
| D92 | **Yes from Moshe (in the spirit of original §5.2).** Stealth games are rated as usual | `persistence/rankedGames.ts`, `records.ts` |
| D93 | A line in the terms (he/en) and the stores' reviewer notes | `legal/terms.ts`, `docs/store/*` |
| D94 | Only in 2-player ranked queues (`fast-2p, normal-2p, hard-2p`), after a wait drawn from 8–20 s, only when nobody he could meet is searching | `STEALTH_BOT_QUEUES`, `STEALTH_BOT_AFTER_MS`, `stealth/match.ts` |
| D95 | "Nobody else is searching" is hidden only while a persona can actually reach him | `STEALTH_BOT_HIDE_NOBODY = true`, `personaReachable` |
| D96 | The bot's pace from his ranked games only (last 10, 3 minimum, ±30%, 3× outlier cut) | `STEALTH_BOT_CONFIG`, `game_players.pace_*` |
| D97a | Mistakes at his own rate (2–20%, 8% default) | `STEALTH_BOT_CONFIG.mistakes` |
| D97b | No reactions | `STEALTH_BOT_CONFIG.reactions = {}` |
| D98 | Retaliation only: 2–20 s after an interference ends, half the same kind, gives up without points | `STEALTH_BOT_CONFIG.retaliate` |
| D99 | Personas are not on the leaderboards; they do appear in the "חברים" tab of someone who played them | `progress/leaderboard.ts` (`users.kind`) |

---

## 3. Review findings of this batch, verdicts and fixes

All ten findings below were confirmed by the review and fixed in the FIX lane, each with a regression test.

| id | Area | Verdict | Fix (as made) | Test |
|---|---|---|---|---|
| friends-block-check-locks-out-own-game (medium) | server | Confirmed: after the start, a block made mid-game made `join()` refuse the game's own players (`notFound` / `cantJoin`) before `admit()` could give them their seat back, and told the blocked one about the block | `FriendRoomsService.join()` skips the block check for a player of the room's running game (`playsIn`); everyone else is checked as before | `service.test.ts` "a block made during the game locks neither of its players out of the way back" |
| friends-join-block-race (low) | server | Confirmed: the check read the members once, awaited the DB, and admitted without re-reading, so two racing joins with a block between them both got seats | The block check loops: after each read it takes the members again and checks anyone new, until nobody new; `admit()` then runs in the same tick as the last read | `service.test.ts` "two joins at once with a block between them: only one gets a seat" (both orders), and "joins at once with no block … all get seats" |
| F1 (high) | app | Confirmed: on a cold start from a link, `/room/[code]` joined before the auth store restored the user, got `unauthorized`, and the invite was used up | `RoomByCodeRoute` starts the join only when `status === 'ready' && !needsNewName(me)`; otherwise the auth gate handles it | `roomLinks.e2e.test.tsx` with the real route and a pending `restore()`: one join after it resolves, then the room |
| F2 (medium) | app | Confirmed: a create or join still waiting for the server could not be cancelled; the late ticket closed whatever the player started meanwhile and entered a hidden room | `FriendsRooms.cancel()` (and `leave()`) bump an epoch; a step asked under an older epoch returns `{ ok: false, cancelled: true }` without `enter()`. `/friends/room` cancels on unmount, `/friends/join` and `/room/[code]` on blur; they navigate only while focused | `net/__tests__/friends.test.ts` "calling off a way in" (3 tests); `friendsRoutes.test.tsx` back during "פותח חדר…" and during a typed-code join |
| F3 (medium) | app | Confirmed: Android back during 3… 2… 1… popped `/friends/room`, leaving a seated game with no screen | A `BackHandler` that swallows back while the phase is `countdown` or `starting` (and no iOS swipe) | `friendsRoutes.test.tsx` "3… 2… 1…: Android back is held …, then the board" |
| F4 (medium) | app | Confirmed: a start-up resume refused for good never forgot the room, so every start for 6 h showed the refusal | `?resume=1` refused with a non-retryable problem (`!isRetryable`) calls `forgetRoom()`; a transient one keeps it | `roomLinks.e2e.test.tsx` "the app closed in a room that closed meanwhile: said once, and the room forgotten for the next start" and "… no connection at the start: the room is kept"; `friendsRoutes.test.tsx` "?resume=1 with no connection: the room is kept" |
| F5 (low) | app | Confirmed: the killed-app return showed "המשחק בחדר הזה כבר התחיל." instead of D83's "המשחק התחיל בלעדיך" | `entryFailure(out, code, { resume })` marks `gameStarted` on a resume as `startedWithout`, carried by `roomScreenPhase` | `roomPhase.test.ts`; `friendsRoutes.test.tsx` resume + 409 |
| F6 (low) | app | Confirmed: "לא עכשיו" (or back) on "אתה באמצע משחק" deleted the invite the dialog promised to keep | For the `inGame` question both answers only close the dialog; the invite waits for the game's end | `roomLinks.e2e.test.tsx` "… 'לא עכשיו' … keeps the invite too" |
| F7 (low) | app | Confirmed: during a friends countdown a link asked "לעבור לחדר?" and could walk out of a starting game | `activityOf` treats a friends session with `startsAt` set as a game | `pendingInvite.test.ts` "a friends room's 3… 2… 1…: game" |
| stealth-1 (medium) | server | Confirmed: `choosePersona` created a new persona whenever none he never met was in range, even when a met, non-recent one was free, so almost every stealth game was against a new, empty, provisional card | Plan §6 order: never-met first, then the closest met one that is not recent (a rematch), and only then create (pool not full, 1200 in range) | `match.test.ts` "a met persona that is not recent comes back (a rematch) before a new one is made", and the "no free persona in range" case updated |
| stealth-3 (low) | server tests | Confirmed gap: no test sent a report or a block about a persona through the player API | Tests only (the code already treats personas like people) | `moderation.test.ts` "a persona …: reports and blocks answer exactly as for a person"; `stealth/matchmaking.test.ts` "a persona he blocked … is never seated against him" |

Earlier, the INTEGRATE lane found and fixed that `createAppServer` did not wire the stealth bot at all (no
switch, no matcher, no secret), so `STEALTH_BOT_ENABLED=true` would have done nothing; covered by
`apps/server/test/stealthWiring.contract.test.ts`.

**Code and tests changed by the FIX lane:** server `friends/service.ts` (+ `service.test.ts`),
`stealth/match.ts` (+ `match.test.ts`), `stealth/matchmaking.test.ts`, `moderation/moderation.test.ts`; app
`app/room/[code].tsx`, `app/friends/room.tsx`, `app/friends/join.tsx`, `src/net/friends.ts`,
`src/screens/friends/roomPhase.ts`, `src/auth/pendingInvite.ts`, `src/auth/InviteLinkPrompt.tsx`, and the tests
`net/__tests__/friends.test.ts`, `screens/friends/__tests__/{friendsRoutes.test.tsx,roomPhase.test.ts}`,
`auth/__tests__/pendingInvite.test.ts`, `src/__tests__/roomLinks.e2e.test.tsx` (it now also renders the real
`/room/[code]` route, with expo-audio and expo-haptics mocked). Note for whoever edits that e2e file: a second
`renderRouter` in one test after `screen.unmount()` broke the next test (`+not-found`), so each test renders
once.

**Docs touched by the FIX lane:** `docs/01-SPEC.md` §5.4.3 (the "חסימה בתוך החדר" row: a block during the game only
mutes reactions, both players get back in), and `docs/FRIENDS-DEVICE-CHECKS.md` (new boxes in checks 4, 9, 10, 12,
14 and 16 for the fixed behaviours; still 21 checks).

---

## 4. Open issues

**What Moshe must provide or decide**
1. **The EAS key's SHA-256** (`eas credentials` → Android → keystore SHA256 Fingerprint). Without it, an APK
   signed by EAS does not open room links directly (they open the browser page, whose "פתח באפליקציה" still
   works). Staging's `fly.toml` `[env]` now lists only React Native's public debug key (with
   `ANDROID_APP_LINK_ALLOW_DEBUG_KEY = "true"`, staging only), which signs `npm run apk` builds.
2. **The word to switch the stealth bot on in staging** (D90). Two steps, see section 6.
3. The OK for each step of the release order (section 7): commit, deploy, version, native build.

**Known limits, left as is**
- F2: a create cancelled after the server already opened the room leaves that lobby until the host's seat
  reservation lapses (30 s, `seatReservationMs`). A quick re-create may get "לסגור את החדר הקודם?"; the existing
  replace dialog handles it.
- F3: only Android back is held during the countdown (plus no iOS swipe and no header back). There is no
  unmount safety net that routes to `/game` if the screen is removed some other way.
- stealth-1 side effect: with a pool of one reachable persona, the 80% reset always fires, so a lone tester
  (Moshe on staging) meets the same persona each time unless it is busy. This matches §7 and plan §6, but it is
  the plan's "same name comes back" risk (stealth-bot.md, the risk table).
- Admin win rate counts a shared first place as a player win; the farming guard counts only a strict win (both
  documented in their comments).
- `STEALTH_BOT_SECRET` unset means a random secret at each start, so after a restart a reported game's bot cannot
  be replayed exactly. Set it as a fly secret if replays matter.
- The bot's calibration rests on a modeled player; real tuning is the admin win rate via `paceScale`.
- iOS: `IOS_APP_ID` and store URLs are unset (no iOS build yet; the browser page says the app is in testing).
- D89 ("שוב עם אותם חברים") is not built (stage C).
- Nothing was run on staging, on a phone or in a native build.

---

## 5. Device checks

- **Friends:** [`docs/FRIENDS-DEVICE-CHECKS.md`](../../FRIENDS-DEVICE-CHECKS.md), 21 checks, two phones, two
  accounts, staging, Release build (`npm run apk`). Check 18 verifies App Links (`adb shell pm get-app-links
  com.mosheg.sudokufight` → `verified`).
- **Stealth bot:** `docs/QA-CHECKLIST.md`, section "בוט סמוי", on staging, only after Moshe says to switch it on.
- **Staged practice 1.0.3:** `docs/LEVELS-DEVICE-CHECKS.md` checks 12–19 (from the 1.0.3 batch).

---

## 6. Switching the stealth bot on in staging (only on Moshe's word)

1. In `fly.toml` `[env]`: `STEALTH_BOT_ENABLED = "true"`, and edit the deliberate gate in
   `apps/server/test/deploy.test.ts` (it asserts the fly files carry no `STEALTH_BOT_ENABLED`). Optionally
   `fly secrets set STEALTH_BOT_SECRET=<32+ chars>` (never print it). Deploy.
2. In the admin site, turn the switch on (`POST /admin/api/stealth/switch {"on":true}`, audited). Turning it off
   needs no restart.
3. Run the "בוט סמוי" checks in `docs/QA-CHECKLIST.md`. Production only after that, and again only with his OK.

---

## 7. Release order (each step only with Moshe's OK)

1. **Commit** (only when Moshe says so). The tree holds 1.0.3, the friends room and the stealth bot together.
2. **Staging server deploy FIRST**, before any APK. Migrations **0008** (1.0.3), **0009** (friends) and **0010**
   (stealth) run at start; they only add columns and tables, so 1.0.2/1.0.3 apps keep working (confirmed by
   `friendsHost.contract.test.ts`, `stealthWiring.contract.test.ts` and the ranked contract tests). Check
   `GET /health` → `{"ok":true,"engine":"0.4.0","protocol":1}`, `GET /r/123456` shows "הוזמנת למשחק סודוקו
   פייט", and `/.well-known/assetlinks.json` lists the fingerprints. The stealth bot stays off.
3. **Set the assetlinks fingerprints** for staging: add the EAS SHA-256 to `ANDROID_APP_LINK_SHA256`
   (comma-separated, after the debug key), then redeploy or restart. The server reads it as a plain environment
   variable (`config.ts`). It is not a secret, and the repo keeps it in `fly.toml` `[env]` (friends-room.md §6.2).
   If it is set with `fly secrets set` instead, take it out of `[env]` so there is one source. Production
   (`fly.production.toml`) gets the EAS key and the Play app signing key, never the debug key (the server refuses
   it there).
4. **Version 1.0.4** in `apps/mobile/app.json`. 1.0.3 was never built as an APK; this build carries the 1.0.3
   changes too.
5. **A NEW NATIVE build**: `expo-clipboard` and the intent filters are native. A local `npm run apk` needs a
   prebuild (the script detects the native inputs, the server URL included). **Check free space on C: first**
   (memory: dev-machine-limits; build one ABI, or use EAS).
6. **Two phones**: `docs/FRIENDS-DEVICE-CHECKS.md`, plus `docs/LEVELS-DEVICE-CHECKS.md` checks 12–19.

---

## 8. Final test counts

After every fix, `npm run verify` ran clean with no other job running, **exit 0**:

- lint: `eslint . --max-warnings 0`, clean;
- typecheck: `routes:types` and `tsc -b`, clean;
- i18n: 16 namespaces, 2,576 app keys, 474 admin keys, 0 errors and 0 warnings;
- Jest: **504 of 504 suites, 11,350 of 11,350 tests**, 22 snapshots.

`npm run format:check`: "All matched files use Prettier code style!".

Compared with the INTEGRATE lane's run (504 suites, 11,330 tests), the FIX lane added 20 tests: server 6 (friends
service 3, persona choice 1, persona report and block 1, a blocked persona in matchmaking 1), app 14 (net cancel 3,
routes 5, roomPhase 1, pendingInvite 1, e2e 4).

One earlier full run in this lane failed one test (`roomLinks.e2e` "+not-found"). The cause was this lane's own
e2e test, which rendered the app twice in one test; it was rewritten (section 3), and the file then passed
alone and in the full run.
