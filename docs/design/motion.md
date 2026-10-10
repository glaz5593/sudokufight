# Motion, haptics and sound: direction C ("לילה רגוע")

Status: draft for implementation (stages 3, 4 and 6 of `docs/02-WORK-PLAN.md`). Direction C was chosen on 2026-10-09 (D30).

**Sources and how much each one decides**

| Source | Decides |
|---|---|
| `docs/01-SPEC.md` (§1, §6.2–6.5, §6.8, §7, §8, §16, §18, §22) and `docs/00-original-spec-v1.md` | Rules and required feedback. Wins every conflict. |
| `screens/Dir-C-Game.dc.html`, `screens/Dir-C-Home.dc.html` | Colors, fonts, overall look. The only C keyframe is `sf-lock`. |
| `screens/DS-Motion.dc.html` (round 1, "Arena Ink") | Durations, timelines, haptic and sound events, Reduced Motion mapping. |
| Other round-1 screens (`Game-2P`, `Hit-*`, `Match-*`, `Results-*`, `Reactions`, ...) | Per-screen keyframes and the playable prototype's timing logic. |

Direction C is round 1's style with the noise removed: cyan against orange, and no textures. This file takes round 1's
structure and timing and converts every color and effect to C's palette.

---

## 1. Principles

From DS-Motion (round 1), unchanged:

1. **Short and precise. Motion never hides the board.** The only exception is interferences, because hiding the board is their job (§1, §15).
2. **Every action reacts within 140 ms.** Local press feedback appears in the first frame. Server results are expected within 150 ms p95 (§18).
3. **Celebrate outside the board, stay quiet inside it.** Score pops, flights, reactions and confetti happen on the cards and the results screen. On the board, only one cell animates at a time.

Added for direction C:

4. **Only functional loops.** An infinite animation must show a live state: my lock, the last 3 seconds, waiting or
   connecting. Round 1's decorative idle loops are dropped (see §2).
5. **At most one infinite loop on the board:** my lock pulse. Opponent locks are static.
6. **"Me" is always P1** (`#36c9f0`, ●). Every one of my flashes, chips, rings and arcs uses P1. Opponents use their
   seat color (P2 `#ff9440`, ▲ ...) by seat order. Ownership never depends on color alone: shapes and avatars stay visible.
7. **Premium comes from timing, not effects.** Physical springs, synchronized timelines (the flight lands, then the
   count starts) and matching haptics replace round 1's glows and neon.

## 2. Round 1 → direction C translation

| Round 1 ("Arena Ink") | Direction C | Why |
|---|---|---|
| `#2ee6ff` cyan / `#ff8a1f` orange | P1 `#36c9f0` (tint `#d6f4fc`, digit `#0b6a85`) / P2 `#ff9440` (tint `#ffe8d4`, digit `#9a4a0c`) | Dir-C-Game palette |
| `#ff3355` error red | `#ff4d5e` | Dir-C-Game wrong digits |
| `#ffd23f` gold | `#ffcf3f` (pressed shadow `#b88f00`, text on gold `color.onAccent` `#241a00`) | Dir-C-Home primary CTA and ratings |
| `#3ff0a6` success green | Not used for move feedback: a correct move uses the mover's seat color. `color.success` `#40e29f` exists only for status UI (online dot, success toast), never on the board. | C has no green, and P3 is green. |
| Purple surfaces `#0f0b1d`, `#1b1533`, `#251d45`, `#342a5e` | `color.bg` `#0f1218`, `surface` `#171b24`, `surface2` `#1f2430`, `border` `#2a3140`, `textMuted` `#9aa3b5`, `iconFaint` `#677086` (decorative only; faint text is `textFaint` `#828ba1`), `text` `#eef1f6` | Dir-C, names from `tokens.json` |
| Board `#fbfaff` / `#ece8fb`, lines `#c9c2ea` | Board `#f7f8fa` / `#eceff4` (alternate boxes), lines `#c8cdd6`, box gaps `#0f1218` | Dir-C-Game |
| `sf-glow` / `sf-lock-me`: outer or inner blur glow | `sf-lock`: 3 px inset ring plus a 7 px inset band `rgba(54,201,240,.28)` that fades in and out | Dir-C-Game keyframe |
| `sf-lock-nina` pulsing opponent ring and striped fill | Static 3 px ring in the seat color plus a 22 px avatar. No stripes, no pulse. | Dir-C-Game |
| Floating "+3.5" with a text stroke and gold glow | Dark chip (`#0f1218`, radius 8, Teko 22) with the text in the mover's color | No glows in C. A chip keeps contrast on the light board: P1 9.6:1, P2 8.5:1, red 5.8:1. Plain `#36c9f0` on `#f7f8fa` is only 1.8:1. |
| `sf-score-pop` scale 1.28 plus gold text glow | Scale 1 → 1.08 → 1, no glow | Calm |
| `sf-score-hit` red score plus shake | Red tint that fades back. No second shake. | One shake per mistake, on the cell |
| `sf-hit` pulsing red card glow after a mistake | Dropped | Glow |
| `sf-slam` from scale 2.2 with blur 6 px | Scale 1.4 → 1, no blur. The skewX(−8°) idiom is kept where C uses it (VS badge, CTA). | Calm. Blur is an effect. |
| `sf-shine` gradient sweep (CTA, awards, logo, skeletons) | Dropped. Skeletons use an opacity pulse. | Gradient |
| `sf-bob`, `sf-twinkle`, `sf-sway`, `sf-floor`, `sf-beam`, `sf-wobble`, `sf-spin` 48 s / 70 s sunbursts, `pg-me`, `pg-today`, `sf-target` glow, `sf-turn-glow` | Dropped | Decorative idle loops or glows |
| `sf-crack` on "הפסד" | Dropped | Texture effect |
| Infinite confetti fall | One 1600 ms burst, at most 40 pieces | Calm. A win must still feel like a win (§1). |
| Reaction ghost trail (2 delayed copies, 1.9 s) | One emoji, 1600 ms | §8 says about 1.6 s. Calm. |
| Fireworks in neon pink, green and violet | Sender's seat color plus gold `#ffcf3f` plus white | Clear attribution. Interferences stay loud: that is their job. |

