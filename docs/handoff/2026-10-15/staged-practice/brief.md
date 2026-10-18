# Level practice ("אימון בשלבים"): design brief

Look = **direction C, "לילה רגוע" (Calm Night)**: dark, flat, 1px borders, **no gradients, glows, textures or emoji**. Gold is
for the one primary action, ratings and (new) **stars**. File skeleton and silent-failure rules: `dc-format.md`.

## 0. Read first
- **Colour authority** = `tokens.json` (below), `Dir-C-Home/Dir-C-Game.dc.html`, the app. Modes, GameType, Game-Bot, Game-Solo,
  Game-2P, Results-Victory, Match-Search, BotSelect, DS-* are **round 1**: structure, copy and sizes only, never their purples,
  neon, gradients, Karantina, skewed cards or glows.
- **Avatars:** the old `/_blob/…` images do not exist here: use the placeholder (§4.1). Bot = robot in P2 orange. No flags (emoji).
- **Me = P1** `#36c9f0` ●, **bot = P2** `#ff9440` ▲; ownership always shows the shape too.
- **RTL:** root `dir="rtl"`; board, keypad, cell names (D5), scores, times, "14/20" are **LTR** (`dir="ltr"` / `<bdi dir="ltr">`).
- **Top 48px stays empty** (status-bar area, no fake status bar). Gutter 16. Touch ≥44. Text contrast ≥4.5:1.

## 1. Helmet and root
```html
<helmet>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Rubik:wght@400;500;600;700&family=Teko:wght@500;600&display=swap">
<style>
body{margin:0}
a{color:#ffcf3f}a:hover{color:#ffe08a}
button{font-family:inherit}
@keyframes sf-lock{0%,100%{box-shadow:inset 0 0 0 3px #36c9f0}50%{box-shadow:inset 0 0 0 3px #36c9f0,inset 0 0 0 7px rgba(54,201,240,.28)}}
@keyframes lv-current{0%,100%{box-shadow:0 0 0 2px #0f1218,0 0 0 4px #ffcf3f}50%{box-shadow:0 0 0 2px #0f1218,0 0 0 4px #ffcf3f,0 0 0 9px rgba(255,207,63,.28)}}
@keyframes lv-pop{0%{transform:scale(.6);opacity:0}70%{transform:scale(1.12);opacity:1}100%{transform:scale(1)}}
@media (prefers-reduced-motion: reduce){*{animation:none !important;transition:none !important}}
</style>
</helmet>
<div dir="rtl" style="width:390px;height:844px;position:relative;overflow:hidden;box-sizing:border-box;font-family:Rubik,'Segoe UI',system-ui,sans-serif;color:#eef1f6;background:#0f1218;">
```
Animated elements keep their **static end look inline** (ring, opacity 1), so `animation:none` still draws them right.

## 2. Tokens
**Ground/text:** bg `#0f1218` · surface `#171b24` (cards, sheets, dialogs) · surface2 `#1f2430` (keys, chips, inner tiles,
tracks, toast, pressed card) · border `#2a3140` (every 1px border, rules) · text `#eef1f6` · textMuted `#9aa3b5` (labels,
secondary text, button icons) · textFaint `#828ba1` (faint text, 4.5:1) · iconFaint `#677086` (decorative icons, chevrons,
empty stars; never text) · scrim `rgba(7,9,12,.72)`.
**Gold** `#ffcf3f` (primary CTA, rating, stars, current level, focus) · hover `#ffe08a` · pressed `#f5c21f` · hard shadow
`#b88f00` · subtle `rgba(255,207,63,.1)` · text on gold `#241a00`.
**Semantic:** success `#40e29f` (status UI only, never the board) · warning = gold (last seconds; not red: no penalty) ·
danger `#ff4d5e`, deep `#b8102f`, subtle `rgba(255,77,94,.08)`, border `rgba(255,77,94,.55)` · icon circles = the colour at 16%.

**Players** (ring = on dark UI; tint/digit = on the light board; glyph = digit colour)
| seat | ring | tint | digit | shape | path (viewBox 24) |
|---|---|---|---|---|---|
| P1 me | `#36c9f0` | `#d6f4fc` | `#0b6a85` | ● | `M12 4a8 8 0 1 1 0 16a8 8 0 1 1 0-16z` |
| P2 bot | `#ff9440` | `#ffe8d4` | `#9a4a0c` | ▲ | `M12 4l8 15H4z` |
| P3 | `#a2e28e` | `#b2eea0` | `#256412` | ■ | `M5 5h14v14H5z` |
| P4 | `#a57af0` | `#e0d1fa` | `#6234b2` | ◆ | `M12 3l9 9-9 9-9-9z` |
Text on a ring colour: `#0f1218`. Lock pulse = ring at 28%.

