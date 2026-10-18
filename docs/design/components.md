# Sudoku Fight: component specification, direction C ("לילה רגוע" / Calm Night)

Stage 3 of `docs/02-WORK-PLAN.md` (design system in the app). Direction C was chosen on 2026-10-09 (`docs/01-SPEC.md` §24, D30).

This file says **what every stage-3 component looks like and how it behaves**. Colours, fonts, spacing, radii and motion values
come from `docs/design/tokens.json`. That file is the source of truth for values. The hex codes here are for reference only.

---

## 0. How to read this file

### 0.1 Sources and provenance tags
| Tag | Meaning |
|---|---|
| **[C]** | Taken exactly from `Dir-C-Home.dc.html` or `Dir-C-Game.dc.html`. These two boards decide **colour, font and look**. |
| **[R1→C]** | Structure, size, state or behaviour from round 1 ("Arena Ink": `DS-Components`, `DS-Foundations`, `DS-Motion`, `Game-*`, `Arsenal`, `Surrender`, …), translated into C's calm palette. Translation means **no gradients, no textures or halftone, no glows, no skew** (except the primary button and the VS badge, which C keeps), 1px borders instead of 2px, and flat fills. |
| **[new]** | Not drawn on any board. Added because the spec requires it (the section is cited). These need Moshe's eye. |

Every Hebrew string in this file is a UI string. A string marked **†** is *proposed* copy that follows a pattern from the design or
the work plan. It does not appear on any board, so add it to `locales/he.json` and `locales/en.json` for review.

### 0.2 Units and canvas
- All sizes are dp at the **390 × 844** reference screen. Side gutter: **16** on game screens [C] and **24** on Home [C].
- Fixed widths below (358, 159, …) are at 390 width. Section 11.1 has the scaling rules for the board and keypad.