## 3. Easing and spring reference

All timing curves are cubic-bezier. In Reanimated 4.5 (`react-native-reanimated` 4.5.1 in `apps/mobile`):
`Easing.bezier(x1, y1, x2, y2)`.

| Token | Curve | Use |
|---|---|---|
| `standard` | `cubic-bezier(0.2, 0.8, 0.2, 1)` | State changes, enters, flights, fills (DS-Motion "סטנדרט · מעבר מצב") |
| `emphasized` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | Timed overshoot for pops and slams when a spring can't be used (DS "קפיצה · תגמול וסלאם") |
| `exit` | `cubic-bezier(0.42, 0, 1, 1)` | Elements leaving (round-1 `sf-out` used ease-in) |
| `countUp` | `cubic-bezier(0.33, 1, 0.68, 1)` | Score and rating counters. Equals `1 − (1 − t)³` from the Game-2P prototype. |
| `loop` | `cubic-bezier(0.42, 0, 0.58, 1)` | Back-and-forth loops (lock pulse, blink) and shake keyframes |
| `linear` | `cubic-bezier(0, 0, 1, 1)` | Timers only (DS "ליניארי · טיימרים בלבד") |

Springs for `withSpring`, as physics parameters (`mass`, `stiffness`, `damping`). They work in Reanimated 4.5. Do not rely on
the library defaults, because 4.x changed them to mass 4, stiffness 900, damping 120.

| Spring | Params | Damping ratio · overshoot · settles in | Use |
|---|---|---|---|
| `pop` | mass 1, stiffness 260, damping 18 | ζ ≈ 0.56 · ≈ 12 % · ≈ 450 ms | Digit pop, score bump, chips, badges, emoji in the strip. Matches `sf-pop` (.42 s, emphasized). |
| `settle` | mass 1, stiffness 300, damping 30 | ζ ≈ 0.87 · < 1 % · ≈ 300 ms | Things that move into place: a cancelled drag token returning, panels, notches |
| `press` | mass 1, stiffness 500, damping 32 | ζ ≈ 0.72 · ≈ 4 % · ≈ 250 ms | Key and button release, token lift |
| `slam` | mass 1, stiffness 220, damping 15 | ζ ≈ 0.51 · ≈ 16 % · ≈ 530 ms | VS, 3·2·1, GO!, "ניצחון!". From scale 1.4, it dips to about 0.94, like round-1 `sf-slam`. |

## 4. Animation catalog

Columns: **ms** is the duration (loops show the cycle length). **R** is the moment the server result arrives
(`placedCorrect` / `placedWrong`, about t0 + 140 ms after the key press). The **Reduced Motion** column applies when
`useReducedMotion()` or the in-app setting "הפחתת תנועה" is on (§22: animations get shorter, and an interference becomes a
static cover of the same area for the same 5 s).

### 4.1 Board, keypad and locks (§6.2, §6.3)

| ID | Trigger | ms | Easing | What moves (C look) | Reduced Motion |
|---|---|---|---|---|---|
| `key.press` | Finger down / up on a keypad key | 80 down, `press` spring up | `standard` / `press` | Key moves down 3 px (`elevation.keyPressed`, round 1 `key.down`). Background `#1f2430` → `#2a3140` and the border goes to full P1 while held. | Same (3 px is not vestibular motion) |
| `cta.press` | Press on the gold CTA ("שחק", "GO!", "משחק חדש") | 80 down, 140 up | `standard` | Skewed button moves down 3 px and its bottom shadow shrinks from `0 4px 0 #b88f00` to `0 1px 0` (DS `sf-tap`) | Same (3 px is not vestibular motion) |
| `keypad.arm` / `keypad.idle` | My lock confirmed / released | 240 | `standard` | Key borders `#2a3140` ↔ `rgba(54,201,240,.5)`. Keypad opacity 0.55 ↔ 1. | Same (opacity and color only) |
| `key.exhausted` | All 9 of a digit are placed, or the digit is disabled for this cell (D12) | 240 | `standard` | All 9 placed: key opacity → 0.3 and the "remaining" count cross-fades. D12: key opacity → 0.55, digit and a strike line in `color.danger` (`components.md` §12.1). | Same |
| `hint.nudge` | Digit pressed with no lock | 300 | `loop` keyframes | The status hint "בחר משבצת" shakes on translateX 0, −5, +5, −3, +3, 0 px (Game-2P `nudge`) | Hint text flashes to `#eef1f6` for 300 ms, without moving |
| `cell.pending` | Tap on an empty cell (optimistic, §18) | 140 | `standard` | 3 px P1 ring fades in at 50 % opacity. No tint, pulse or timer yet. | Appears instantly |
| `cell.locked.mine` | `cellLocked` for me | 140 (pill: `pop` spring) | `standard` | Ring → 100 %. Background → P1 tint `#d6f4fc`. The seconds pill (top-right of the cell, P1 background, Teko 15) pops 0.6 → 1. `lock.pulse` starts. | Ring and tint appear. The pill appears without scale. No pulse. |
| `lock.pulse` (`sf-lock`) | While my lock is active | 1600 loop (800 each way) | `loop` | Inside the static 3 px ring, a 7 px inset band `rgba(54,201,240,.28)` fades 0 ↔ 1. **My lock only.** | Static 3 px ring, band hidden ("טבעת קבועה") |
| `cell.locked.opp` | `cellLocked` for an opponent | 240 (avatar: `pop` spring) | `standard` | Static 3 px ring in their seat color. Their 22 px avatar pops 0.6 → 1 in the cell. No tint and no pulse. | No scale |
| `lock.timer` | While my lock is active | = remaining time (8000 / 12000 / 18000 total, D2) | `linear` | Header bar (96 × 4 px, P1 on `#1f2430`) shrinks with scaleX 1 → 0, anchored at the inline-start edge (right in Hebrew). The pill and "N שניות" show `ceil(remaining)`. Driven by the server's `expiresAt`, not by a local duration. **Frozen** while I'm under an interference or the game is paused (§6.2.7). | **Unchanged.** It is information (DS "נשארת · זה מידע"). |
| `lock.urgent` | Remaining ≤ 3 s on my lock | 1000 loop | `loop` | Pill background → gold `#ffcf3f` (text `color.onAccent` `#241a00`, 11.7:1). Bar fill → gold. Header "N שניות" text → gold. Both blink opacity 1 ↔ 0.35. **The ring stays P1**, so ownership never changes color. | Gold without the blink |
| `lock.release` | "ביטול בחירה", time expired, a different cell chosen, or after a mistake (D3) | 240 | `exit` | Ring and tint fade out. The pill scales to 0.8 and fades. The keypad goes idle. The status cross-fades to "בחר משבצת". | Fade only |
| `cell.denied` | Tap on a cell locked by an opponent, or on my just-released cell within the 1 s cooldown (D2) | 300 | `loop` keyframes | **That cell only** shakes on translateX 0, −5, +5, −3, +3, 0 px (Game-2P `deny`). No red: there is no penalty. | The cell's ring thickens from 3 to 5 px for 300 ms, without moving |
| `opp.timer.compact` | 3–4 players: each opponent's lock | = remaining | `linear` | A ring on the compact card shrinks from `expiresAt` (round-1 `sf-ring`) | Unchanged |