**Board:** cell `#f7f8fa`, alt box `#eceff4` (boxes 1,3,5,7), lines `#c8cdd6`, box gap `#0f1218`, given `#0f1218`, wrong mark
`#b8102f`, **neutral highlight `#dfe3ec`** (components.md §11.3 #8; e.g. "the box to fill").
**Radii:** chip 6 · mini avatar 7 · badge 8 · key/avatar inner/node 10 · button, icon button, board, toast 12 · card, avatar frame 14 · dialog 20 · sheet top 24 · pill 999.
**Space:** 2 4 6 8 10 12 14 16 20 24 28 32 40 48 56. **Sizes:** touch 44 · row 64 · buttons hero 96 / lg 60 / md 52 / modal 48 / ghost 44 · header 56 · chip 22 · toast 40 · board 358 (cell 38.4) · key 60h · icons 22 header/row, 20 card/chevron, 18 inline, stroke 2 round.
**Opacity:** disabled .4 · key used up .3 · keypad idle .55 · inactive player .5.
**Motion:** tap ≤140ms · state 240 · sheet 320 in / 240 out · reward 420–900 (pop ≈ `cubic-bezier(.34,1.56,.64,1)`) · standard `cubic-bezier(.2,.8,.2,1)` · loops 1600 ease-in-out, only for a live state · stagger 150 · one confetti burst 1600ms, ≤40 pieces.

## 3. Type (Rubik UI, Teko numbers)
Rubik: screenTitle `700 28px/34px` · h1 `700 22px/25px` · sheetTitle (card title) `700 18px/23px` · playerName `700 16px/19px` ·
h2 `700 16px/1` · button `500 16px/18px` · status `500 15px/1` · body `400 14px/18px` · buttonSm `500 14px/1` · label `500 13px/1` ·
caption `400 13px/16px` · micro (chips) `500 12px/1` · badge `700 12px/16px` · board digit `600 22px` given / `500 22px` solved · wrong mark `700 11px`.
Teko 600, always `line-height:.8`, `dir="ltr"`, tabular: scoreXL 64 (pt 6) · rating 44 (pt 5) · keyDigit 32 (pt 4) · scoreCompact 28 (pt 4) ·
cellRef 24 · counters 20 (pt 3) · lockTimer 15 · scoreDelta = Teko **500** 22.

## 4. Icons
Wrapper: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">…</svg>`
| name | inner |
|---|---|
| back (RTL, points right) | `<path d="M9 5l7 7-7 7"></path>` |
| chevron forward (row end; 20, `#677086`, 2.2) | `<path d="M15 5l-7 7 7 7"></path>` |
| lock | `<rect x="5" y="11" width="14" height="10" rx="2"></rect><path d="M8 11V8a4 4 0 0 1 8 0v3"></path>` |
| lock open | same rect + `<path d="M8 11V8a4 4 0 0 1 7.5-1.9"></path>` |
| star | `<path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9L12 3z"></path>` |
| bot | `<rect x="4.5" y="7.5" width="15" height="13" rx="3.5"></rect><path d="M12 7.5V5"></path><circle cx="12" cy="4" r="1"></circle><circle cx="9" cy="12.5" r="1"></circle><circle cx="15" cy="12.5" r="1"></circle><path d="M9.5 16.5h5"></path><path d="M1.5 12v4M22.5 12v4"></path>` |
| close / check | `<path d="M6 6l12 12M18 6L6 18"></path>` / `<path d="M5 12l5 5 9-10"></path>` |
| target (section "אימון") | `<circle cx="12" cy="12" r="9"></circle><circle cx="12" cy="12" r="4.5"></circle><path d="M12 12h.01"></path>` |
| levels (new, proposal) | `<path d="M3 20h4v-4h4v-4h4V8h4"></path><path d="M19 8V3l3 1.5L19 6"></path>` |

**Star** (filled; empty = `fill="none" stroke="#677086"`). Sizes 12 node · 14 counter · 16 sheet · 44 result (empty stroke 1.5).
The group carries the label (`role="img" aria-label="2 כוכבים מתוך 3"`). Stars count from the **start** side (right in Hebrew).
```html
<svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9L12 3z" fill="#ffcf3f" stroke="#ffcf3f" stroke-width="2" stroke-linejoin="round"></path></svg>
```
### 4.1 Avatar placeholder (frame 44 / inner 36 / radii 14 & 10; compact 34 / 28 / 10 & 7, padding 1)
```html
<div style="flex:none;width:44px;height:44px;box-sizing:border-box;padding:2px;border:2px solid #36c9f0;border-radius:14px;">
 <div style="width:36px;height:36px;border-radius:10px;background:#1f2430;display:flex;align-items:center;justify-content:center;"><svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4a8 8 0 1 1 0 16a8 8 0 1 1 0-16z" fill="#36c9f0"></path></svg></div>
</div>
```
Bot: border `#ff9440`, the inner tile holds the bot icon at 28, `stroke="#ff9440"`.

## 5. Snippets
### 5.1 Header with back (top 48, h 56, gap 12)
```html
<header style="position:absolute;top:48px;left:16px;right:16px;min-height:56px;display:flex;align-items:center;gap:12px;">
 <button type="button" aria-label="חזרה" style="flex:none;width:44px;height:44px;margin:0;padding:0;box-sizing:border-box;display:flex;align-items:center;justify-content:center;background:transparent;border:1px solid #2a3140;border-radius:12px;color:#9aa3b5;">
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"></path></svg>
 </button>
 <h1 style="flex:1;min-width:0;margin:0;font:700 28px/34px Rubik,sans-serif;color:#eef1f6;white-space:nowrap;">אימון בשלבים</h1>
 <!-- end slot: star total pill (§6.6), or my name (label, muted) + compact avatar -->
</header>
```
Icon button pressed: bg `#1f2430`, icon `#eef1f6`.

### 5.2 Section label
```html
<div style="display:flex;align-items:center;gap:8px;min-height:20px;">
 <!-- icon 18 stroke #9aa3b5 (target) -->
 <h2 style="margin:0;font:500 13px/1 Rubik,sans-serif;color:#9aa3b5;">אימון</h2>
 <span aria-hidden="true" style="flex:1;height:1px;background:#2a3140;"></span>
 <span style="font:400 13px/16px Rubik,sans-serif;color:#9aa3b5;white-space:nowrap;">בלי לחץ, בלי דירוג</span>
</div>
```
Modes layout: content 8 under the header, **16** between groups, **8** between label and rows and between rows.

### 5.3 Mode card row (the new Modes screen: one row per option)
```html
<button type="button" aria-label="אימון בשלבים · שלבים קצרים · עד 3 כוכבים · חדש" style="width:100%;min-height:64px;margin:0;padding:6px 12px;box-sizing:border-box;display:flex;align-items:center;gap:12px;background:#171b24;border:1px solid #2a3140;border-radius:14px;color:#eef1f6;text-align:right;">
 <!-- leading 44: avatar (solo), bot frame (bot), mini level node (levels: §6.1 at 44, lines 14/29, Teko 24) -->
 <span style="flex:1;min-width:0;display:flex;flex-direction:column;align-items:flex-start;">
  <span style="font:700 18px/23px Rubik,sans-serif;color:#eef1f6;white-space:nowrap;">אימון בשלבים</span>
  <span style="font:400 13px/16px Rubik,sans-serif;color:#9aa3b5;white-space:nowrap;">שלבים קצרים · עד 3 כוכבים</span>
  <span style="display:flex;flex-wrap:wrap;gap:6px;margin-top:2px;"><!-- chips --></span>
 </span>
 <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#677086" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex:none;"><path d="M15 5l-7 7 7 7"></path></svg>
</button>
```
Pressed bg `#1f2430`; offline: dashed border, opacity .6. Groups: **מדורג** (2/3/4 שחקנים; leading 44 box `#1f2430` r 12 with
seat shapes at 9), then **אימון**: "אימון מול בוט" ("5 רמות"), "אימון לבד – לוח מלא" ("בקצב שלך"), "אימון בשלבים" (new).
Practice chips "ללא דירוג", "עובד גם בלי אינטרנט". Footnote (caption muted, centred): "מדורג דורש חיבור לאינטרנט · אימון זמין תמיד".

### 5.4 Chips
```html
<span style="display:inline-flex;align-items:center;height:22px;padding:0 8px;box-sizing:border-box;border-radius:6px;border:1px solid #2a3140;background:#1f2430;font:500 12px/1 Rubik,sans-serif;color:#9aa3b5;white-space:nowrap;">ללא דירוג</span>
<span style="display:inline-flex;align-items:center;height:22px;padding:0 8px;box-sizing:border-box;border-radius:999px;border:1px solid #ffcf3f;background:rgba(255,207,63,.1);font:700 12px/1 Rubik,sans-serif;color:#ffcf3f;">חדש</span>
```
### 5.5 Buttons
```html
<!-- primary, skewed gold, ONE per screen: lg 60/label 28 · md 52/20 · modal 48/18 -->
<button type="button" style="display:flex;align-items:center;justify-content:center;width:100%;height:60px;margin:0;padding:0 26px;box-sizing:border-box;background:#ffcf3f;border:0;border-radius:12px;transform:skewX(-8deg);box-shadow:0 4px 0 #b88f00;">
 <span style="display:block;transform:skewX(8deg);font:700 28px/1 Rubik,sans-serif;color:#241a00;white-space:nowrap;">שחק</span>
</button>
<!-- secondary outline, not skewed -->
<button type="button" style="height:52px;margin:0;padding:0 20px;box-sizing:border-box;background:transparent;border:1px solid #2a3140;border-radius:12px;font:500 16px/1 Rubik,sans-serif;color:#eef1f6;">שוב</button>
<!-- ghost; optional icon 20, gap 8 -->
<button type="button" style="height:44px;margin:0;padding:0 16px;display:flex;align-items:center;gap:8px;background:transparent;border:0;border-radius:12px;font:500 15px/1 Rubik,sans-serif;color:#9aa3b5;">למפה</button>
```
Primary pressed: translateY(3), shadow `0 1px 0 #b88f00`; disabled: .4, no shadow. Danger: bg `rgba(255,77,94,.08)`, 1px `rgba(255,77,94,.55)`, label 700 18 `#ff4d5e`.

### 5.6 HUD: me vs bot (cards top 48, 159×160, 16 from each edge)
```html
<section aria-label="MosheG · 24 נקודות · טעות אחת" style="position:absolute;top:48px;right:16px;width:159px;height:160px;display:flex;flex-direction:column;">
 <div style="display:flex;align-items:center;gap:10px;height:44px;">
  <!-- avatar placeholder §4.1 -->
  <span style="display:flex;align-items:center;gap:4px;min-width:0;"><svg width="7" height="7" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4a8 8 0 1 1 0 16a8 8 0 1 1 0-16z" fill="#36c9f0"></path></svg><span style="font:700 16px/1.2 Rubik,sans-serif;color:#eef1f6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">MosheG</span></span>
 </div>
 <div style="display:flex;align-items:baseline;gap:8px;height:56px;margin-top:10px;">
  <span dir="ltr" style="font-family:Teko,Rubik,sans-serif;font-weight:600;font-size:64px;line-height:.8;padding-top:6px;font-variant-numeric:tabular-nums;color:#36c9f0;">24</span>
  <span dir="ltr" style="font-family:Teko,Rubik,sans-serif;font-weight:500;font-size:22px;line-height:.8;color:#36c9f0;">+3.5</span>
 </div>
 <div style="display:flex;align-items:center;height:44px;margin-top:6px;font:400 14px/1 Rubik,sans-serif;color:#9aa3b5;">1 טעות</div>
</section>
```
**Bot card** = the same section at `left:16px`, rows `flex-direction:row-reverse`, P2: robot frame (§4.1), ▲ 7 + "Mr. Hoot", under
it a level chip (h 18, padding 0 5, radius 6, 1px `#2a3140`, bg `#1f2430`, micro muted "בוט · חד"), score Teko 64 `#ff9440`,
row 3 its activity ("חושב…", muted). **VS** (aria-hidden): 36×24 at top 58 / left 177, bg `#1f2430`, 1px `#2a3140`, radius 6,
`skewX(-8deg)`, counter-skewed Teko 600 18 (pt 3) muted. **Lead bar:** top 224, LTR, 358×4, gap 2, radius 2: bot share `#ff9440`
first, me `#36c9f0` fills the rest; `role="img"` "אתה מוביל ב־5 נקודות".

### 5.7 Board 9×9 (LTR, 358, box gap 3, cell gap 1, radius 12; game top 288)
```html
<div dir="ltr" role="img" aria-label="לוח המשחק" style="position:absolute;top:288px;left:16px;width:358px;height:358px;box-sizing:border-box;display:grid;grid-template:repeat(3,minmax(0,1fr))/repeat(3,minmax(0,1fr));gap:3px;background:#0f1218;border-radius:12px;overflow:hidden;">
 <sc-for list="{{boxes}}" as="box" hint-placeholder-count="9">
  <div style="display:grid;grid-template:repeat(3,minmax(0,1fr))/repeat(3,minmax(0,1fr));gap:1px;background:#c8cdd6;">
   <sc-for list="{{box.cells}}" as="cell" hint-placeholder-count="9">
    <div style="position:relative;display:flex;align-items:center;justify-content:center;min-width:0;min-height:0;background:{{cell.bg}};box-shadow:{{cell.ring}};color:{{cell.fg}};font-family:Rubik,sans-serif;font-weight:{{cell.fw}};font-size:22px;line-height:1;animation:{{cell.anim}};">
     {{cell.v}}
     <sc-if value="{{cell.owned}}" hint-placeholder-val="{{ false }}"><svg aria-hidden="true" width="6" height="6" viewBox="0 0 24 24" style="position:absolute;top:3px;left:3px;"><path d="{{cell.shape}}" fill="{{cell.fg}}"></path></svg></sc-if>
     <sc-if value="{{cell.hasWrong}}" hint-placeholder-val="{{ false }}"><span style="position:absolute;right:3px;bottom:2px;font:700 11px/1 Rubik,sans-serif;color:#b8102f;">{{cell.wrong}}</span></sc-if>
    </div>
   </sc-for>
  </div>
 </sc-for>
</div>
```
```js
// Real puzzle #1 of the bank. i = row*9 + col (rows A–I = 0–8, cols 1–9). SOL says where every digit goes.
fixture() { return {
  PUZ: '004300209005009001070060043006002087190007400050083000600000105003508690042910300',
  SOL: '864371259325849761971265843436192587198657432257483916689734125713528694542916378',
  OWN: { 1: 0, 40: 0, 22: 1 }, // index -> 0 me / 1 bot (shows SOL digit, seat tint + shape)
  HL: [], LOCK: -1, WRONG: {}  // HL = #dfe3ec cells; LOCK = my locked cell; WRONG = index -> '5'
}; }
boxes() {
  const F = this.fixture(), out = [];
  const P = [{ tint: '#d6f4fc', digit: '#0b6a85', shape: 'M12 4a8 8 0 1 1 0 16a8 8 0 1 1 0-16z' },
             { tint: '#ffe8d4', digit: '#9a4a0c', shape: 'M12 4l8 15H4z' }];
  for (let bx = 0; bx < 9; bx++) {
    const cells = [];
    for (let k = 0; k < 9; k++) {
      const i = (Math.floor(bx / 3) * 3 + Math.floor(k / 3)) * 9 + (bx % 3) * 3 + (k % 3);
      const own = F.OWN[i], mine = i === F.LOCK, owned = own !== undefined;
      let bg = bx % 2 ? '#eceff4' : '#f7f8fa';
      if (F.HL.indexOf(i) >= 0) bg = '#dfe3ec';
      if (owned || mine) bg = P[owned ? own : 0].tint;
      cells.push({ bg: bg, owned: owned,
        v: owned ? F.SOL[i] : (F.PUZ[i] === '0' ? '' : F.PUZ[i]),
        fg: owned ? P[own].digit : '#0f1218', fw: owned ? '500' : '600', shape: owned ? P[own].shape : '',
        ring: mine ? 'inset 0 0 0 3px #36c9f0' : 'none', anim: mine ? 'sf-lock 1.6s ease-in-out infinite' : 'none',
        hasWrong: !!F.WRONG[i], wrong: F.WRONG[i] || '' });
    }
    out.push({ cells: cells });
  }
  return out;
}
```
Transient frames: **correct** = seat tint + a dark chip "+3.5" over the cell (`#0f1218`, radius 8, Teko 600 22 in the seat ring);
**wrong** = cell washed `rgba(255,77,94,.55)`, red digit, then the small wrong mark.

### 5.8 Keypad (LTR, 358×60, gap 4; game top 666)
```html
<div dir="ltr" style="position:absolute;top:666px;left:16px;width:358px;height:60px;display:flex;gap:4px;">
 <sc-for list="{{keys}}" as="k" hint-placeholder-count="9">
  <button type="button" aria-label="{{k.aria}}" style="flex:1 1 0;min-width:0;height:60px;margin:0;padding:0;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;background:#1f2430;border:1px solid rgba(54,201,240,.5);border-radius:10px;opacity:{{k.op}};">
   <span style="font-family:Teko,Rubik,sans-serif;font-weight:600;font-size:32px;line-height:.8;padding-top:4px;color:#eef1f6;">{{k.d}}</span>
   <span style="font:500 12px/1 Rubik,sans-serif;color:#9aa3b5;">{{k.left}}</span>
  </button>
 </sc-for>
</div>
```
`keys`: d 1–9, left = 9 − count on the board, op '1' / '.3' when 0 left; no chosen cell → row .55, borders `#2a3140`.
Under it (top 742) ghost "ביטול בחירה" with `<rect x="4" y="4" width="16" height="16" rx="3"></rect><path d="M9 9l6 6M15 9l-6 6"></path>`.

### 5.9 Timer bar (the lock strip; h 24, game top 248)
```html
<div style="position:absolute;top:248px;left:16px;right:16px;height:24px;display:flex;align-items:center;justify-content:space-between;gap:12px;">
 <div style="display:flex;align-items:baseline;gap:6px;white-space:nowrap;font:500 15px/1 Rubik,sans-serif;">
  <span style="color:#9aa3b5;">המשבצת שלך</span><span dir="ltr" style="font-family:Teko,Rubik,sans-serif;font-weight:600;font-size:24px;line-height:.8;color:#36c9f0;">F8</span><span aria-hidden="true" style="color:#677086;">·</span><span style="color:#eef1f6;">7 שניות</span>
 </div>
 <div role="progressbar" aria-label="זמן שנותר" aria-valuemin="0" aria-valuemax="12" aria-valuenow="7" style="flex:none;width:96px;height:4px;display:flex;border-radius:2px;background:#1f2430;overflow:hidden;"><span style="width:58%;border-radius:2px;background:#36c9f0;"></span></div>
</div>
```
Last 3 s: fill and seconds turn gold `#ffcf3f`.

### 5.10 Toast (top 56, inset 16, h 40; never over the board) and banner
```html
<div role="status" style="position:absolute;top:56px;left:16px;right:16px;height:40px;box-sizing:border-box;padding:0 12px;display:flex;align-items:center;gap:10px;background:#1f2430;border:1px solid #40e29f;border-radius:12px;">
 <span aria-hidden="true" style="flex:none;width:24px;height:24px;border-radius:50%;background:rgba(64,226,159,.16);display:flex;align-items:center;justify-content:center;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#40e29f" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"></path></svg></span>
 <span style="flex:1;min-width:0;font:500 14px/1.2 Rubik,sans-serif;color:#eef1f6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">פרק 5 נפתח!</span>
</div>
```
Variants: warning `#ffcf3f`, error `#ff4d5e`, info border `#2a3140` + icon `#9aa3b5`. Banner: same place, h 52, 1px gold, avatar 34 + title 700 16 + subtitle 400 12 muted.

### 5.11 Dialog and sheet
```html
<div aria-hidden="true" style="position:absolute;inset:0;background:rgba(7,9,12,.72);"></div>
<div role="dialog" aria-label="הפרק נעול" style="position:absolute;top:280px;left:24px;right:24px;box-sizing:border-box;padding:20px;display:flex;flex-direction:column;gap:8px;background:#171b24;border:1px solid #2a3140;border-radius:20px;">
 <div style="display:flex;align-items:center;gap:12px;">
  <!-- icon circle 40, bg rgba(255,207,63,.16), lock 18 stroke #ffcf3f -->
  <h2 style="margin:0;font:700 18px/23px Rubik,sans-serif;color:#eef1f6;">פרק 5 עדיין נעול</h2>
 </div>
 <p style="margin:0;font:400 14px/1.45 Rubik,sans-serif;color:#9aa3b5;">צריך 20 כוכבים בפרק 4. יש לך <bdi dir="ltr">14</bdi>.</p>
 <div style="display:flex;gap:12px;margin-top:12px;"><!-- primary modal 48 (flex 1.5) + secondary 48 (flex 1) --></div>
</div>
```
**Sheet:** bottom 0, full width, bg `#171b24`, top border 1px `#2a3140`, radius `24px 24px 0 0`, padding `10px 16px 36px`;
handle 40×4 radius 2 `#2a3140` centred; title h1 (700 22); close icon button 44 at the end of the title row.

## 6. The level map (proposal: Moshe's sketch, smaller)
Sketch: a winding path of tiles, each a little 3×3 sudoku box with a big number and 0–3 stars, joined by thin lines.
### 6.1 Node: tile 56 + stars = 56×72, one button
Tile 56×56, radius 10, a mini box (2+2 lines of 1px at 18 / 37), number Teko 600 30, lh .8, pt 4, LTR (3 digits fit).
Stars: 3 × 12, gap 2, 4 under the tile.
| state | tile / lines / number | extras | aria-label |
|---|---|---|---|
| **played** | `#f7f8fa` / `#c8cdd6` / `#0f1218` (the board's paper) | 0–3 gold stars, rest `#677086` | "שלב 12 · 2 כוכבים מתוך 3" |
| **current** | as played | ring `0 0 0 2px #0f1218,0 0 0 4px #ffcf3f` + `lv-current 1.6s ease-in-out infinite` (static under reduced motion); 3 empty stars; **me pin** at top-start (−8,−8): 22×22, radius 7, bg `#1f2430`, 2px `#36c9f0`, ● 8 `#36c9f0` (my avatar in the app) | "שלב 37 · השלב הבא" |
| **locked** | `#1f2430` / `#2a3140` / `#828ba1` | no stars (keep the row's height); **lock badge** at top-end (−6,−6): 20 circle, bg `#0f1218`, 1px `#2a3140`, lock 12 stroke `#9aa3b5` 2.2 | "שלב 38 · נעול · קודם משחקים את שלב 37" |
No opacity on locked numbers (contrast). Three stars look the same apart from the stars (calm).
```html
<button type="button" aria-label="{{n.aria}}" style="position:absolute;right:{{n.right}};top:{{n.top}};width:56px;height:72px;margin:0;padding:0;border:0;background:transparent;display:flex;flex-direction:column;align-items:center;gap:4px;">
 <span style="position:relative;display:block;width:56px;height:56px;border-radius:10px;overflow:hidden;background:{{n.bg}};box-shadow:{{n.ring}};animation:{{n.anim}};">
  <span aria-hidden="true" style="position:absolute;top:0;bottom:0;left:18px;width:1px;background:{{n.line}};"></span>
  <span aria-hidden="true" style="position:absolute;top:0;bottom:0;left:37px;width:1px;background:{{n.line}};"></span>
  <span aria-hidden="true" style="position:absolute;left:0;right:0;top:18px;height:1px;background:{{n.line}};"></span>
  <span aria-hidden="true" style="position:absolute;left:0;right:0;top:37px;height:1px;background:{{n.line}};"></span>
  <span dir="ltr" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding-top:4px;font-family:Teko,Rubik,sans-serif;font-weight:600;font-size:30px;line-height:.8;color:{{n.fg}};">{{n.num}}</span>
 </span>
 <span aria-hidden="true" style="display:flex;gap:2px;height:12px;visibility:{{n.starsVis}};"><!-- 3 stars, fill/stroke per n --></span>
 <!-- sc-if n.locked: lock badge, position:absolute;top:-6px;inset-inline-end:-6px -->
 <!-- sc-if n.current: me pin, position:absolute;top:-8px;inset-inline-start:-8px -->
</button>
```
(`n.right`/`n.top` are strings with "px".) Pressed: tile scale .96. Tap on a locked node: one shake (300ms; none under
reduced motion) + toast "קודם משחקים את שלב 37".

### 6.2 Path and connectors
- **Top to bottom, level 1 first** (as the sketch); opens with the current node ~40% from the top.
- Positions, period 6: centre x from the **right** (start) edge `[64, 146, 228, 310, 228, 146]`, step y **56**;
  `right = cx − 28`, `top = cy − 28`. Each step moves 82 sideways, so tiles never overlap.
- **Connector** per pair, drawn before the nodes: `position:absolute;left:{390−cx1}px;top:{cy1}px;width:{len}px;height:2px;transform-origin:0 50%;transform:rotate({deg}deg)`,
  `len = √(dx²+dy²)` (99.3), `deg = atan2(dy, dx)` in degrees, dx/dy in left-based px. Played path solid `#677086`; ahead `#2a3140`.
- Scroll area `position:absolute;top:104px;bottom:0;left:0;right:0;overflow-y:auto`, inner map `position:relative;height:{total}px`.
  Draw a slice (e.g. levels 31–46).
- Sticky bottom bar: bg `#0f1218`, top border 1px `#2a3140`, padding `12px 16px 32px`, primary md (52) **"המשך · שלב 37"**.

### 6.3 Chapter header and gate (every 10 levels)
```html
<div style="display:flex;align-items:center;gap:8px;height:32px;">
 <h2 style="margin:0;font:700 16px/1 Rubik,sans-serif;color:#eef1f6;white-space:nowrap;">פרק 4</h2>
 <span style="font:400 13px/16px Rubik,sans-serif;color:#9aa3b5;white-space:nowrap;">מול הבוט</span>
 <span aria-hidden="true" style="flex:1;height:1px;background:#2a3140;"></span>
 <span role="img" aria-label="18 כוכבים מתוך 30" style="display:flex;align-items:center;gap:4px;"><!-- star 14 gold --><span dir="ltr" style="font-family:Teko,Rubik,sans-serif;font-weight:600;font-size:20px;line-height:.8;padding-top:3px;color:#eef1f6;">18/30</span></span>
</div>
```
**Gate** (locked chapter): a plate centred on the path under its header; the connector runs into it and out.
```html
<div role="img" aria-label="פרק 5 נעול · 14 מתוך 20 כוכבים" style="width:220px;height:52px;margin:0 auto;box-sizing:border-box;padding:0 14px;display:flex;align-items:center;gap:10px;background:#171b24;border:1px dashed #2a3140;border-radius:12px;">
 <!-- lock 18 stroke #9aa3b5 -->
 <span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:6px;">
  <span style="font:500 14px/1 Rubik,sans-serif;color:#eef1f6;white-space:nowrap;">נפתח ב־20 כוכבים</span>
  <span style="display:flex;height:4px;border-radius:2px;background:#1f2430;overflow:hidden;"><span style="width:70%;border-radius:2px;background:#ffcf3f;"></span></span>
 </span>
 <span style="display:flex;align-items:center;gap:4px;"><!-- star 16 gold --><span dir="ltr" style="font-family:Teko,Rubik,sans-serif;font-weight:600;font-size:22px;line-height:.8;padding-top:3px;color:#eef1f6;">14/20</span></span>
</div>
```
Open gate: solid border, open lock, "פרק 5 פתוח"; after the first visit it folds into the header. Every node after a locked
gate is **locked**. (What the 20 counts is decided in the plan; draw "in the previous chapter".)

### 6.4 Star meter (in a level): the "scale" Moshe asked for
- **Time** (type 1, find the digit): bar 358×6, radius 3, track `#1f2430`, P1 fill **draining from the end side**. Ticks at
  the thresholds (e.g. 5/10/15 of 20 s) = 2px `#0f1218` cuts; above each band its stars at 10 (gold while reachable,
  `#677086` once lost); under the ticks the seconds, Teko 600 15 muted. `role="progressbar"` "זמן: 7 שניות · עכשיו 2 כוכבים".
- **Count** (type 2, race the bot): N pips 28×28, radius 8, gap 6: empty `#1f2430` + 1px `#2a3140`; mine `#36c9f0` with
  ● 10 `#0f1218`; bot's `#ff9440` with ▲ 10 `#0f1218`. Caption under it: "4 ומעלה = 3 כוכבים".
- **Gap** (type 4, sprint to 30): the lead bar + "יעד 30" + the gap in Teko (`<bdi dir="ltr">+6</bdi>`) + a 3-step star scale.
### 6.5 Level screen (solo types)
Header top 48 (h 56): start "שלב 37" (h1) over the type (caption muted, "איפה ה־5?"); end icon button × "יציאה מהשלב".
Star meter 116–146 · task line 158 (status 15; the digit as a chip `#0f1218` 24×24 radius 6, Teko 600 20) · board 198–556 ·
keypad 576 only when a digit is typed. Bot types use the game geometry (§5.6–5.9).
### 6.6 Other pieces
- **Star total pill** (map header end): h 32, padding 0 12, radius 999, bg `#1f2430`, 1px `#2a3140`, star 14 + Teko 20 "112/900".
- **Level sheet** (tap a node): "שלב 37 · איפה ה־5?", one goal line (body muted), three goal rows (stars 16 + "עד 5 שניות"),
  best result, primary lg "שחק".
- **Result:** "שלב 37 הושלם" (screenTitle, centred); **3 stars 44**, gap 12, `lv-pop` 420ms one by one (stagger 150; reduced
  motion: all at once); the result Teko 64 P1 ("4.2 ש׳"); primary lg "לשלב הבא", secondary "שוב", ghost "למפה". 3 stars: one
  confetti burst (P1, gold, white), none under reduced motion.