### 0.3 Tokens used (names written by the sibling `tokens.json`)
| Token | C reference | Used for |
|---|---|---|
| `color.bg` | `#0f1218` | Screen ground, box gaps on the board, text on coloured pills |
| `color.surface` | `#171b24` | Raised areas: Home profile card, sheets, modals, compact cards |
| `color.surface2` | `#1f2430` | Keys, VS badge, progress track, toasts |
| `color.border` | `#2a3140` | Outlines, dividers, inactive frames |
| `color.text` | `#eef1f6` | Primary text (16.6:1 on bg) |
| `color.textMuted` | `#9aa3b5` | Secondary text, icons (7.4:1 on bg, 6.1:1 on surface2) |
| `color.textFaint` | `#828ba1` | Third text level (timestamps, hints). C's `#677086` lifted to pass: 5.5:1 on bg, 5.05:1 on surface, 4.55:1 on surface2. |
| `color.iconFaint` | `#677086` | **Decorative only** (C's faint gray): chevrons, separator dots, locked-token art. 3.8:1 on bg and 3.5:1 on surface, so it fails 4.5:1. Never use it for text that carries information. |
| `color.accent` | `#ffcf3f` | The one primary action, rating numbers, the active nav item, the "#1" rank badge, the interference target frame |
| `color.onAccent` | `#241a00` | Text on accent (11.7:1) |
| `color.danger` | `#ff4d5e` | Mistakes, penalties, surrender, errors (5.8:1 on bg). **Not** for small text on the light board (3.05:1). Use `color.board.wrongDigit` there. |
| `color.players[n].ring` | P1 `#36c9f0` · P2 `#ff9440` · P3 `#a2e28e` · P4 `#a57af0` | Avatar frame, score number, lock ring, lead-bar segment, glyph on dark backgrounds |
| `color.players[n].tint` | P1 `#d6f4fc` · P2 `#ffe8d4` · P3 `#b2eea0` · P4 `#e0d1fa` | Background of a solved cell and of my lock cell |
| `color.players[n].digit` | P1 `#0b6a85` · P2 `#9a4a0c` · P3 `#256412` · P4 `#6234b2` | Digit in a solved cell, glyph on the board (≥5.28:1 on its tint) |
| `color.players[n].onRing` / `.lockEdge` | `#0f1218` / = `.digit` | Text on a ring-coloured pill / 1 dp inner edge of a lock ring (§11.3) |
| `color.board.*` | see below | Board only |

**`color.board.*` subkeys** (names as in `tokens.json`).
| Subkey | C reference | Note |
|---|---|---|
| `color.board.cell` | `#f7f8fa` | Cells in boxes 0, 2, 4, 6, 8 |
| `color.board.cellAlt` | `#eceff4` | Cells in boxes 1, 3, 5, 7 (checkerboard) |
| `color.board.grid` | `#c8cdd6` | 1px lines between cells inside a box |
| `color.board.boxGap` | = `color.bg` | 3px gaps between boxes |
| `color.board.given` | `#0f1218` | Given digits (17.6:1) |
| `color.board.wrongDigit` | **not in C:** `#b8102f` | Small red wrong digits. C uses `#ff4d5e` (3.05:1 on the cell, which fails). Round 1's `#d10f37` fails on the P3 and P4 tints (4.08 and 3.83:1). `#b8102f` measures ≥4.65:1 on every cell, alt-cell and tint background. |
| `color.board.peer` | `null` | **Not used.** C draws no row/column/box highlight (§11.3 #8). |

**Other tokens this file uses** (all defined in `tokens.json`):
`color.accentShadow` (`#b88f00`, the hard shadow under the primary button) [C] · `color.success` (`#40e29f`: connected dot
and success toast only, never on the board; a correct move uses the mover's seat colour) · `color.status.online` /
`.offline` · `color.scrim` (`rgba(7,9,12,.72)`) [R1→C] · `color.dangerSubtle` / `dangerBorder` / `dangerPressed` ·
`color.keypad.*` · `color.interfere.*` · `color.league.{bronze,silver,gold,diamond,legend}` [R1].
P3 ■ and P4 ◆ are round 1's lime and magenta, calmed for C to green `#a2e28e` and violet `#a57af0` (see `tokens.json` `_cvd`).

### 0.4 Type, spacing, radii, icons
- **Fonts [C]:** `Rubik` 400/500/700 for UI text (plus 600 for given digits, which C asks for; `tokens.json` loads it), and `Teko` 500/600 for every number (score, rating, timer, keys, cell names such
  as F8, "VS"). Teko is always tabular (`fontVariant: ['tabular-nums']`). C drops round 1's Karantina headings.
- **Teko metrics:** C sets `line-height: .8` plus a small `padding-top` (3–6) to centre Teko optically. In RN use
  `includeFontPadding: false` (Android), set `lineHeight ≈ 0.8 × size`, and nudge with `paddingTop`. Check on both platforms.
- **Numbers** are always Latin digits. The minus sign is U+2212 (`−2`). Half points show one decimal (`39.5`). Whole numbers show
  none (`55`).
- **Spacing:** 4-dp grid [R1].
- **Radii used by C:** 2 (thin bars) · 6 (VS, small chips) · 7 (22-dp mini avatar) · 8 (seconds pill) · 10 (key, 36-dp avatar) ·
  12 (buttons, board, icon buttons) · 14 (Home profile card, 44-dp avatar frame) · 16 (popover) · 20 (72-dp avatar frame, centred
  modal) · 24 (sheet top corners).
- **Icons [C]:** 24×24 viewBox, stroke 2, round caps and joins, `currentColor`. Drawn at 20–24. The icon set is round 1's list
  (DS-Foundations §08).
  - **Bot** (Moshe's device test, 15.10.2026: "not clear enough"): redrawn after DS-Components' bot chip, with a mouth, solid eyes
    twice as large (r 1 under the 2 stroke) and an antenna ball. Used on the Modes card (at 28, §2), Match-Timeout's "play a bot"
    and the results' opponents of a bot game.

### 0.5 Motion, haptics and reduced motion (DS-Motion → C)
| Token | Value | Use |
|---|---|---|
| tap | 80–140ms | Key or button press. **Every action gets feedback within 140ms.** |
| state | 240ms, `cubic-bezier(.2,.8,.2,1)` | Any state change: lock appears or releases, colours cross-fade |
| shake | 300ms | Wrong move, "taken" cell, nudge |
| count | 650ms | Score counting up on the card |
| reward | 420–900ms, `cubic-bezier(.34,1.56,.64,1)` | Digit pop, popover pop, slam |
| timers | linear | Lock ring and bars only |
| lock | 8 / 12 / 18 s | From `rules` (D2). **Never hard-code.** |
| interference | 5000ms exactly | From `rules` |

**Reduced motion** (`ReduceMotion.System` in Reanimated, plus the in-app switch). The information stays and the drama goes:
shake becomes a 2-dp red frame for 300ms. The flying "+3.5" appears next to the score and fades. The score count jumps
straight to the final number. Slam or zoom becomes a 200ms fade. Pulsing rings become fixed rings. A gold burst becomes a
static frame.

**Haptics [R1]:** light tick when you select a cell · success when a digit is correct · a low 120ms buzz on a wrong digit (no
drama) · a quiet tick once per second in the last 3 s of **my** lock only · medium impact when an interference lands · a short
medium knock ("taken") when you tap an opponent's lock. The full list is `motion.md` §7. All haptics and sounds respect the user's settings.

### 0.6 Global rules
- **Me is always P1** (`players[0]`, shape ●). Opponents get P2–P4 by seat order, shapes ▲ ■ ◆. Components take a `colorIndex`
  (0 = me), never a raw server seat.
- **The board, the keypad and cell names are always LTR.** Wrap them in `direction: 'ltr'`. Everything else follows the app
  direction. In RN, `flexDirection: 'row'` flips automatically under `I18nManager.isRTL`.
- **Mixed text:** a cell name, score or Latin player name inside Hebrew text is wrapped in an LTR isolate (`⁦…⁩`), or
  goes in its own `<Text>` with `writingDirection: 'ltr'`. For example `בוחרת · ‪A8‬`.
- **Touch targets** are ≥44×44 (use `hitSlop` when the visual is smaller). Two exceptions you need to approve are in §17.
- **Contrast:** text needs ≥4.5:1. Non-text cues need ≥3:1, or a redundant non-colour cue (shape, avatar, text).
- **Focus ring** (keyboard, switch control): 2-dp `color.accent` outline, offset 2 [R1→C].
- **One primary (gold) action per screen** [R1].
- **Example data** must follow the known-fixes list in `docs/03-DESIGN.md`: the best move is ≤6.5 points on fast, ≤9.5 on normal and ≤12 on hard (the bank after D43), a provisional rating
  says "10 משחקים", the league thresholds follow §11.3, and there is no "עונה 3".

---

## 1. Buttons

All buttons: `accessibilityRole="button"`, and `accessibilityState` with `disabled` and `busy` (and `expanded` where it applies). The
label is the visible text. Icon-only buttons need an explicit label.

### 1.1 Primary: skewed gold ("שחק") [C]
**Anatomy:** skewed container › counter-skewed label. A hard shadow sits under it.

| Property | Value |
|---|---|
| Container | `transform: skewX(-8deg)`. Label inside: `skewX(8deg)` |
| Fill | `color.accent`. No gradient (round 1's gradient and shine are dropped). |
| Radius | 12 |
| Shadow | Hard offset `0 4 0 color.accentShadow`. In RN, draw it as a sibling View in `accentShadow` placed 4 dp lower. RN shadows blur, and Android elevation has no colour or offset. |
| Label | Rubik 700, `color.onAccent`, centred |
| Sizes | `hero`: height **96**, label **44** [C, Home "שחק", full width 342] · `lg`: height 60, label 28 [R1 height, C font] · `md`: height 52, label 20 [R1→C] · `modal`: height 48, label 18 [R1→C]. Heights are `size.ctaHero`, `size.buttonLg`, `size.buttonMd`, `size.buttonModal`. A long label uses `md` (Register-Account's "צור משתמש והיכנס לזירה": at `lg` it could not fit a 360 dp phone; at `md` it does, measured in Rubik 700, up to text scale 1.1, and `wrapLabel` gives it a second line from 1.15). |
| Large text | With `wrapLabel`, from the system's "Large" text size (fontScale ≥ 1.15) the label may take a second line when it no longer fits on one, and the button grows (min height instead of height; the shadow follows). Below that, and without `wrapLabel`, one line at the fixed height. |
| Width | Fill the parent, or content plus 26 padding on each side |

| State | Visual |
|---|---|
| default | As above |
| pressed | Container `translateY(3)`, shadow shrinks to `0 1 0` (tap duration). Light haptic. |
| disabled | Opacity .4, no shadow, `accessibilityState.disabled` |
| loading | Label is replaced by a spinner: 22 dp, 3 dp ring in `onAccent` at 22% with the top arc in `onAccent`, rotating every .8 s, linear. `busy: true`. Label "שחק, טוען" [R1]. |

**RTL:** the skew angle stays −8° in both languages (it is a brand slant, not a direction cue), as round 1 did in RTL.
**Tokens:** `color.accent`, `color.onAccent`, `color.accentShadow`.

### 1.2 Secondary: outline
Two shapes.

**a) Plain outline** [R1→C]: height 52 (`md`), 48 (`modal`) or 60 (`lg`), transparent background, 1 dp `color.border`, radius 12, label Rubik 500 16 (`md`) or 18 (`lg`) in `color.text`. **Not skewed.**

**b) Row button ("עוד סיבוב")** [C]: full width, height **64**, padding 0 16, gap 14, transparent, 1 dp `color.border`, radius 12,
text aligned to start.
- Leading icon: 22, `color.textMuted`.
- Text stack (gap 5): title Rubik 500 16 `color.text` ("עוד סיבוב"), subtitle Rubik 400 13 `color.textMuted` ("מדורג · 2 שחקנים · רגיל").
- Trailing chevron: 20, stroke 2.2, `color.iconFaint`, decorative. It points to the reading direction's "forward": left in Hebrew, mirrored in English.

| State | Visual |
|---|---|
| pressed | Background `color.surface` |
| disabled | Opacity .4 |
| loading | 20 dp spinner in `color.text`, `busy` |
| selected (chip-like use) | Border `color.accent`, label `color.accent` [R1→C] |

**Tokens:** `color.border`, `color.text`, `color.textMuted`, `color.iconFaint`, `color.surface`.

### 1.3 Ghost / text ("הכל", "ביטול בחירה") [C]
- Height **44**, padding 0 4 (text only) or 0 16 (with icon), transparent, no border, radius 12.
- Label Rubik 500 14 ("הכל") or 15 ("ביטול בחירה"), `color.textMuted`.
- Optional leading icon 20, gap 8.

| State | Visual |
|---|---|
| pressed | Background `color.surface`, label `color.text` |
| disabled | Opacity .4 |
| loading | 14 dp spinner (2 dp ring) before the label [R1] |

**Tokens:** `color.textMuted`, `color.text`, `color.surface`.

### 1.4 Icon button 44×44 (settings, surrender, reactions, close) [C]
- 44×44, transparent, 1 dp `color.border`, radius 12, centred icon 20 (in a card) or 22 (in a header), `color.textMuted`.
- **The label is required:** "הגדרות", "כניעה", "תגובות", "סגירה" [design].

| State | Visual |
|---|---|
| pressed | Background `color.surface2`, icon `color.text` |
| expanded (reactions picker open) | Background `color.surface2`, border `color.textMuted`, icon `color.text`, `expanded: true` [R1→C; round 1 used gold here, and C keeps gold for the primary action] |
| disabled | Opacity .4 |
| loading | 18 dp spinner. Label e.g. "הגדרות, טוען" [R1] |

**Tokens:** `color.border`, `color.textMuted`, `color.text`, `color.surface2`.

### 1.5 Danger ("כן, להיכנע") [R1→C]
C has no danger button, so this is a translation. **It is an outline, not a fill**, for two reasons. `#fff` on `color.danger` is only
3.24:1, and §6.6 requires that "ביטול" be the *more prominent* button.
- Same height as the paired primary (60 in the surrender modal). Background `color.dangerSubtle` (8%), 1 dp `color.dangerBorder` (55%), radius 12, the same pattern as C's interference button. Label Rubik 700 18 `color.danger` (4.88:1 on the fill over surface). **Not skewed**, so it never looks like the primary.

| State | Visual |
|---|---|
| pressed | Background `color.dangerPressed` (12%; label 4.65:1. Do not go to 16%, which drops it to 4.40:1) |
| disabled | Opacity .4 |
| loading | Spinner in `color.danger`. Label "כן, להיכנע, טוען" [R1] |

**Tokens:** `color.danger`, `color.dangerSubtle`, `color.dangerBorder`, `color.dangerPressed`.

---

## 2. Avatar with frame [C sizes where they exist, R1→C for the rest]

**Anatomy:** frame (border plus inner padding) › image › optional badges (presence dot, bot chip, result badge).

The frame is a **border, not a filled plate** [C]. Image size = outer − 2 × (border + padding). Image radius = frame radius − (border + padding). Values: `tokens.json` `size.avatar.*`.

| Size | Use | Border / padding | Image | Frame radius / image radius | Source |
|---|---|---|---|---|---|
| 22 | Mini avatar in an opponent-locked cell | none | 22 | — / 7 | [C] |
| 34 | Compact card (3–4P) | 2 / 1 | 28 | 10 / 7 | [R1→C] |
| 36 | Recent games, neutral lists | none | 36 | — / 10 | [C] |
| 44 | 2P player card | 2 / 2 | 36 | 14 / 10 | [C] |
| 52 | Lists, leaderboard rows | 2 / 2 | 44 | 16 / 12 | [R1→C] |
| 72 | Home profile | 2 / 2 | 64 | 20 / 16 | [C] |
| 96 | Profile screen | 2 / 3 | 86 | 24 / 19 | [R1→C] |

- **Frame colour:** `color.players[n].ring` during a game, and also on Home for "me" (P1) [C]. Outside a game, other players use `color.border` (neutral) [R1→C].
  - **Exception, the bot on the Modes card** (Moshe's device test, 15.10.2026; as the Modes board drew it): no avatar but the robot
    icon at 28 in P2's ring, in a 44 frame (radius 14, border 2) of P2's ring on `color.surface2`. The bot is my one opponent, so
    this phone shows it as P2. It stands next to the solo row's "my avatar at 44 in my P1 frame"; the picture is decorative (the
    row's label says it), and its shape tells it apart without colour.
- **No avatar:** id `av00` (`NO_AVATAR_ID`; a deleted or missing account): the placeholder from `packages/avatars`, drawn in code. The avatars themselves are our own animated characters (`packages/avatars`, spec §3.4), not image files.
- **Badges** [R1→C]:
  - **Presence dot** [new in C, from R1]: 10 dp (12 on 44+). Sits at the bottom-end corner with a −3 offset and a 2 dp border in the background colour behind it. Connected → `color.status.online`. **Unstable** (the connection is lost, still inside its soft phase, D42, Moshe 2026-10-15) → `color.status.unstable` (amber, the warning colour), and the image is **not** greyed: the game goes on as usual. Reconnecting (the grace, after the soft phase) → `color.textMuted`. Left → no dot. Static, so reduced motion changes nothing.
  - **Bot chip:** height 18, padding 0 5, radius 9, background `color.bg`, 1 dp `color.textMuted`, bot icon 11 plus "בוט" Rubik 700 10 `color.text`. Sits at the top-start corner (−7, −9).
  - **Result badge (Home recent games)** [C]: a 20 dp circle at top-end (−6, −6), background `color.border`, 2 dp `color.bg` ring, letter Rubik 700 12 `color.text` ("נ").
- **States:**
  - Disconnected: image grayscale with opacity .7, frame `color.status.offline` [R1→C].
  - Left or surrendered: same, plus the card dims (§3.4).
- **A11y:** decorative (`accessible={false}`) whenever the name is next to it, which is almost always. When it stands alone, the label is the player name.
- **RTL:** badge corners use start/end, so they mirror.
- **Avatar picker** (Register-Fighter, Edit profile; Moshe's device test, 14.10.2026, replaces the stage and strip): a field as high as the name's (44): the chosen avatar at 34 in my P1 frame, its name, "שינוי ⌄". A tap opens the sheet in its `fill` form (§13), "בחר אווטאר" with "הבחירה שלך: …" under it: all 101 in a grid of 72 dp frames (as many to a row as fit, at least 8 apart: 4 on a 360 dp phone), under a sticky header per kind (Rubik 500 16 `color.textMuted`). Each one is a radio, still (no idle, no reaction); the chosen one in my P1 frame with a tick badge, a locked one [D17] grey with a lock badge. A tap chooses and closes; the field's avatar smiles and bounces (reduced motion: the smile only). The grid is virtualized and opens on the chosen avatar's row.
- **Fighter card** (Register-Fighter's preview "ככה יראו אותך בזירה", Register-Account's "הלוחם מוכן"): one full-width card, `color.surface`, 1 dp P1 border, radius 14, padding 12: the avatar at 52 in my P1 frame, ● and the name (Rubik 700 16, one line, room for 16 characters on a 360 dp phone), and under it the flag 13 with the country's name and a note ("חדש" / "✓ הלוחם מוכן"). No VS and no opponent.

**Tokens:** `color.players[n].ring`, `color.border`, `color.bg`, `color.status.online`, `color.status.unstable`, `color.status.offline`, `color.textMuted`.

---

## 3. Player card: 2 players [C layout, with additions marked]

### 3.1 Placement (game screen, 390 wide) [C]
| Element | Frame |
|---|---|
| My card | Top 48, **start edge** (right 16 in Hebrew), 159 × 160 |
| Opponent card | Top 48, end edge (left 16 in Hebrew), 159 × 160 |
| VS badge | Top 58, centred (x 177–213), 36 × 24 |

**Cards have no background, border or shadow in C.** They sit straight on `color.bg`. The opponent card is a mirror image:
`flexDirection: 'row-reverse'` on each row, so the avatar is on the outer edge. In English the whole pair flips: me on the left
(see Game-2P-EN).

### 3.2 Anatomy (three rows, total height 160) [C]
| Row | Height / top margin | Content |
|---|---|---|
| 1 · identity | 44 / 0 | Avatar 44 (§2), gap 10, then the name block: **[new]** seat glyph 7 dp in `players[n].ring` (● me, ▲ opponent), gap 4, then name Rubik 700 16/1.2 `color.text`, single line with ellipsis, gap 6, flag 15 (§4). The glyph is the legend for the shapes on the board (spec §22: ownership must not depend on colour alone), as on the compact card (§7.2). **[new] Under the name:** rating, Teko 600 16 `color.accent` (§5). Name plus rating come to 37 dp, which fits in 44. For the opponent, the name block is LTR (`dir=ltr` in C). |
| 2 · score | 56 / 10 | Score Teko 600 **64**, line-height .8, padding-top 6, tabular, `color.players[n].ring`. Gap 8, baseline-aligned. **Last delta** "+3.5" in Teko 500 22, same colour. |
| 3 · status + actions | 44 / 6 | Space-between. **Me:** mistake text "1 טעות", Rubik 400 14 `color.textMuted`, then [כניעה][תגובות] icon buttons 44 with gap 4. **Opponent:** activity text "בוחרת · A8" in Rubik 400 14 `color.textMuted`, with the cell name in `color.text`. **[new]** A 14 dp timer ring sits before the text (§3.3). Then the interference button (§8.1). |

**The original spec requires each card to show** name, country, avatar, score, **rating**, **online status** and **activity
indicator** (original spec §10 and spec §6.8). Dir-C-Game leaves out the rating, the presence dot and the activity timer. They are
added above in C styling.

### 3.3 Activity indicator (opponent card, row 3; me via the lock strip §10)
| State | Visual | Source |
|---|---|---|
| Locking | Timer ring 14 dp (stroke 2, track `color.border`, arc `players[n].ring`, starts at 12 o'clock, drains linearly) plus "בוחרת · A8" | Text [C]. Ring [R1→C, spec §6.8 "עם טיימר"] |
| Thinking (no lock) | "חושבת…" `color.textMuted`. The ellipsis blinks at 1.2 s. Reduced motion: static. | [R1] |
| Paused (game frozen or under interference) | "מושהה · A8" `color.textMuted`, ring frozen | [R1] |
| Without a connection, soft phase (D42) | The activity stays as it is ("בוחרת · A8", "חושבת…"): the game goes on. **The icon-only pill replaces the interference button:** a round chip as high as the countdown pill (30; 24 on the compact card), background `color.bg`, 1 dp `color.status.unstable`, wifi-off icon 14 in `color.status.unstable`, no seconds. With the amber presence dot (§2) and no grey. The card's label adds "ללא חיבור" (mine too). Static: no pulse, so reduced motion changes nothing. | [new, Moshe 2026-10-15] |
| Reconnecting | "מתנתקת…" plus a countdown pill: height 30, radius 15, background `color.bg`, 1 dp `color.textMuted`, wifi-off icon 14, seconds Teko 600 20 `color.text`. **This pill replaces the interference button.** Only after the soft phase (D42). | [R1→C] |
| Left (abandoned) | Text "נטשה". The card goes to opacity .5 and the avatar to grayscale. | [R1→C] |
| Turn-based variant (D1 = turns) | "התור שלה" replaces "בוחרת" | spec §6.8 |

The gendered forms in the design ("בוחרת", "שלחה") need a grammatical-gender source. See §17.

### 3.4 Card states
| State | Visual |
|---|---|
| default | As drawn |
| leader | No change on the card in 2P. The lead is shown by the lead bar and its tag (§9) [C]. |
| correct move (any player) | The "+3.5" chip flies from the cell to the delta slot next to the score (key press t0: pops at t0+140, leaves at t0+440, lands at t0+800; `motion.md` §4.2). The score counts up over 650ms (t0+800 → t0+1450). The delta stays next to the score for 2400ms after landing, then fades (240ms). The 2400ms is an assumption; no board specifies it. |
| wrong move | No shake on the card (the cell already shook). The score turns `color.danger` and returns to the seat colour while it counts down (650ms). A "−6.5" chip (`color.bg`, `color.danger` text) flies from the cell to the delta slot. **Me:** the mistake text pops (scale .8 → 1), briefly turns `color.danger` (600ms) and then becomes e.g. "2 טעויות" (`motion.md` §4.3). |
| sent an interference | The score drops by the cost. "−8" floats in `color.textMuted` (a cost, not a penalty) [new] |
| under interference (others see it) | Hit chip at the avatar top-end: height 18, radius 9, `color.surface2`, 1 dp `color.border`, interference icon 12 plus seconds left Teko 600 14 `color.textMuted` [new, spec §7.4 "תג קטן על הכרטיס של מי שנפגע"] |
| target (the picker is open from this card, D45) | The card gets a container (radius 12, padding 6, background `color.surface`) with a 2 dp **solid** `color.accent` outline, and stays **above the scrim**. A "יעד" / "Target" chip sits on its bottom edge: height 20, radius 6, `color.accent` background, Rubik 700 12 `color.onAccent`. No march, no breathing, no hover state (there is no drag). Accessibility hint while targeted: the picker is open for this player. **Old (drag, replaced by two taps, D45):** the dashed marching outline, the hover fill and the "גרור לכאן" chip. |
| dimmed (not the target) | Opacity .4 (`opacity.dimmedCard`), under the scrim, not tappable [spec §7.3; round 1 used .38] |
| reconnecting / left / surrendered | See §3.3 |

### 3.5 VS badge [C]
36 × 24, `color.surface2`, 1 dp `color.border`, radius 6, `skewX(-8deg)`. "VS" in Teko 600 18, letter-spacing .04em,
`color.textMuted`, counter-skewed. `aria-hidden`.

### 3.6 Accessibility
- The card container is an accessible group whose label summarises it:
  - "MosheG · 55 נקודות · טעות אחת" [design]
  - "NinaVolt · 39.5 נקודות · בוחרת A8" [design]
  - Extended with the rating and connection state, e.g. "…, דירוג 1305, מחוברת"†.
- Mistakes, long form: "טעויות: אחת, הבאה עולה 2" [R1].
- Buttons inside the card stay separately focusable.

**Tokens:** `color.text`, `color.textMuted`, `color.accent`, `color.accentSubtle`, `color.onAccent`, `color.danger`,
`color.surface`, `color.surface2`, `color.border`, `color.players[n].ring`, `color.status.*`.

---

## 4. Country flag [C]
- System emoji (Apple or Noto Color Emoji), drawn as `<Text>`.
- Sizes: **18** Home profile · **15** 2P card · **13** compact card and lists · **12** sheet subtitle.
- In a compact card the flag sits on the avatar's bottom-start corner (−10, −5) [R1].
- **A11y:** never read the emoji. The label is the country name, e.g. "מדינה: ישראל" [R1]. Inside a card, the flag is decorative because the card label carries the information.
- **Names** come from the app's own tables (`apps/mobile/src/i18n/countries/<lang>.json`, generated from CLDR by `npm run countries:names -w @sudoku-fight/mobile`), never from the phone: Hermes has no `Intl.DisplayNames`.
- **Country picker** (Register-Fighter, Edit profile): a field like the name's ("🇮🇱 ישראל · שינוי ⌄"), and a sheet in its `fill` form (§13) with a search and every country: flag 22 and the full name (Rubik 500 16, up to two lines), sorted by the name in the app's language; the chosen row on `color.surface2` with a gold tick. The search matches as a phone keyboard types (`countrySearch.ts`): the Hebrew ׳ ״ as ' " or left out (צ'כיה, צכיה), Latin without accents (curacao, turkiye), "&" as "and", "St." as "saint", and a few other names people use (USA, UK, Turkey, Holland, אמריקה, אנגליה); an exact name or code comes first.
- No colour tokens.

---

## 5. Rating number and league badge

### 5.1 Rating number
- Teko 600, tabular, LTR, `color.accent`. There is **no star icon in C** (round 1's star is dropped).

| Size | Use | Source |
|---|---|---|
| 44 | Home: three columns, each with a Rubik 500 13 `color.textMuted` label above ("מהיר", "רגיל", "קשה") and 1×40 `color.border` dividers between them | [C] |
| 22 | Leaderboard row | [R1→C] |
| 16 | 2P card | [new] |
| 15 | Compact card | [R1→C] |

- **Provisional** (the first 10 games in a rating key, §11.2): a chip, min height 18, radius 9, 1 dp `color.border`, Rubik 500 11 `color.textMuted`, "זמני". In lists and cards it follows the number. **On Home (44) it sits under the number, centred**, and the number stays on one line, shrinking rather than being cut at the largest text sizes: beside it, the chip squeezed the numbers out of their third of the card (Moshe's device test, 14.10.2026).
- **A11y:** e.g. "דירוג רגיל 1287"†.
- Works unchanged with rating option A (9 ratings) or B (3 ratings). The key comes from `ratingKey()`.

### 5.2 League badge
| Variant | Visual | Source |
|---|---|---|
| `text` | "ליגת זהב · רמה 14", Rubik 400 14 `color.textMuted` | [C, Home] |
| `icon` | Flat hexagon 16×18 filled with `color.league.<tier>` (no gloss, no stroke), then the tier name in Rubik 500 12 `color.league.<tier>`, then "· רמה 14" in `color.textMuted` | [R1 `badge.league`→C] |

- Tiers (§11.3): ארד to 1099 · כסף 1100–1249 · זהב 1250–1399 · יהלום 1400–1599 · אגדה 1600+.
- The tier is the **highest** of the player's ratings (D9).
- The badge is hidden until 10 provisional games are done in some rating key.
- All five league colours pass as text: ≥6.1:1 on `color.surface` and ≥6.6:1 on `color.bg` (lowest: bronze `#d08a52`).

**Tokens:** `color.accent`, `color.textMuted`, `color.border`, `color.league.*`.

---

## 6. Avatar badges for leader and rank (3–4P) [R1→C]
2P has no crown in C. In 3–4P each compact card gets a **rank badge**: height 22, min-width 30, padding 0 6, radius 6, Teko 600 18
tabular, LTR "#1".
- **#1:** `color.accent` background, `color.onAccent` text.
- **#2–#4:** `color.surface2` background, 1 dp `color.border`, `color.text`.
- Round 1's medal gradients are dropped. Only the leader is highlighted.
- When the leader changes, the badges cross-fade with an 8 dp vertical slide over 240ms (spec §6.8, "החלפת מוביל באנימציה"). A light haptic plays only when **I** take the lead (`motion.md` §7).

---

## 7. Player card: compact, 3–4 players [R1→C, structure from Game-3P and Game-4P]

### 7.1 Placement
| Players | Card widths | Gap | Height |
|---|---|---|---|
| 3 | 114 · 114 · 114 | 8 | 160 |
| 4 | **106** (me) · 78 · 78 · 78 | 6 | 160 |

- One row, 358 wide. The order is **fixed by seat** and never re-sorted (spec §6.8, so interference targets never move). Me is first, at the start edge.

### 7.2 Anatomy (column, items centred, padding-top 7)
| Part | Spec |
|---|---|
| Container | Background `color.surface`, 1 dp `color.border`, radius 12. **No skew, gradient or glow** (round 1's tinted gradient is dropped). |
| Rank badge | §6. Absolute: top −10, start −6. |
| Avatar | 34 framed in `players[n].ring` (§2). Presence dot at bottom-end, flag 13 at bottom-start. |
| Name row (mt 5) | Glyph 7 in `players[n].ring` (● ▲ ■ ◆), gap 4, name Rubik 500 11 (`type.plateNameCompact`) `color.text` with ellipsis, horizontal padding 5 |
| Rating (mt 2) | Teko 600 15 `color.accent`, height 12 |
| Score (mt 2, h 24) | Teko 600 28 `players[n].ring` plus mistake pips: each pip has height 14, padding 0 3, radius 4, 1 dp `color.danger` at 70%, Teko 600 13 `color.danger`. Each pip is the real penalty of that mistake, as the engine charged it (`PlayerView.mistakePenalties`, spec §6.5: what the right digit was worth there, e.g. "−8", "−6.5"). Show the last 2 where they fit: a 3-player card (114 dp) without "×n". A 4-player card (78 dp, mine 106) shows the last one only, and so does any card with "×n" (half points make two pips about 100–111 dp next to the score; penalty design, decision 3). Five or more mistakes show "×n" first. Should they still not fit (a large system font), the pips shrink and the oldest is cut, never the score. The design boards (`screens/*.dc.html`) still show "−1" and "−2", sample values from the old 1, 2, 4, 8 ladder, which Moshe removed on 2026-10-15. Take the layout from them, not the numbers. |
| Activity (mt 3, h 16) | Timer ring 16 (stroke 2, track `color.border`, arc `players[n].ring`, seconds Teko 600 11 `color.text` inside), then "בוחר" Rubik 500 11 `color.textMuted`, then the cell name Teko 600 17 `color.text` |
| Action strip | Absolute: start 5, end 5, bottom 4, height 32. **Opponent:** the compact "הפרעה" button (§8.1) at full width (not in a game without interferences, D44). **Me:** [כניעה][תגובות], each flex 1, gap 4, transparent, 1 dp `color.border`, radius 8, icon 17 `color.textMuted`. `hitSlop` top and bottom 6, giving a 44 dp target. |

### 7.3 States
Same as §3.4, plus:
- **Surrendered** (3–4P, D36): opacity .5, avatar grayscale, the activity line replaced by "נכנע"†. Cells this player solved keep their colour.
- **Left** (D4): same treatment, with "נטש"†.
- **Gain float:** "+2.5" in Teko 600 22 `players[n].ring` rises from the score (reduced motion: no float).
- **Reaction float:** see §8.2.

### 7.4 Accessibility
- Group label example: "Aiko_M · מקום 1 · 39 נקודות · בוחרת D4"†.
- Interference button: "הפרעה ל־Aiko_M · 4 נק׳" [R1] (the price is in the label, not on the button). While the picker is open from this card: "סגירת חלון ההפרעות".

**Tokens:** as §3, plus `color.surface`.

---

## 8. Card actions

### 8.1 Interference button ("הפרעה" on each opponent card) [new, D45]
**Moshe's decision, 2026-10-17 (spec §6.8, §7.3, D45).** The old "⚡ + next cost" button (drawn on Game-2P, Game-Bot, Game-3P and
Game-4P) is replaced. Original §10: "אצל היריב: לחצן הפרעה". The tap on an opponent's own button is also the target choice (§17).
- **Anatomy:** an icon button in the reactions-button family (§1.4): the new `interfere` icon (an outline bolt with impact sparks,
  stroke 2, not filled) plus the word **"הפרעה"** / **"Interfere"**. **No price on the button.** The price is in the picker (§13)
  and in the accessibility label.
- Height **44** (as the reactions button), radius 12, padding 0 10, gap 6. Background `color.interfere.bg`, 1 dp
  `color.interfere.border` (P1 at 8% / 55%: **in my colour, because it is my action** [C]). Icon 20 `color.interfere.icon`, label
  Rubik 600 14 `color.interfere.label`, one line.
- **Compact (3–4P, §7.2 action strip):** height 32 plus `hitSlop` 6 (a 44 dp target), icon 16, label Rubik 600 12, one line,
  shrinking to fit (min scale .75) so "Interfere" fits the 68 dp strip of a 78 dp card.
- Every opponent card has its own button: 2P (the end of the status row) and 3–4P (each compact card). Never on my card.

| State | Visual | Label |
|---|---|---|
| available | As above | "הפרעה ל־NinaVolt · עלות 2 נק׳" |
| pressed | Background at 16% | — |
| expanded (picker open from this card) | Fill `players[0].ring`, icon and text `color.bg`, `expanded: true`. A tap closes the picker. | "סגירת חלון ההפרעות" |
| blocked: not enough points (D10), target under interference or in its 1 s immunity (D11), game not running | Opacity .5 (`opacity.inactivePlayer`), `accessibilityState.disabled`. **The tap still answers:** a short toast with the reason and a light haptic, and the picker does not open. Points: error toast "אין מספיק נקודות להפרעה הבאה (8 נק׳)". Busy: warning toast "NinaVolt כבר תחת הפרעה. אפשר שוב בעוד 2 שניות". Not running: info toast. | "הפרעה ל־NinaVolt · חסרות 3 נק׳"† / "…כבר תחת הפרעה"† |
| opponent reconnecting or soft-offline (D42), out | Hidden. The reconnect pill (or the unstable mark) takes the slot (§3.3). | — |
| solo practice, practice vs a bot (D44) | **Not rendered**: no interferences in a game against a known bot (spec §7.2). The bot card's status row holds only its activity line. | — |

Launching is **two taps** (D45): this button, then a kind in the picker (§13). There is no drag. D18 (an accessible alternative to
drag) is obsolete: both taps are the screen reader's normal "activate", so they work with TalkBack and VoiceOver.

### 8.2 Reaction button, picker and float
- **Button:** the icon button "תגובות" on my card (§1.4) [C].
- **Picker** [R1→C]: a popover anchored under my card (4 dp gap).
  - Row of 6 emoji buttons, 44×44 each, emoji at 26: 😂 😱 😎 🤦 🔥 👀.
  - Container: padding 4, gap 2, `color.surface`, 1 dp `color.border`, radius 16. A 14 dp arrow (rotated square, same fill and border) points at the button.
  - Opens with a pop (200ms, `pop` spring, emoji staggered 40ms; `motion.md` `reactions.strip`). Closes on selection or an outside tap (120ms). `role=group`, label "תגובות".
  - Each emoji's label: "תגובה: צחוק / בהלה / קול / פספוס / אש / עיניים" [R1].
- **Rate limit** (D19, from `rules`): after sending, the button is disabled for 2 s at opacity .5.
- **Float:** the emoji at 36 rises 74 dp from the sender's avatar with a small wiggle, over 1.6 s (`sf-react`). At most 3 on screen. It never covers the board. Reduced motion: fade in at the card, hold, fade out.
- **Mute an opponent** is "via the opponent card's menu" (spec §8). **No board shows that menu.** See §17.

### 8.3 Surrender button
- The icon button "כניעה" on my card, flag icon, `color.textMuted` [C]. Round 1's red icon is dropped.
- In practice the label is "סיום אימון" (spec §6.6).
- Opens the modal in §14.

---

## 9. Score lead bar [C 2P · R1→C 3–4P]

### 9.1 Two players
- Top 224, 358 × **4**, gap 2, radius 2 per segment [C].
- Two segments in `players[n].ring`. **Segment order follows the cards**: my segment is under my card (right in Hebrew, left in English).
  - In the C board the bar is `dir=ltr` with the opponent on the left, which matches Hebrew.
- Width of each segment = max(0, score) ÷ the sum of the clamped scores, kept between 6% and 94% (negative scores are allowed, D15) [R1]. 0 : 0 splits 50/50.
- **Lead tag** [R1→C, required by spec §6.8 "סימון ברור של המוביל"]:
  - Centred on the split point, 3 dp under the bar, kept at least 24 dp from either edge.
  - Height 15, padding 0 5, radius 4, background `color.bg`, 1 dp border, label "+15.5" in Teko 600 15. Border and text use the leader's `players[n].ring`.
  - On a tie: "שוויון" in Rubik 500 11 `color.textMuted` with a `color.border` border.
- **Motion:** segment widths and the tag position animate over 650ms (standard easing). When the leader changes, the tag colour cross-fades over 240ms. A light haptic plays only when **I** take the lead (`motion.md` §7).
- **A11y:** `role=img`, label "MosheG מוביל ב־15.5 נקודות" [design]. Announce leader changes through the live region (§11.6).

### 9.2 Three to four players
- Same 358 × 4 bar. Segments are ordered **by place** (1st at the start) [R1], gap 2, coloured `players[n].ring`.
- The lead tag shows the gap between 1st and 2nd ("+2.5") and **the leader's glyph (6 dp)** before the number, so the tag does not rely on colour alone.
- **A11y:** "Aiko_M מובילה ב־2.5 נקודות"†. The full ranking is in each card's label.

**Tokens:** `color.players[n].ring`, `color.bg`, `color.border`, `color.textMuted`.

---

## 10. Lock timer strip ("המשבצת שלך F8 · 7 שניות") [C]
**Placement (2P):** top 248, start 16, end 16, height 24. Space-between with gap 12.

| Part | Spec |
|---|---|
| Text group (start) | Baseline-aligned, gap 6, single line: "המשבצת שלך" Rubik 500 15 `color.textMuted` · "F8" Teko 600 24 `players[0].ring` (LTR) · "·" Rubik 500 15 `color.iconFaint` (`aria-hidden`) · "7 שניות" Rubik 500 15 `color.text` (plural rules: "שנייה אחת"†) |
| Progress (end) | 96 × 4, radius 2, track `color.surface2`, fill `players[0].ring`. Fill width = remaining ÷ lock length (8, 12 or 18 from `rules`). Fills from the **start** edge. Drains linearly, 1 s steps animated. |

| State | Visual |
|---|---|
| no lock | The text group shows a target icon 16 plus "בחר משבצת" Rubik 500 15 `color.textMuted`. The bar is hidden [R1→C, round 1's gold chip is calmed]. |
| nudge (a disabled key was pressed) | The "בחר משבצת" group shakes once (300ms) and a light haptic plays [R1] |
| locked | As drawn |
| urgent (≤ 3 s) | The seconds text, the bar fill (`color.progress.timerWarning`) and the cell's seconds pill switch to `color.accent` (pill text `color.onAccent`). The seconds text and the pill blink opacity 1 ↔ .35 on a 1 s loop, as round 1 did ("זהב מהבהב"; `motion.md` `lock.urgent`). Reduced motion: gold without the blink. The ring stays P1. Haptic tick once per second. Gold rather than red, because a timeout has no penalty (D2) and red means penalty. |
| paused (I am under interference, or the game is frozen) | Text "המשבצת שלך F8 · מושהה"†, a pause icon, the bar fill turns `color.textMuted` and freezes |
| released | The strip cross-fades back to "no lock" over 240ms |

- **3–4P:** the same component. Where the screen places it (above the board, or next to the release button as in Game-4P) is a stage-10 layout decision.
- **A11y:**
  - The bar: `accessibilityRole="progressbar"`, label "זמן שנותר למשבצת F8" [design], `accessibilityValue {min:0, max:12, now:7}`.
  - The whole strip is one group, e.g. "המשבצת שלך F8, נותרו 7 שניות"†.
  - **Do not announce every second.** Announce on lock, at 3 s, and on release.

**Tokens:** `color.textMuted`, `color.iconFaint`, `color.text`, `color.progress.timerTrack` (= `color.surface2`), `color.players[0].ring`, `color.accent`, `color.onAccent`.

---

## 11. Board and cells

### 11.1 Geometry [C]
| Property | Value |
|---|---|
| Frame | Top 288, x 16, **358 × 358**, `direction: 'ltr'` |
| Container | 3 × 3 boxes, **gap 3**, background `color.board.boxGap` (= `color.bg`), radius 12, `overflow: hidden` (this rounds the outer corners of the corner boxes) |
| Box | 3 × 3 cells, **gap 1**, background `color.board.grid` |
| Cell size | ((W − 6) ÷ 3 − 2) ÷ 3 = **38.4** at W = 358 |
| Digit | Rubik **22**, roughly 0.57 × the cell size when scaled |
| Checkerboard | Boxes 1, 3, 5, 7 use `cellAlt`. Boxes 0, 2, 4, 6, 8 use `cell`. |
| No shadow or frame | Round 1's 16-radius frame and drop shadow are dropped |

- **Scaling:** W = min(screen width − 32, height available after the cards, strip and keypad). Every inner value scales with the cell size. Corner offsets stay in whole dp.
- **Coordinate rails** (A–I down the side, 1–9 across the top; Rubik 600 10 `color.textMuted`, the active row and column in `players[0].ring`) existed in round 1 and are **not drawn in C**. Ship them as an optional `showCoordinates` prop, off by default. See §17.

### 11.2 Fixed corners inside a cell [R1, kept in C]
Top-start (top-left, the board is LTR) **owner glyph** · top-end **lock seconds pill** · bottom-end **wrong digits** · centre
**digit or mini avatar**. These positions never move, so cues never collide.

### 11.3 Cell states
| # | State | Background | Content | Extras | Source |
|---|---|---|---|---|---|
| 1 | **Empty** | `cell` / `cellAlt` | — | — | [C] |
| 2 | **Given** | `cell` / `cellAlt` | Digit Rubik **600** `color.board.given` (`type.digitCell`; C asks for 600, and `tokens.json` loads Rubik 600 so it is not faked) | Not tappable | [C] |
| 3 | **Solved by me** | `players[0].tint` | Digit Rubik **500** `players[0].digit` | **Glyph ● 6 dp** at top-start (3, 3) in `players[0].glyph` (= digit; `size.solverGlyph`) | Colours [C]. Glyph [R1→C]: C leaves out shapes, which CLAUDE.md requires. |
| 4 | **Solved by opponent n** | `players[n].tint` | Digit Rubik 500 `players[n].digit` | Glyph ▲ ■ ◆ 6 dp in `players[n].glyph` (paths: `players[n].shapePath`) | Same as #3 |
| 5 | **My lock** | `players[0].tint` | — | **Ring:** inset 3 dp `players[0].ring`, plus **[new]** a 1 dp inner edge in `players[0].lockEdge` (the bright ring alone is 1.7:1 on the tint; the edge gives 5.3:1, WCAG 1.4.11). **Pulse:** a second inset band from 3 to 7 dp in `players[0].lockPulse` (ring at 28%), fading in and out over 1.6 s ease-in-out, infinite (`sf-lock`). **Seconds pill** at top-end (3, 3): min-width 16, height 16, padding 0 4, radius 8, `players[0].ring` background, Teko 600 15 `players[0].onRing` (urgent: `color.accent` / `color.onAccent`). | [C], edge [new] |
| 6 | **Opponent lock** | `cell` / `cellAlt` (unchanged, no stripes: C has no textures) | **Mini avatar 22**, radius 7, centred | Ring inset 3 dp `players[n].ring`, plus **[new]** the 1 dp `players[n].lockEdge` inner edge (rings alone are 1.3–3.0:1 on the light cells). No pulse and no visible seconds (C keeps the board calm). The seconds are in the label. | Ring and avatar [C] (spec §6.2.8: ring + small avatar), edge [new] |
| 7 | **Wrong digits** (overlay on any state) | — | — | At bottom-end (right 3, bottom 2): Rubik 700 **11** `color.board.wrongDigit`. Several are separated by a space. Show the last 3. **They stay after the cell is solved**, and every player sees them (§6.5). | [C] position, colour token [new] |
| 8 | **Peer of my lock** | — | — | **Not used in V1.** C draws no row, column or box highlight, and `color.board.peer` is `null` (round 1's peer tint was too close to the P4 tint). If approved later, a C-neutral `#dfe3ec`. | — |
| 9 | **Lock pending** (tap sent, server not yet confirmed) | `cell` / `cellAlt` (no tint yet) | — | Ring at 50% opacity, no pill, no pulse. If rejected, behaves like #11. Gives feedback within 140ms despite latency (`motion.md` `cell.pending`). | [new] |
| 10 | **Lock paused** (my interference, game freeze) | as #5 | — | The pulse stops. The pill shows a pause glyph (two 2 × 7 bars). The opponent lock keeps its look. | [R1→C] |
| 11 | **Taken** (tap on an opponent's lock) | as #6 | — | Shake 300ms plus a short haptic (`impact(Medium)`, `motion.md` §7). No penalty (§6.2.3). Announced as "תפוסה". | [R1] |
| 12 | **Correct (transient)** | Settles to #3 or #4 | Digit pop 420ms (`pop` spring) | Tint flash: `players[n].ring` at 60% (`opacity.correctFlash`) fading to 0 over 700ms. A "+3.5" chip (`color.bg`, radius 8, Teko 600 22 in `players[n].ring`; a bare ring colour on the light board would be 1.8:1) pops above the cell and flies to the card (§3.4). | [R1→C] |
| 13 | **Wrong (transient)** | unchanged | The digit appears in `color.board.wrongDigit` | Flash: `color.danger` at 55% fading to 0 over 550ms, plus shake 300ms. A "−6.5" chip (`color.bg`, `color.danger` text; the penalty, spec §6.5) flies to the card. The digit then becomes a small wrong mark (#7), and the cell is **released to everyone** (D3). | [R1→C] |
| 14 | **Queued offline** (my digit entered while my connection is lost, waiting to be sent and judged; spec §16.2, D42) | `cell` / `cellAlt` (no tint: nothing is mine yet) | Digit Rubik 500 `players[0].digit` | The pending ring of #9 (`players[0].ring` at 50%, no edge, no pill, no pulse), and a **wifi-off icon** at top-end (3, 3), `size.solverGlyph` (6 dp scaled), in `players[0].glyph`. Not tappable. **Static**: it appears with the ring's normal fade-in, and under reduced motion at once. On the server's answer it becomes #12 then #3, or #13; a move that did not count shakes like #11 and shows a short warning toast ("D5 נתפסה בזמן שלא היה לך חיבור · בלי קנס"). Label: "D5, 7, ממתין לחיבור". Precedence: filled > queued > lock > pending > empty. | [new, Moshe 2026-10-15] |

**"Cell under interference":** there is no per-cell interference state in V1. The interference is a full-screen overlay until D35 is
approved. What it changes on the board is the **paused lock** (#10) for the victim (§6.2.7).

**Interaction:**
- Tap an empty, unlocked cell → lock it (#9, then #5).
- Tap my own lock → nothing.
- Tap a given or solved cell → nothing.
- Within 1 s after a release, re-locking the same cell is refused (D2): treat it like #11 without the word "תפוסה".

**Implementation notes:**
- RN has no inset box-shadow. Draw the ring, the 1 dp edge and the pulse band as absolutely positioned bordered Views.
- Animate with Reanimated 4, honouring `ReduceMotion.System`. Reduced motion: no pulse, no pop, static flash frames.

### 11.4 Corner collisions
When an opponent-locked cell also has wrong digits, shift the mini avatar up 3 dp so it clears the bottom-end digits.

### 11.5 Accessibility labels for a cell
Each cell is a button inside a container with `accessibilityRole="grid"`. Label pattern:
`{cell}, {content}, {state}[, {owner}][, {seconds}][, {wrong digits}]`.

| State | Label |
|---|---|
| Opponent lock | **"D5, ריקה, נעולה על ידי NinaVolt, 4 שניות"** [work plan §3] |
| Empty | "D5, ריקה"† |
| Given | "D5, 4, רמז"† |
| Solved by me | "D5, 6, נפתרה על ידיך"† |
| Solved by opponent | "D5, 7, נפתרה על ידי NinaVolt"† |
| My lock | "F8, ריקה, נעולה אצלך, 7 שניות"†, hint "בחר ספרה במקלדת"† |
| Lock paused | "F8, ריקה, נעולה אצלך, הטיימר עצור"† |
| Wrong digits suffix | "…, טעויות במשבצת: 5, 3"† |

- **Board container label:** "לוח המשחק · המשבצת שלך F8 · NinaVolt תופסת A8" [design].

### 11.6 Live region [new]
C removed round 1's visible event log ("I1 +3.5"). Keep an **invisible** live region (Android `accessibilityLiveRegion="polite"`,
iOS `announceForAccessibility`) that announces opponent moves and leader changes. Throttle it to at most one announcement per
1.5 s and merge bursts. Example: "NinaVolt פתרה את A8, ‎+3.5"†.

**Tokens:** `color.board.*`, `color.players[n].ring/tint/digit/glyph/onRing/lockEdge/lockPulse`, `color.bg`, `color.accent`, `color.onAccent`, `color.danger`.

---

## 12. Keypad [C] (with the cancel button)

### 12.1 Digit row
| Property | Value |
|---|---|
| Frame | Top 666, x 16, 358 × **60**, `direction: 'ltr'`, gap 4 |
| Key | 9 keys at flex 1 (about 36.2 wide), height 60, background `color.surface2`, border 1 dp `players[0].ring` at 50%, radius 10, column with gap 5 |
| Digit | Teko 600 **32**, line-height .8, padding-top 4, `color.text` |
| Remaining count | Rubik 500 12 `color.textMuted`. It is 9 minus the occurrences on the board (givens plus solved, **not** wrong marks). |
| Order | Always 1–9 from left to right, in both languages. The one exception: during a `keypad` hit on me (D47, 5 s) the keys change places; each key keeps its own digit, count and state (§15.4) |

| State | Visual | Label |
|---|---|---|
| armed (I hold a lock) | As above | "ספרה 5 · נותרו 3" [design] |
| pressed | Background `color.keypad.keyPressedBg` (`#2a3140`), border `color.keypad.keyPressedBorder` (P1 at 100%), `translateY(3)` (`elevation.keyPressed`) for 80ms. No press haptic: the result haptic follows within about 150ms (`motion.md` §7). | — |
| idle (no lock) | The whole row at opacity .55, borders `color.border`, `disabled`. A tap nudges the lock strip (§10). | "ספרה 5, נשארו 3, קודם בוחרים משבצת" [R1] |
| complete digit (0 left) | Opacity .3, count "0", `disabled` | "ספרה 6, נשארו 0" [R1] |
| **tried wrongly in this cell** (D12, disabled for **every** player for this cell) | Opacity .55. The digit is drawn in `color.danger` with a 1.5 dp strike line in `color.danger`. The count is unchanged. `disabled`. Complete-digit styling wins if both apply. | "ספרה 5 · כבר נוסתה במשבצת הזו"† [new; no board draws this state] |

### 12.2 Cancel selection ("ביטול בחירה") [C]
- A ghost button (§1.3) centred under the keypad: top 742, height 44, padding 0 16, gap 8.
- Release icon 20 (rounded square with ×). Label Rubik 500 15 `color.textMuted`.
- **Enabled only while I hold a lock.** Otherwise opacity .4 and `disabled`.
- Tap → release (§6.2.5), a selection haptic (`motion.md` §7), and the cell fades back over 240ms.
- Label "ביטול בחירה, F8"† (round 1 showed the cell name as a chip; C keeps it out of view, but the label includes it).
- There is no "delete" key in V1 (§6.3).

**Tokens:** `color.keypad.*`, `color.border`, `color.text`, `color.textMuted`, `color.danger`, `color.players[0].ring`.

---

## 13. Drawer / bottom sheet, and the interference picker [R1→C; the picker: new, D45]

> **Arsenal.dc.html and Interference-Target.dc.html: ישן: גרירה — הוחלף בשתי הקשות (D45).** Both boards still draw the drag
> tray (big tokens, the "גרור אל…" hint, the drag ghost, the dashed drop zone). Until they are redrawn, this section, §3.4 ("target")
> and §8.1 win. Interference-Drag.dc.html was deleted on 2026-10-18. Moshe's decision of 2026-10-17 (spec §7.3) replaces the drag
> of original §16 by two taps: the "הפרעה" button on an opponent's card (§8.1), then a kind in this picker.

**Anatomy:** scrim › sheet (handle, header, content). In the interference picker the target card stays above the scrim, framed
(§3.4 "target"), and the scrim has a hole over it.

| Part | Spec |
|---|---|
| Scrim | Full screen, `color.scrim` (`rgba(7,9,12,.72)`). Tap → close. Picker label "סגירת חלון ההפרעות וחזרה ללוח"†. Fade 240ms. Other cards under it can't be tapped. |
| Sheet | Full width, bottom 0, radius **24** on the top corners (the Foundations token said 28, but every sheet drawn uses 24), background `color.surface`, top border 1 dp `color.border`, padding 10 16 (16 + bottom safe area), max height 85%. No glow or gradient. `fill`: always 85% high, the content filling it (a long scrolling list: the country and avatar pickers). |
| Handle | 40 × 4, radius 2, `color.border`, centred, `aria-hidden`. Dragging down past 25% of the height (or a fast fling) closes the sheet. This pull-to-close is the only gesture left in the picker. |
| Header (mt 8, h 48) | Title Rubik 700 22 `color.text`: "בחר הפרעה"†. A close icon button 44 at the end ("סגירה"). **Target line**, Rubik 500 13 `color.textMuted`. **2P:** "יעד:", a mini avatar 18 (radius 5, 1.5 dp ring in the target's `players[n].ring`), the seat glyph (▲ ■ ◆), the name in Rubik 500 `color.text`, and a flag at 12. **3–4P:** the route "[my avatar, ●] אני ← [their avatar, ▲] Biscuit", both rings in seat colours with their glyphs; one accessibility element, "הפרעה ממני אל Biscuit"†. The target never changes inside the sheet (spec §17). |
| Price row (mt 10, h 48) | `color.surface2`, 1 dp `color.border`, radius 12; one accessibility element. Start: "מחיר" (muted) and the price "‎−2 נק׳" (the number in Teko 600 30 `color.accent`, through `signedText()`, so the minus never jumps in Hebrew), then muted "· הבאה: 4". End: "הניקוד שלך" and the score before and after the launch ("53 ← 51" in Hebrew, "53 → 51" in English) in Teko 600 22 `players[0].ring`, through `scoreText()`. Short of points: the end says "חסרות 3 נק׳". Target busy: "NinaVolt כבר תחת הפרעה · 2 שנ׳". |
| Grid (mt 12) | **3 columns × 2 rows**, gap 8, flex-wrap; the reading order follows the app direction. Column width = (window − 32 − 2 × 8) / 3: 104 at 360, 114 at 390. Order: `INTERFERENCE_KINDS` (זיקוקים, חתולים, עיוות, מספרים מתערבלים, דיו, מקלדת מתערבלת). Only the kinds in `view.rules.interferenceKinds` are shown (spec §7.2, D47); the rest are hidden, not locked. **No "בקרוב" row** in the game: future kinds stay on the Interferences collection screen. |
| Kind button | A plain Pressable (no gesture). Height 100, radius 16, `color.surface2`, 1 dp `color.border`, padding-top 8. Preview art 40 (the §16 "Preview": a live loop; still under reduced motion, or when locked or blocked). Name Rubik 600 13/16, centred, up to 2 lines ("מספרים / מתערבלים"). Price chip: mt 6, h 22, radius 11, `color.bg`, one text "‎−2 נק׳" with the number in Teko 600 17 `color.accent` and the unit in Rubik 500 11. Pressed: border `color.accent`, background `color.accentSubtle`, scale .96 (`press` spring; no scale under reduced motion). |
| Locked kind (D17) | Stays in its place, opacity .5, still art, the chip shows a lock and "רמה 3" in `color.textMuted`. A tap explains ("נפתחת ברמה 3"†) and never launches. |
| Blocked kind | Opacity .5; the chip shows "חסרות 3 נק׳" or "תחת הפרעה". A tap explains (a 2 s bubble, announced, cue `nudge`) and never launches. |
| Info line (mt 10) | Rubik 500 12 `color.textMuted`, centred: "כל הפרעה נמשכת 5 שניות · הקשה משגרת"†. |

- **No scrolling** (Moshe: all kinds visible at once): 14 (handle) + 56 (header) + 58 (price) + 12 + 2 × 100 + 8 (grid) + 26 (info)
  + 16 + bottom inset ≈ 390 dp + inset. At a 48 dp inset that is 438 dp, under 85% of a 780 dp screen (663) and of a 640 dp screen
  (544). The layout is a pure function of width, height, inset and the number of kinds, with a Jest test for 360×780 and 360×640.
- **Launch (the second tap, D45):**
  - Taps in the first **250 ms** after the sheet opens are ignored, silently (`ARSENAL_CONFIG`, a setting). A fast double tap on
    "הפרעה" therefore never launches.
  - A launchable kind launches at once, with no confirm: one launch per opening (a second tap before the answer sends nothing), the
    launch cue (sound and haptic), the announcement "שיגרת זיקוקים אל NinaVolt"†, `host.interfere(target, kind)`, the sheet closes
    in 200 ms, and a ripple runs on the target card (full motion only).
  - The sender toast "זיקוקים ← NinaVolt" and the cost on my card come from the host's confirmation, as before.
  - Refused by the server after the sheet closed (the target just turned busy, the score changed): a warning toast "ההפרעה לא
    נשלחה, ולא ירדו לך נקודות"†.
- **3–4 players (spec §17, never the wrong target):** the target is set only by the tap on that opponent's own button. There is no
  default and no target row in the sheet. The target card is framed above the scrim, the others dimmed under it. To hit someone
  else: close the sheet and tap their "הפרעה". If the target goes out or disconnects, or the game ends, the sheet closes by itself.
- **Motion:** enter `translateY(100% → 0)` with standard easing: 240ms for the interference picker (round 1 "מגש הארסנל עולה",
  `motion.duration.trayRise`), 320ms for other sheets (`sheetIn`). Exit 240ms (200ms after a launch). Reduced motion: 200ms fade.
- **A11y:**
  - `accessibilityViewIsModal`, role dialog, label "חלון ההפרעות"†. Initial focus on the title. The picker is an overlay, not an
    RN `Modal` (no native window), so it never holds up the move to the results.
  - Android back and the iOS escape gesture close it.
  - Each kind's label names the kind, the price and the target: "זיקוקים · 2 נק׳ · הקשה משגרת אל NinaVolt"†; a locked or blocked
    kind says why. Activating it launches; there is no long-press alternative (D18 is obsolete).
- **RTL:** header and content mirror. The numbers are LTR isolates. The grid follows the app direction (it is not the keypad).

**Old (drag, replaced by two taps, D45; kept here only to read the old boards):** a next-cost row of 60 dp with "שיגור בגרירה
בלבד", tokens of 108 × 136, a separate row of locked tokens (76 dp) with "רמה 18" chips, the hint pill "גרור אל הכרטיס של NinaVolt
כדי לשגר", the drag ghost (lift 1.08, `token.lift`), the cancel spring (`launch.cancel`), and the tap bubble "גרור אל NinaVolt,
הקשה לא משגרת". None of these is built any more.

**Tokens:** `color.scrim`, `color.surface`, `color.surface2`, `color.border`, `color.text`, `color.textMuted`, `color.iconFaint`,
`color.accent`, `color.accentSubtle`, `color.onAccent`, `color.bg`, `color.players[n].ring`.

---

## 14. Modal (from Surrender) [R1→C]
There are two shells with the same content model: icon, title, body, actions, and an optional footnote.

### 14.1 In-game confirm (bottom-anchored, the board stays visible above it)
| Part | Spec |
|---|---|
| Scrim | `color.scrim`. Tap = "ביטול". No blur (C drops round 1's blur and red radial). |
| Panel | Full width, bottom 0, radius 24 on the top corners, `color.surface`, top border 1 dp `color.border`, padding 24 24 (26 + safe area), centred column. Round 1's 150 dp flag illustration and halftone are dropped. |
| Icon | 40 dp circle, `color.danger` at 15%, 1 dp `color.danger` border, flag icon 18 `color.danger` [R1 `sheet.confirm`] |
| Chip (optional) | "כניעה": h 24, radius 12, 1 dp `color.danger` at 60%, Rubik 700 11 `color.danger` |
| Title | Rubik 700 **22**/1.25 `color.text`, balanced wrap: **"אתה בטוח שאתה רוצה להיכנע?"** (spec §6.6) |
| Body | Rubik 400 15/1.45 `color.textMuted`: "המשחק ייחשב כהפסד · שינוי דירוג משוער −15", with "−15" in Teko 600 21 `color.danger` [R1] |
| Score summary (optional) | Mini 2P summary: avatars 36, scores Teko 600 28 in the ring colours, a 6 dp lead bar. Background `color.surface2`, radius 12. No skew. |
| Actions (mt 24, gap 12) | **"ביטול"**: primary `lg` (60), flex 1.4, skewed gold. It is the prominent and safe choice (§6.6). **"כן, להיכנע"**: danger `lg` (60), flex 1 (§1.5). |
| Footnote | Rubik 500 12 `color.textMuted`: "המשחק ממשיך ברקע", with a static 7 dp `color.danger` dot (round 1 blinked; C does not). The lock timer is **not** paused (§6.2.7). |

**Variants:**
- **Practice:** title "לסיים את האימון?", buttons "כן, לסיים" and "ביטול" (§6.6).
- **3–4P** (D36): body copy TBD. The player leaves the game, and their solved cells keep their colour.
- **No rating lost** (2P, the leave guards of spec §11.2, Moshe 2026-10-15): when a surrender now costs no rating (I have not placed a digit yet, or I am not behind), the Body is one plain line in the same Rubik 400 15/1.45 `color.textMuted`, with **no Teko number**: "המשחק ייחשב כהפסד · הדירוג שלך לא ירד, כי עוד לא ביצעת מהלך" / "…, כי אין לך פיגור". 3–4P with nobody still in ahead of me: the 3–4P body plus "הדירוג שלך לא ירד מול אף שחקן שנשאר במשחק."

### 14.2 Centred dialog (outside a game, e.g. "אין חיבור לאינטרנט")
- Width min(342, screen − 48), padding 20, radius 20, `color.surface`, 1 dp `color.border`, column gap 8.
- Header row: icon circle 40, then the title in Rubik 700 18.
- Body: Rubik 400 14/1.45 `color.textMuted`.
- Actions row, gap 12: primary `modal` (48) at flex 1.5 ("עבור לאימון") and secondary `modal` at flex 1 ("נסה שוב") [R1 `modal.confirm`].
- Enter: fade plus scale .96 → 1 over 240ms. Reduced motion: fade.

**A11y (both):** `accessibilityViewIsModal`, `role=dialog` label "אישור כניעה" [R1]. **Initial focus goes to the safe action
("ביטול").** Android back = the safe action. The title is a header.

**Tokens:** `color.scrim`, `color.surface`, `color.surface2`, `color.border`, `color.text`, `color.textMuted`, `color.danger`,
`color.accent`, `color.onAccent`, `color.accentShadow`.

---

## 15. Toast and interference banner [R1→C]

### 15.1 Toast
| Property | Value |
|---|---|
| Position | Top, under the safe area plus 8, inset 16 on both sides. It **never covers the board**, only the card area. One toast at a time, queued. |
| Box | Height 40 (`size.toast`; not tappable), padding 0 12, gap 10, `color.toast.bg`, 1 dp `color.toast.border.<variant>`, radius 12. **No skew and no shadow** (round 1 was skewed). |
| Icon | 24 dp circle filled with `color.iconBg.<semantic>` (16%), glyph 14 in the semantic colour (≥3.9:1 on the circle) |
| Text | Rubik 500 14 `color.text`, one line with ellipsis. Inline cell names in Teko 600 17. |
| Motion | Enter: slide down 12 dp plus fade, 240ms. Exit: fade 240ms. Reduced motion: fade only (`motion.md` `toast`). |

| Variant | Border / icon colour | Role | Default duration (assumed, not on any board) | Example [R1] |
|---|---|---|---|---|
| success | `color.success` | status | 2.5 s | "חזרת למשחק. הלוח והניקוד סונכרנו" |
| warning | `color.accent` | status | While the condition lasts, max 3 s | "עוד 3 שניות והמשבצת F8 משתחררת" |
| error | `color.danger` | alert | 4 s | "אין מספיק נקודות להפרעה הבאה (8 נק׳)" |
| connection | `color.textMuted` | status | Until resolved | "היריב מתנתק…" plus a countdown pill (h 26, radius 13, `color.bg`, 1 dp `color.textMuted`, Teko 600 18) |
| info (sender) | border `color.toast.border.info` (= `color.border`), icon `color.toast.iconInfo` (= `color.textMuted`; an icon in the border colour would be 1.2:1) | status | 2 s (`motion.md` `sender.toast`) | "זיקוקים ← NinaVolt" (spec §7.4) |

### 15.2 Interference banner (shown to the victim)
- Same placement, **height 52**, 1 dp `color.accent`, `color.surface2`, radius 12. Drawn above the interference overlay.
- **Content:**
  - Sender avatar 34 framed in the sender's `players[n].ring`.
  - Title "NinaVolt שלחה לך זיקוקים!" in Rubik 700 16 `color.text`, with ellipsis.
  - Subtitle "זה עלה לה 2 נק׳ · המשחק ממשיך" in Rubik 400 12 `color.textMuted`.
  - Countdown ring 38 (stroke 3, track `color.border`, arc `color.accent`, draining over 5 s, linear) with the seconds in Teko 600 22 `color.accent`.
- **Motion:** round 1's slam becomes a drop-in: 16 dp with the `settle` spring (about 300ms), out 240ms (`motion.md` `hit.banner`). Reduced motion: fade.
- **A11y:** `role=alert`. The timer's label is "נותרו 3 שניות" [R1], announced only when the banner appears. The announcement also
  says the board is dimmed (§15.3) and that my lock timer is stopped.
- **A kind this app does not know** (sent by a newer app, D47): a generic title "NinaVolt שלח/ה לך הפרעה!"†, the dim of §15.3, no
  effect, no rumble. Never a crash or a raw i18n key.

### 15.3 Board dim during a hit [new, D46]
Moshe's request of 2026-10-17 (spec §7.2): every hit darkens the victim's board.
- A layer of `color.scrim` (`#07090c`) at **60%** opacity (`HIT_DIM` in `apps/mobile/src/components/interference/config.ts`), the
  **same for every kind**, over the **board only**: inside the board slot, under the kind's effect and the banner. It follows the
  board's radius, and warp tilts it with the board. The keypad and the cards stay bright, so play goes on.
- **Timing:** from the hit's own clock: fade in 240 ms, hold, and gone exactly at `endsAt`. Frozen while the game is frozen. It
  never pulses.
- **Readability (tokens):** given digits about 3.5:1 and P1 digits about 2.4:1 on their cells under the dim: readable with effort.
  A Jest test keeps every digit colour at 2:1 or more under the dim.
- **Reduced motion:** the same dim, static, with a 200 ms fade (opacity only).
- **Who sees it:** only the victim. The sender and third players see the small hit chip on the victim's card (§3.4).
- **A11y:** the layer is hidden from the screen reader; the banner announces the dim (§15.2).

### 15.4 The new kinds (D47): scramble, ink, keypad [new]
Three kinds Moshe asked for on 2026-10-17 (spec §7.1). No board draws them. Same 5 s, same cost, same banner and dim. Each is
seeded from the game and the interference event's `seq` (deterministic, no `Math.random()`), and none changes what a tap or a key
enters.

| Kind | What the victim sees | Reduced motion | Preview art (40 dp, picker) |
|---|---|---|---|
| `scramble` "מספרים מתערבלים" | Every filled cell (given or solved; not queued, not wrong marks) shows rolling fake digits in the **sender's** ring colour, so they read as fake. At each step about 30% of the cells show their real digit. At most 2.5 changes per second. Visual only: taps go through to the cell, and cell labels keep the real values. | A static "?" in every filled cell for the 5 s. | A 2 × 2 mini grid whose digits swap |
| `ink` "דיו" | About 5 dark blots (a thin rim in the sender's colour) cover about 40% of the board; they splat in 300 ms, hold, and fade over the last 1.5 s. | The same blots, still; gone at the end. | A blot that splats and fades |
| `keypad` "מקלדת מתערבלת" | The nine digit keys swap places every 1.5 s, sliding in about 200 ms. Each key always shows (and enters) its own digit, with its count and its disabled state. "ביטול בחירה" stays put. A key never moves under a finger (a shuffle waits for the release), and a press during a move (and shortly after) is ignored with the nudge, never sent. Back to 1–9 at the end. | One shuffle for the whole 5 s, with a fade. | Keys that swap |

- The keypad grid itself stays LTR (§0.6); only the order of its keys changes, for 5 s.
- Haptics and sounds per kind: `motion.md` §7–§8.

**Tokens:** `color.toast.*`, `color.iconBg.*`, `color.surface2`, `color.text`, `color.textMuted`, `color.success`, `color.accent`, `color.danger`, `color.border`, `color.bg`, `color.scrim`, `color.players[n].ring`.

---

## 16. Bottom navigation (from Dir-C-Home) [C]
| Property | Value |
|---|---|
| Frame | Bottom 0, full width, height **84** = 64 content + bottom safe area (C draws 20, so use the real inset), padding 0 8, background `color.bg`, top border 1 dp `color.border` |
| Items | 4 at flex 1, column, gap 6, centred: icon 24 (stroke 2) and label Rubik 500 13 single line |
| Order (start → end) | "בית" · "טבלת מובילים" · "היסטוריה" · "הישגים". In Hebrew "בית" is rightmost, and the row mirrors automatically. |
| Active | Icon and label `color.accent`. Round 1's 18 × 3 underline is dropped. |
| Inactive | `color.textMuted` |
| Pressed | Label and icon `color.text` for the tap duration |
| Where | Home-level screens only [R1]. Never during a game. |

- **A11y:** container `accessibilityRole="tablist"`, label "ניווט ראשי" [design]. Each item is a `tab` with `selected` (C uses `aria-current="page"`). Each target is about 93 × 64.

**Tokens:** `color.bg`, `color.border`, `color.accent`, `color.textMuted`, `color.text`.

---

## 17. Open points for Moshe (nothing here changes the original spec until approved)
1. **Touch targets below 44.**
   - The **9 keypad keys** are about 36 × 60. With `hitSlop` covering the 4 dp gaps the target becomes about 40 × 64. Nine keys at 44 do not fit in a 358-wide row.
   - **Board cells** are 38.4 dp. They are inherent to a 9 × 9 board on a phone, and they meet WCAG 2.5.8 (24 dp).
   - The alternative for the keypad is two rows (5 + 4), which changes C's look. **Default: C's single row.**
2. **Wrong-digit colour.** C's `#ff4d5e` on the light board is 3.05:1, which fails §22. `tokens.json` sets `color.board.wrongDigit` = `#b8102f` (round 1's strike-deep, ≥4.65:1 on every cell and tint). `#ff4d5e` stays for dark surfaces.
3. **Lock ring contrast.** The 3 dp `players[n].ring` on the light board is 1.3–3.0:1 (P1 on its tint 1.7:1), under the 3:1 non-text minimum. This file adds a 1 dp inner edge in `players[n].lockEdge` (= digit colour, ≥5.3:1), as `tokens.json` recommends. It is a small change to C's look; drop it if you prefer C exactly, and rely on the redundant cues (tint and seconds pill for me, avatar for opponents).
4. **Additions to the C game card** that the original spec requires (§10): the rating, the presence dot, the activity timer ring, and the seat **glyph** next to the name (spec §22). Also the owner **glyph on solved cells** (CLAUDE.md). None of these is drawn on Dir-C-Game.
5. **Leader marking in 2P.** C shows only the bar. This file adds round 1's lead tag ("+15.5") under the bar. There is no crown.
6. **Peer highlight** (row, column and box of my lock) is **not** used: C does not draw it, and round 1's peer tint was too close to the P4 tint. It can be added later with a neutral `#dfe3ec`.
7. **Coordinate rails** (A–I, 1–9) are off by default (C has none). Enable them if players struggle to find "F8".
8. **Gendered strings** in the design ("בוחרת", "שלחה", "מובילה") need a grammatical-gender field on the profile, or neutral wording. The spec has neither.
9. **Mute-opponent menu** (§8, D19) has no design. Proposal: long-press an opponent card to open a one-item menu.
10. **Opponent mistakes in 2P.** C shows a mistake count only on my card. The opponent's count is in its accessibility label and appears briefly as "−2" when it happens.
11. **Lock urgency colour.** Gold rather than red (DS-Motion said gold and the playable Game-2P used red). It blinks at 1 s, as DS-Motion did (`motion.md` §9.1).
12. **P3 and P4 colours** for C are not defined on any board. `tokens.json` defines them: P3 ■ green `#a2e28e`, P4 ◆ violet `#a57af0`, with darker tints so they stay apart for colour-blind players (`_cvd`). They need your eye.

---

## 18. Checklist for `/dev/design-system` (stage 3 "סיום")
Render each of these in Hebrew and in English. The board and keypad must look identical in both.
- **Buttons:** primary (hero, lg, md) × {default, pressed, disabled, loading} · secondary plain and row · ghost · icon (default, expanded, disabled, loading) · danger.
- **Avatars:** 22/34/36/44/52/72/96 × P1–P4 plus neutral · presence (connected, unstable [D42], reconnecting) · bot chip · result badge · disconnected.
- **Flags and ratings:** flags at 12/13/15/18 · rating at 44/22/16/15 plus provisional · league badge `text` and `icon` for all 5 tiers.
- **Player cards:** 2P card (me and opponent) × {default, locking, thinking, paused, reconnecting, left, correct, wrong, under interference, target (picker open), dimmed} · compact cards for 3P and 4P with rank badges #1–#4.
- **Card actions:** the "הפרעה" button, 2P and compact, × {available, expanded, blocked: points / busy / not running (each with its toast)} · no button on a bot card (D44) · reaction picker plus float.
- **Bars and strip:** lead bar 2P (me leading, opponent leading, tie, negative score) and 4P · lock strip × {none, locked, urgent, paused}.
- **Board:** every cell state in §11.3 (#1–#14, except #8, which is not used; #14 queued [D42] as a close-up), all four player colours and glyphs, and wrong digits on the empty, tint and lock backgrounds.
- **Keypad:** armed, idle, pressed, complete digit, tried-wrong digit · cancel selection (enabled and disabled).
- **Overlays:** the interference picker (§13: 2P target line and 3–4P route, price row, the 3 × 2 grid with a locked and a blocked kind, no scroll at 360 × 640) · in-game confirm modal (surrender and practice) · centred dialog · toasts (all 5) · interference banner (and the generic one for an unknown kind) · the board dim (§15.3) · scramble, ink and the keypad shuffle (§15.4).
- **Navigation:** bottom nav with each tab active.
- **Reduced motion:** toggle it and check every row above again.