### 4.2 Correct move: score flies to the card, then counts up 650 ms (§6.4)

| ID | Trigger | ms | Easing | What moves (C look) | Reduced Motion |
|---|---|---|---|---|---|
| `cell.flash.correct` | R + 0 | 700 | `standard` | An overlay in the mover's color at 60 % opacity (`opacity.correctFlash`, Game-2P `sf-flash-cyan`) fades to 0 over the cell. The cell settles on that player's tint (P1 `#d6f4fc` with digit `#0b6a85`, P2 `#ffe8d4` with `#9a4a0c`). | Tint cross-fades in 240 ms, no flash |
| `digit.pop` | R + 0 | about 420 | `pop` spring | The digit scales 0.6 → 1.12 → 1 and fades in | Fades in over 140 ms |
| `points.chip` | R + 0, then holds 300 | 240 | `pop` spring | Chip "+3.5" above the cell (dark `#0f1218`, Teko 22, text in the mover's color) scales 0.8 → 1.15 → 1 | Not shown over the board |
| `points.flight` | R + 300 → R + 660 | 360 | `standard` | The chip travels on a quadratic arc from the cell center to the **delta slot beside the mover's score** (the "+3.5" next to "55" in Dir-C-Game). The control point sits 60 px above the higher endpoint. Scale goes 1 → 0.85. On arrival the chip hands over to `delta.label`. Endpoints come from layout measurement and are never hard-coded: "me" is on the right in Hebrew and on the left in English. | No flight. "+3.5" fades in beside the score (200 ms) and fades out later (DS "מופיע ליד הניקוד ודוהה"). |
| `score.count` | R + 660 → R + 1310 | **650** | `countUp` | The card score (Teko 64, `tabular-nums`) counts from the old value to the new one, rounded to 0.5 steps (`Math.round(v × 2) / 2`), so 51.5 → 55 never shows 53.37. If another event arrives mid-count, the count restarts from the value currently shown. | Final number immediately |
| `score.bump` | R + 660 | about 420 | `pop` spring | Score number scale 1 → 1.08 → 1. No halo or glow. | None |
| `delta.label` | R + 660, holds 2400, then fades over 240 | 240 | `standard` / `exit` | "+3.5" (Teko 22, mover's color) next to the score, as in Dir-C-Game | Same, without movement |
| `dominance.bar` | R + 660 (in step with the count) | 650 | `standard` | The 4 px two-segment bar under the cards re-splits by score share (clamped to 6–94 %). In 3–4 players: one segment per player, ordered by place. Animate scaleX on the segments, not width. | Jumps to the final split |
| `leader.change` | The lead flips at landing (§6.8) | about 420 | `pop` spring | The new leader's score gets a `score.bump`, and the bar's larger segment changes sides. In 3–4 players, the place badges (1–4) cross-fade with an 8 px vertical slide (240 ms). **Cards never reorder:** seat order is fixed (§6.8). | Cross-fade only |
| `turn.active` | Only if D1 = turns: the active player changes | 240 | `standard` | The active player's card border → 2 px in their seat color, plus "התור שלו". Replaces round-1 `sf-turn-glow`. | Same |

Opponents' correct moves run the same sequence in their color and fly to their own card (compact card in 3–4 players).

### 4.3 Wrong move: flash, 300 ms shake, red penalty (§6.5)

| ID | Trigger | ms | Easing | What moves (C look) | Reduced Motion |
|---|---|---|---|---|---|
| `cell.flash.wrong` | R + 0 | 550 | `standard` | Red overlay `#ff4d5e` fades from 55 % (`opacity.wrongFlash`) to 0 over the cell | A 2 px red frame for 300 ms, then off (DS "מסגרת אדומה 300ms") |
| `cell.shake` | R + 0 | **300** | `loop` keyframes | **That cell only** moves on translateX 0, −5, +5, −3, +3, 0 px at 0/20/40/60/80/100 %. The board never moves, and play is never blocked. | None (the red frame replaces it) |
| `wrong.digit` | R + 0 (full size), R + 300 (shrinks) | 240 | `standard` | The typed digit shows full size in `color.board.wrongDigit` `#b8102f` during the flash (`#ff4d5e` is only 3.05:1 on the light cell). Then it shrinks and moves to the small 11 px bottom-right mark, where it stays for everyone. The cell releases (`lock.release`). | Appears directly as the small mark |
| `penalty.flight` | R + 300 → R + 660 | 360 | `standard` | Chip "−2" (`#0f1218` with `#ff4d5e` text) pops at the cell and flies to the mover's delta slot. No hold: the red flash already announced it. (DS-Motion shows the card update at t + 600. One shared flight duration gives R + 660.) | "−2" fades in beside the score (200 ms) |
| `score.countDown` | R + 660 → R + 1310 | 650 | `countUp` | The score counts down. Its color starts at `#ff4d5e` and returns to the seat color over the 650 ms. Scores can go below 0 (D15): use "−" (U+2212). | Final number immediately, red tint for 300 ms |
| `mistakes.tag` | R + 660 | about 420 | `pop` spring | The "N טעויות" label on the card updates with a pop (scale 0.8 → 1). The delta slot shows "−2" in red (holds 2400, fades 240). | No scale |

### 4.4 Interferences (§7) and the 5 s effects

| ID | Trigger | ms | Easing | What moves (C look) | Reduced Motion |
|---|---|---|---|---|---|
| `arsenal.open` | Tap on ⚡ on an opponent card | 240 | `standard` | The arsenal sheet slides up (translateY 100 % → 0). Scrim `color.scrim` (`rgba(7,9,12,.72)`) fades in. | Fades over 200 ms, no slide |
| `token.lift` | Drag starts on a token | 140 | `press` spring | Token scales 1 → 1.08 and follows the finger 1:1 (no lag). The ghost shows the name, a small preview and the cost ("זיקוקים · 8 נק׳"). | No scale |
| `dropzone.active` | While dragging | 800 loop (march), 1100 loop (breathe) | `linear` / `loop` | **Only** the opponent card the arsenal was opened from gets a 2 px dashed gold `color.accent` outline (round 1 Interference-Drag; gold, not P1, so a P1 ring never appears on an opponent's card) with marching dashes, plus scale 1 ↔ 1.02. Every other card dims to 40 % (`opacity.dimmedCard`, 240 ms). | Static solid outline. Others still dim. |
| `dropzone.hover` | Finger enters the drop zone | 140 | `standard` | The zone fills with `color.accentSubtle` (`rgba(255,207,63,.1)`) | Same |
| `launch` | Release inside the zone | 240 + 480 | `exit` / `standard` | The token shrinks into the card (1 → 0, 240 ms). A stroke ring ripples out from the target card (scale 1 → 1.15, opacity 0.6 → 0, 480 ms). My score counts down by the cost (`score.countDown` timing). The sheet closes (200 ms, `exit`). | No ripple. The sheet fades. |
| `launch.cancel` | Release outside the zone | about 300 | `settle` spring | The token returns to its slot. Nothing is charged. | Snaps back |
| `sender.toast` | After launch | 240 in, hold 2000, 240 out | `standard` / `exit` | Chip "זיקוקים ← NinaVolt" under my card | Fade |
| `hit.banner` | An `interference` targets me | about 300 in, 240 out | `settle` spring / `exit` | Banner "NinaVolt שלחה לך זיקוקים!" slides down 16 px and fades in. A 5 s countdown ring in `color.accent` (as round 1's Hit-* banner and `components.md` §15.2; the sender is shown by the avatar framed in their seat color) shrinks linearly. | Fades in over 200 ms. The ring stays. |
| `hit.effect` | Same, for **exactly 5000 ms** from the server's `endsAt` | 5000 | per effect | Full screen (D35 default until approved), above everything. `pointerEvents="none"`: the game continues and I can still play (§7.2). My lock timer is frozen. See the effect list below. | **Static cover of the same area and density for the same 5000 ms** (§22). See below. |
| `hit.end` | `interferenceEnded` | 240 | `exit` | The effect and banner fade out. The lock timer resumes from the new `expiresAt`. | Same |
| `victim.tag` | 3–4 players: a third player is hit | 240 pop + 5000 ring | `pop` spring / `linear` | A small ⚡ tag with a 5 s ring on the victim's card | No pop |

Effect details (`react-native-skia` for particles, §17.1). Interferences are the one place where loud motion is the goal, but
they still use the C palette:

| Effect | Motion (from round-1 `Hit-*`) | C colors | Reduced Motion static cover |
|---|---|---|---|
| Fireworks (זיקוקים) | 6 bursts, each blooming in 1600–2300 ms (`standard`), staggered. Embers fall in 1000–1600 ms (`exit`). Sparkles 900–1300 ms. | Sender's seat color, gold `#ffcf3f`, white | One frozen frame with the same bursts in the same positions |
| Cats (חתולים) | 5 drawn cats cross the screen diagonally in 2000–3100 ms each (`linear`), bobbing every 220–340 ms, with "מיאו!" captions | Cat artwork as drawn. Captions in `#eef1f6` on `#0f1218`. | The same 5 cats sitting still in the same spots |
| Warp (עיוות) | The whole screen skews and scales (1300 ms alternate, `loop`), a wave runs (1100 ms `linear`), and an offset copy jumps in steps (1600–2100 ms, stepped) | Offset copy in the sender's seat color at 50 % | A fixed 6° skew, scale 1.04 and a static offset copy at 50 % |

Photosensitivity: no effect may flash more than 3 times per second, and there are no full-screen white flashes.

### 4.5 Reactions (§8)

| ID | Trigger | ms | Easing | What moves (C look) | Reduced Motion |
|---|---|---|---|---|---|
| `reactions.strip` | Tap the reactions button on my card | 200 (DS-Motion "+0 → 200"), 40 ms stagger per emoji | `pop` spring | A strip of 😂 😱 😎 🤦 🔥 👀 opens from my card (never over the board) | Fades in over 140 ms |
| `reaction.pick` | Tap an emoji | 120 | `exit` | The strip closes | Fade |
| `reaction.float` | A reaction is sent (shown on every device) | **1600** | `standard` | The emoji (36 px, as in Game-2P) rises 74 px from the **sender's** card. 0–18 %: scale 0.3 → 1.3, opacity 0 → 1. 38 %: scale 1, rotate −6°. 58 %: rotate +6°. 100 %: −74 px, scale 0.9, opacity 0. It rises above the cards, never over the board. At most 3 on screen (D19). Muted players: not shown. | Appears at the card and fades in place: 120 in, 1200 hold, 280 out = 1600 |

### 4.6 Match flow (§10, original spec "3... 2... 1... GO!")

| ID | Trigger | ms | Easing | What moves (C look) | Reduced Motion |
|---|---|---|---|---|---|
| `search.sweep` | Searching | 2400 loop | `linear` | A thin P1 arc rotates around my avatar. Empty slots show "מחפש…" blinking (1600 loop). The elapsed time updates every second. | Static arc and text. The time still updates. |
| `slot.found` | A player joins (3–4 players) | about 420 | `pop` spring | The slot rises 36 px and fades in | Fades over 200 ms |
| `vs.slam` | Match found | about 530 | `slam` spring | "VS" badge (`#1f2430`, skewX −8°, Teko) scales 1.4 → 1 and fades in. The "מוכן" badges pop 800 ms later. | Fades over 200 ms |
| `countdown.digit` | 3 · 2 · 1, 1000 ms each, aligned to server time | about 530 + hold | `slam` spring | The digit (Teko) scales 1.4 → 1. A thin P1 stroke ring expands 0.6 → 1.6 and fades (1000 ms, `standard`). | Digits cross-fade (200 ms). No ring. |
| `go` | Server start time (countdown start + 3000) | about 530, then 420 | `slam`, then `standard` | "GO!" slams in. After 400 ms the board **appears for all players at once**: cards first, then the board (rises 24 px and fades in), then the keypad, staggered 60 ms. | GO fades over 200 ms. The board fades in over 200 ms. |

### 4.7 Results (§12)

| ID | Trigger | ms | Easing | What moves (C look) | Reduced Motion |
|---|---|---|---|---|---|
| `last.cell` | `gameOver` | 700 + 400 hold | `standard` | `cell.flash.correct` on the final cell, then a 300 ms cross-fade to Results | Tint only. 200 ms fade. |
| `results.title.win` | Results + 200 | about 530 | `slam` spring | "ניצחון!" in gold `#ffcf3f`, scale 1.4 → 1, no blur | Fades over 200 ms |
| `results.title.loss` | Results + 200 | 420 | `standard` | "הפסד" drops 12 px and fades in. No overshoot, crack or shake. | Fades over 200 ms |
| `results.rank` | + 700 | about 420 | `pop` spring | The "מקום 1" badge pops with a static gold accent (round 1's "gold burst and crown") | No scale |
| `confetti` | Win only, + 700 | 1600, one time | gravity, `linear` | At most 40 Skia pieces in P1, gold and white, kept clear of the score cards | None |
| `results.sections` | + 700, staggered 150 | 420 | `standard` | Sections rise 14 px and fade in | Fades over 200 ms |
| `score.bars` | + 900 | 900 | `standard` | Score bars fill (scaleX 0 → 1) | Instant |
| `podium` | 3–4 players, + 450 … + 650 | 500 | `standard` | Podium columns grow (scaleY 0 → 1) | Instant |
| `rating.count` | + 1200 | 650 | `countUp` | The rating counts (for example 1287 → 1304). The "+17" chip pops at the end (`pop`). | Final value |
| `awards` | + 1500, staggered 150 | about 420 | `pop` spring | Award cards pop | Fade |
| `actions` | + 1900 | 240 | `standard` | "משחק חדש" (gold CTA), "צפייה חוזרת" and "לבית" rise 8 px and fade in | Fade |

### 4.8 Connection (§16)

| ID | Trigger | ms | Easing | What moves (C look) | Reduced Motion |
|---|---|---|---|---|---|
| `opp.disconnecting` | `playerDisconnected` | 240, plus loops | `standard` | The opponent card fades to 50 %. "מתנתק…" blinks (1200 loop). The "Reconnecting… 15" ring shrinks linearly from `graceEndsAt`. 2 players: every lock timer freezes (game paused). | No blink. The ring stays. |
| `self.lost` | My connection is lost | 240 | `standard` | Banner "החיבור שלך אבד · מתחבר מחדש… ניסיון 2" slides down. The board dims to 50 % and locks. The attempt dots blink (1200 loop, 200 stagger). | Fade. Static dots. |
| `reconnected` | `playerReconnected` or a re-sync | 240 | `standard` / `exit` | The banner leaves, the card returns to 100 % and timers resume from the snapshot. Toast "חזרת למשחק. הלוח והניקוד סונכרנו". | Fade |
| `opp.left` | `playerAbandoned` | 1000 | `standard` | The card fades to 50 % (`opacity.inactivePlayer`, as `components.md` §3.3) and turns gray (Skia ColorMatrix, or an overlay) | Instant |
| `countdown.tick` | Each second of a visible countdown (grace 15, search time) | 320 | `standard` | The number scales 1.22 → 1 while opacity goes 0.5 → 1 (`sf-tick`) | No scale |
| `spinner` | Any short wait | 800 loop | `linear` | A 2 px arc rotates | A static icon with "…" |

### 4.9 Screens, overlays and lists (§1: "מעברים מונפשים בין מסכים")

| ID | Trigger | ms | Easing | What moves (C look) | Reduced Motion |
|---|---|---|---|---|---|
| `stack.push` / `stack.pop` | Menu navigation: Home → Modes → GameType → BotSelect, Profile, History, Leaderboard, Settings | Platform (about 350 on iOS, about 300 on Android) | Platform | Native-stack slide. **Forward enters from the left in Hebrew** and from the right in English. On Android, set `slide_from_left` explicitly when `I18nManager.isRTL`. | `animation: 'fade'` |
| `flow.fade` | Match search → found → countdown → game → results (states of one flow, not a hierarchy) | 240 | `standard` | Cross-fade | 200 fade |
| `tabs` | Bottom navigation | 140 | `standard` | Content cross-fades. The active tab turns gold `#ffcf3f` (Dir-C-Home). | Instant |
| `sheet` | Surrender confirmation ("אתה בטוח שאתה רוצה להיכנע?"), menus | 320 in, 240 out | `standard` / `exit` | Slides up 100 % → 0. Scrim fades in to `color.scrim` (`rgba(7,9,12,.72)`). | Fades over 200 ms |
| `toast` | Success, warning, error, connection | 240 in, hold per variant (`components.md` §15.1; 3000 when none is given), 240 out | `standard` / `exit` | Slides 12 px from the top and fades in | Fade |
| `list.enter` | History, Leaderboard, Replay cards on mount | 320, staggered 40 (first 8 items only) | `standard` | Rise 12 px and fade in | Fades over 200 ms, no stagger |
| `skeleton` | Loading | 1200 loop | `loop` | Placeholder blocks `#1f2430` pulse opacity 0.5 ↔ 1 (replaces the round-1 gradient shimmer) | Static at 0.7 |
| `form.error` | Invalid field on Login or Register | 300 | `loop` keyframes | The field shakes ±5 px and the red message appears | Red border, no shake |
| `progress.fill` | XP bar on Home, level change | 650 | `standard` | The fill grows (scaleX) | Instant |

## 5. Timelines

```
Correct move (mine)      t0 key down ─ key.press 80
                         R  (≈ t0+140)  flash 700 · digit pop · "+3.5" chip pops      haptic Success · sound correct
                         R+300          chip flies 360 → my delta slot
                         R+660          count 650 · score bump · bar re-split           5 count ticks (haptic + sound)
                         R+1310         done · delta label holds until R+3060, then fades

Wrong move (mine)        R              red flash 550 · cell shake 300 · red digit     haptic Error · sound wrong
                         R+300          digit → small corner mark · cell released · "−2" chip flies 360
                         R+660          count down 650 (red → seat color) · "N טעויות" pops
                         R+1310         done

Interference on me       0              banner in · effect starts · lock timer frozen   haptic Warning · sound hit_<kind>
                         0…5000         effect loops (or static cover)                  kind rumble (≤ 2/s)
                         5000 (endsAt)  effect + banner out 240 · lock timer resumes

Countdown                0 / 1000 / 2000   3 · 2 · 1 (slam + ring)                      haptic Medium · sound countdown_beat
                         3000           GO! slam                                        haptic Heavy · sound go
                         3400           cards → board → keypad reveal (stagger 60)

Victory                  0 last-cell flash · +1100 cross-fade (300) to Results
                         (times below are from Results mount)
                         +200 title · +700 rank + confetti + sections · +900 bars · +1200 rating count
                         +1500 awards · +1900 actions                                   haptic Success at +200 · sound win
```

## 6. Implementation notes (Reanimated 4, Expo 57)

- **Only transform and opacity.** Bars use scaleX, not width. The lock halo is a separate absolutely positioned view (a 7 px inner border in `rgba(54,201,240,.28)`) whose opacity loops, instead of an animated box-shadow. Everything runs on the UI thread, to hold ≥ 55 fps (§22).
- **Lock pulse:** `withRepeat(withTiming(1, { duration: 800, easing: loop }), -1, true)` on the band's opacity.
- **Timers come from the server's clock.** `remaining = expiresAt − (Date.now() + serverOffset)`. Then `progress = withTiming(0, { duration: remaining, easing: Easing.linear, reduceMotion: ReduceMotion.Never })`. On a pause (interference on me, `gamePaused`): `cancelAnimation(progress)`. Restart from the new `expiresAt` on `interferenceEnded` or `gameResumed`. The last-3-seconds state and its haptic ticks are not fired while the timer is frozen.
- **Reduced Motion:** `reduced = useReducedMotion() || settings.reduceMotion`. Pick the reduced variant explicitly from the tables above. Don't rely only on `ReduceMotion.System`: it jumps straight to the end value, so the 200 ms fades would never play, and it ignores the in-app setting. Pass `ReduceMotion.Never` to the reduced variants and to all timers.
- **Count-up text:** animate a shared value and render it through an animated `TextInput` (`useAnimatedProps` → `text`), rounded to 0.5. Set `fontVariant: ['tabular-nums']` so the width doesn't jitter.
- **Flights:** draw them in one overlay layer above the board (`pointerEvents="none"`). Measure the cell and the target delta slot with `measure()` (or cached `onLayout`). Drive one progress value (0 → 1) and compute the quadratic Bezier position in a worklet.
- **Optimistic display (§18):** cell selection shows `cell.pending` right away. A digit result never animates before the server answers. If the server rejects a pending lock, revert it (140 ms fade) and play `cell.denied`.
- **Order of overlays:** board → flights → reactions → interference effect → hit banner → toasts → sheets.
- **The board stays LTR** (CLAUDE.md). Shakes and flights use layout coordinates, so they work the same in both UI directions.
- **Settings:** `sfx` and `haptics` services read the "צליל" and "רטט" toggles from the persisted Zustand store (work plan, stage 4).

## 7. Haptics (`expo-haptics` 57)

`import * as Haptics from 'expo-haptics'`. Abbreviations in the table:
`impact(X)` = `Haptics.impactAsync(Haptics.ImpactFeedbackStyle.X)` and
`notify(X)` = `Haptics.notificationAsync(Haptics.NotificationFeedbackType.X)`.

| Event | Call | When exactly | Notes |
|---|---|---|---|
| Tap an empty cell (lock request) | `Haptics.selectionAsync()` | On tap (optimistic) | DS "SELECTION" |
| Tap a cell locked by someone else, or my cell during the 1 s cooldown | `impact(Medium)` | On tap | §6.2.3: "רטט קצר, בלי קנס". One short knock, different from the selection tick. |
| "ביטול בחירה" (manual release) | `Haptics.selectionAsync()` | On tap | |
| Digit key press | none | | The result haptic follows within about 150 ms. A press haptic would make two buzzes. |
| My correct digit | `notify(Success)` | At R (`placedCorrect`) | DS "SUCCESS" |
| My score count-up | `Haptics.selectionAsync()` × 5 | At 0, 60, 140, 250 and 420 ms into the count | DS "MICRO TICKS". With the `countUp` curve, these land at about 0/25/50/75/95 % of the value. My score only. |
| My wrong digit | `notify(Error)` | At R (`placedWrong`) | DS "ERROR" (heavy then light) |
| My lock: 3, 2, 1 seconds left | `impact(Light)` | At each whole second | DS "1 / SEC". My lock only. Not fired while frozen. |
| My lock expired (auto release) | none | | No penalty (D2). The 3 ticks were the warning. |
| Open the arsenal (⚡) | `Haptics.selectionAsync()` | On tap | |
| Lift a token (drag start) | `impact(Light)` | On drag start | |
| The drag enters the drop zone | `Haptics.selectionAsync()` | Once per entry | |
| Launch (drop inside the zone) | `impact(Medium)`, then `impact(Medium)` again after 90 ms | On drop | DS "IMPACT M". The second knock suggests the long landing. |
| Drop outside (cancel) | none | | |
| An interference hits me | `notify(Warning)`, then a rumble for the kind | Start, then until `endsAt` | DS "RUMBLE 5S". Fireworks: `impact(Medium)` per burst (≥ 700 ms apart). Cats: `impact(Light)` as each cat enters. Warp: `impact(Light)` every 1100 ms. With Reduced Motion: only the start `Warning`. |
| Reaction received from an opponent | `impact(Light)` | When the float starts | DS "SOFT". Never for muted players. |
| Send a reaction (tap an emoji) | `Haptics.selectionAsync()` | On tap | |
| I take the lead | `impact(Light)` | When the count lands | §1: a leader change should be felt. Losing the lead gets no haptic (visual and sound only). |
| Match found | `notify(Success)` | When "VS" appears | |
| Countdown 3 · 2 · 1 | `impact(Medium)` | On each digit | DS "BEATS" |
| GO! | `impact(Heavy)` | On GO | DS "IMPACT H" |
| Win (place 1) | `notify(Success)` | Title appears (+200) | DS "WIN" |
| Loss, or place 2–4 | `impact(Light)` | Title appears (+200) | DS "LOSS" |
| Opponent disconnects / my connection is lost | `notify(Warning)` | On the event | |
| I'm back in the game | `notify(Success)` | On re-sync | |
| Confirm surrender ("כן, להיכנע") | `impact(Heavy)` | On confirm | |
| Settings toggle, segmented choice | `Haptics.selectionAsync()` | On change | |
| Form validation error | `notify(Error)` | With `form.error` | |

Rules:
- Off when "רטט" is off. Nothing is fired while the app is in the background.
- **At most one haptic per 80 ms.** When several fire in the same frame, the strongest wins: Error > Heavy > Success > Warning > Medium > Light > Selection.
- Opponents' board moves never cause a haptic. Only events that happen to me, or that I cause, do.
- Optional Android refinement later: `Haptics.performAndroidHapticsAsync` (`Confirm` / `Reject`) for Success and Error, if the vibrator patterns feel weak on test devices.

## 8. Sound (`expo-audio` 57)

| Event | Suggested sound | File in `assets/sounds/` | Length | Need |
|---|---|---|---|---|
| Tap an empty cell | Short wooden tick (DS "טיק עץ קצר") | `cell_select` | ≤ 60 ms | V1 |
| Tap a cell that is taken / in cooldown | Muted soft "thunk" | `cell_denied` | ≤ 150 ms | V1 |
| Release (manual or expired) | Soft reverse tick | `cell_release` | ≤ 150 ms | V1 |
| Correct digit | Rising "ding" with a coin chime (DS) | `correct` | 300–500 ms | V1 |
| Score count-up / rating count | Tiny tick, played up to 5 times (DS "טיקים מתגלגלים") | `count_tick` | ≤ 30 ms | V1 |
| Wrong digit | Low buzz, about 120 ms, without drama (DS) | `wrong` | 120–200 ms | V1 |
| My lock: last 3 seconds | Quiet clock tick, my lock only (DS) | `lock_tick` | ≤ 60 ms | V1 |
| Open the arsenal | Soft drawer slide | `arsenal_open` | ≤ 250 ms | Optional |
| Drag a token | Whoosh (DS "ווש בגרירה") | `interfere_whoosh` | 300–500 ms | V1 |
| Launch lands | Pop or burst (DS "פיצוץ בנחיתה") | `interfere_launch` | 300–600 ms | V1 |
| Hit by fireworks | Crackle and pops bed, fading out at the end | `hit_fireworks` | **≤ 5.0 s** | V1 |
| Hit by cats | Meows and scampering | `hit_cats` | **≤ 5.0 s** | V1 |
| Hit by warp | Warbling synth wobble | `hit_warp` | **≤ 5.0 s** | V1 |
| Reaction 😂 | Short chuckle | `react_laugh` | ≤ 800 ms | V1 |
| Reaction 😱 | Gasp | `react_scream` | ≤ 800 ms | V1 |
| Reaction 😎 | Finger snap or "yeah" sting | `react_cool` | ≤ 800 ms | V1 |
| Reaction 🤦 | Soft slap or "doh" | `react_facepalm` | ≤ 800 ms | V1 |
| Reaction 🔥 | Flame whoosh | `react_fire` | ≤ 800 ms | V1 |
| Reaction 👀 | Curious "hmm" or little boing | `react_eyes` | ≤ 800 ms | V1 |
| Reaction (fallback for future emoji) | Soft pop (DS "פופ רך") | `react_pop` | ≤ 200 ms | V1 |
| Match found | Two-note chime | `match_found` | ≤ 700 ms | V1 |
| Countdown 3 · 2 · 1 | Drum hit (DS) | `countdown_beat` | ≤ 400 ms | V1 |
| GO! | Gong with a short crowd cheer (DS) | `go` | ≤ 1.5 s | V1 |
| Win | Short fanfare (DS) | `win` | ≤ 2 s | V1 |
| Loss | Descending chord (DS) | `lose` | ≤ 1.5 s | V1 |
| I take the lead | Short rising swish | `lead_take` | ≤ 400 ms | Optional |
| I lose the lead | Short falling swish | `lead_lose` | ≤ 400 ms | Optional |
| Disconnect (opponent or me) | Two tones going down | `disconnect` | ≤ 600 ms | V1 |
| Reconnected | Two tones going up | `reconnect` | ≤ 600 ms | V1 |
| Primary CTA press ("שחק") | Soft UI click | `ui_tap` | ≤ 80 ms | Optional |

**What Moshe needs to supply** (work plan: "צלילים … עד שלב 4"): the 26 V1 files above, plus the 4 optional ones if possible.
- **License: CC0 only.** For each file, keep the source URL and author in a credits list, for the store review (§23). CC0 sources: Kenney.nl audio packs (Interface Sounds, UI Audio, Impact Sounds, Casino Audio for coins), Freesound.org filtered to "Creative Commons 0", and OpenGameArt filtered to CC0.
- **Format:** `.m4a` (AAC) or `.mp3`, 44.1 kHz, mono. `.wav` is also fine. Use the exact file names above. No leading silence. Peak ≤ −1 dBFS, and similar loudness across files.
- **The three `hit_*` files must not be longer than 5.0 s** and should fade out over the last 300 ms, so they end with the effect.

Playback rules:
- `setAudioModeAsync({ playsInSilentMode: false, interruptionMode: 'mixWithOthers' })`. The iOS silent switch mutes the game, and the player's own music keeps playing.
- Preload every game sound when the game screen mounts (`createAudioPlayer`). Keep 2 players each for `count_tick` and `lock_tick` so fast repeats don't cut each other off. At most 4 sounds at once. The newest UI tick is dropped first.
- Starting volumes: ticks 0.3, `cell_select` 0.5, `correct` and `wrong` 0.8, reactions 0.6, `hit_*` 0.6, `win` / `go` 0.9. Final tuning happens in stage 14 ("צלילים סופיים וכיול עוצמות").
- Off when "צליל" is off. Sounds from muted players' reactions never play. Until the files exist, the `sfx` service maps every event to a placeholder (stage 4).

## 9. Points for Moshe to confirm

Each of these is a choice made while translating round 1 to C. None of them removes a requirement from the original spec.

1. **Last 3 seconds of my lock:** gold blink (DS-Motion says "זהב מהבהב"; the playable Game-2P turned it red). I chose gold `#ffcf3f`, because red means "penalty" in C and there is no penalty for expiry (D2).
2. **The round-1 hit screens show "הזמן ממשיך" next to my lock.** This contradicts §6.2.7 / D11 (the victim's lock timer stops). This file follows the spec: the timer is frozen. The label should be removed when the screens are redrawn in C.
3. **Taken-cell haptic:** `impact(Medium)`, a single short knock, as the literal "רטט קצר". The alternative is `notify(Warning)`, a double pulse.
4. **Win effect:** one 1.6 s confetti burst instead of round 1's endless fall and sunburst.
5. **Score counter haptics:** 5 selection ticks per move, as DS-Motion specifies. If it feels noisy in playtests, the easy cut is 0 ticks (the sound alone).
6. **Delta label** ("+3.5" next to the score): shown for 2400 ms after landing, then fades. Dir-C-Game shows it but doesn't say for how long.
7. **Dominance bar:** moves for 650 ms, in step with the count (as in the playable Game-2P). DS-Motion's card says 240 ms.
8. **Not motion, but found while checking contrast:** the small red wrong digit (`#ff4d5e`, 11 px) on C's light board is about 3.0:1 on `#f7f8fa` and 2.8:1 on `#eceff4`. That is below the 4.5:1 in §22. Resolved in `tokens.json`: the board uses `color.board.wrongDigit` `#b8102f` (≥ 4.65:1 on every cell and tint); `#ff4d5e` stays for flashes and dark surfaces.

## 10. Motion tokens

The same values live in `docs/design/tokens.json` → `motion`, which the code reads and which wins if the two ever differ.
Key map: `durations.instant` / `fast` / `base` / `slow` / `score` / `shake` / `reaction` = `duration.tapFeedbackMin` /
`tapFeedbackMax` / `stateChange` / `rewardMin` / `scoreCount` / `wrongShake` / `reactionFloat`. `easings.*` = `easing.*` (as
`[x1, y1, x2, y2]` arrays) and `easings.spring` = `spring`. `loops` = `loop`. `limits` = `limits`. `sequences` = `sequence`, but
`tokens.json` times the move sequences from the key press t0, where R ≈ t0 + 140 (so R + 300 = t0 + 440, R + 660 = t0 + 800),
and `sequence.matchFound` from the moment the match is found (countdown at + 1200, so GO at + 4200 = `countdown.goAt` 3000 + 1200).

```json
{
  "motion": {
    "durations": {
      "instant": 80,
      "fast": 140,
      "base": 240,
      "slow": 420,
      "score": 650,
      "shake": 300,
      "reaction": 1600,
      "interference": 5000
    },
    "easings": {
      "standard": "cubic-bezier(0.2, 0.8, 0.2, 1)",
      "emphasized": "cubic-bezier(0.34, 1.56, 0.64, 1)",
      "exit": "cubic-bezier(0.42, 0, 1, 1)",
      "countUp": "cubic-bezier(0.33, 1, 0.68, 1)",
      "loop": "cubic-bezier(0.42, 0, 0.58, 1)",
      "linear": "cubic-bezier(0, 0, 1, 1)",
      "spring": {
        "pop": { "mass": 1, "stiffness": 260, "damping": 18 },
        "settle": { "mass": 1, "stiffness": 300, "damping": 30 },
        "press": { "mass": 1, "stiffness": 500, "damping": 32 },
        "slam": { "mass": 1, "stiffness": 220, "damping": 15 }
      }
    },
    "loops": {
      "lockPulse": 1600,
      "lockUrgentBlink": 1000,
      "statusBlink": 1200,
      "dropZoneMarch": 800,
      "dropZoneBreathe": 1100,
      "searchSweep": 2400,
      "spinner": 800,
      "skeleton": 1200
    },
    "sequences": {
      "correctMove": { "chipHold": 300, "flight": 360, "countAt": 660, "cellFlash": 700, "deltaHold": 2400 },
      "wrongMove": { "cellFlash": 550, "digitShrinkAt": 300, "flightAt": 300, "flight": 360, "countAt": 660 },
      "countdown": { "step": 1000, "goAt": 3000, "boardRevealDelay": 400, "revealStagger": 60 },
      "victory": { "titleAt": 200, "rankAt": 700, "barsAt": 900, "ratingAt": 1200, "awardsAt": 1500, "awardsStagger": 150, "actionsAt": 1900, "confetti": 1600 },
      "sheet": { "in": 320, "out": 240 },
      "toast": { "in": 240, "hold": 3000, "out": 240 },
      "listStagger": 40
    },
    "reduced": {
      "fade": 200,
      "reactionIn": 120,
      "reactionHold": 1200,
      "reactionOut": 280,
      "wrongFrame": 300
    },
    "limits": {
      "lockUrgentSeconds": 3,
      "maxReactionsOnScreen": 3,
      "hapticMinGap": 80,
      "countTicks": [0, 60, 140, 250, 420],
      "confettiPieces": 40,
      "maxFlashesPerSecond": 3,
      "dominanceShareMin": 0.06,
      "dominanceShareMax": 0.94
    }
  }
}
```
