# Avatar style guide

For whoever draws the avatars: read this before you add one. The code lives in `packages/avatars`. Two finished
examples set the bar: `noam` for people (`src/catalog/people.ts`) and `eight` for objects (`src/catalog/objects.ts`).
Working examples of every option in sections 12–14 (one eye, three eyes, a patch, no brows, a drawn mouth, every
gimmick recipe) are the demo characters in `src/testing/fixtures.ts`.

Moshe's brief: many **ready-made** characters (no avatar builder), a **mix of people, animals and objects with
faces** (his examples: the digit 8, the letter A, a coffee cup), and they are **animated** (wink, smile, sad,
confused, spin and so on). The set grows to about 100: unusual household objects, food, office things, toys, odd
nature, strange creatures, every digit and sudoku symbol, each with a personality and, where it fits, a moving part
of its own (a **gimmick**: the toaster's toast pops up, the cloud rains). The app is dark ("Calm Night",
`docs/design/tokens.json`), and avatars appear from 96 px on profile screens down to 22 px inside a locked board cell.

---

## 1. How an avatar is built

An avatar is **data** (`AvatarDef` in `src/types.ts`): static artwork plus anchors. The shared **face rig**
(`src/rig.ts`) draws the eyes, brows, mouth, cheeks and small extras for every expression from those anchors. So you
draw the character **without a face**, then say where the face goes. Every expression and every motion then works on
your character automatically.

```
tile (rounded square, palette TILE)
└─ body                      ← motions move this group
   ├─ gimmicks z 'behind'    moving parts that come out from behind the object (a toast, a cuckoo)
   ├─ layers.back            your art behind the face: body, neck, ears, head, hair, fur, the object
   ├─ gimmicks z 'back'      moving parts over the art, under the face (a drum behind a porthole)
   ├─ [gimmick z 'face'      a moving part that holds the face: a balloon's skin]
   │   face                  drawn by the rig: cheeks, eyes, brows, mouth, your face art, extras
   ├─ layers.front           your art over the face: a fringe, glasses, a hat brim, a patch (optional)
   └─ gimmicks z 'front'     moving parts over everything (steam, drops, sparks, a lid) — the default
```

Expressions: `neutral`, `smile`, `laugh`, `wink`, `surprised`, `sad`, `confused`, `dizzy`, `angry`, `sleepy`.
Motions: `blink` (idle), `bounce`, `nod`, `tilt`, `shake`, `spin`, `flip`, `squash`, `wobble` (`src/motion.ts`).

You never draw an expression yourself. If an expression looks wrong on your character, fix your anchors or your
art. If it looks wrong on every character, it is a rig change: say so instead of working around it. The one
exception is `face.art` (section 12): a character whose mouth is part of the object, like a calculator's display.

## 2. Canvas, tile and safe area

- **Canvas:** a 100 × 100 viewBox. x grows right, y grows down. "Left" and "right" are the viewer's.
- **Tile:** the renderer draws it: a rounded square (0, 0)–(100, 100) with corner radius 18, filled with your
  `tile` colour. Everything you draw is clipped to it.
- **Fill about 80% of the tile.** The character is the point; the tile is a frame.
- **People and animals (head and shoulders):** the hair or ears top out around y 3–8. The shoulders leave the tile at
  the bottom, and **the body keeps going down to y 150**, far below the tile. A spin rotates the whole character, and
  a body that stops at y 100 shows its cut edge mid-spin.
- **Objects (whole object):** keep the top at y ≥ 8 and the bottom (feet, base) at y ≤ 96. That headroom is what
  `bounce` and `squash` move into. Leave about 8 units on each side for `squash` to widen into.
- **Corners:** the tile's rounded corners cut anything closer than about 6 units to a corner. Keep important shapes
  away from them.

## 3. Proportions

Measured on the two examples. Stay near these numbers so the set looks like one family.

| | People (`noam`) | Objects (`eight`) | Animals (suggested) |
|---|---|---|---|
| Head / face area width | 44–50 (Noam: head ellipse rx 24) | the face sits on a surface ≥ 40 wide | 44–56 |
| Eye centres | y 50–54, 16–20 apart | 15–20 apart | 15–22 apart |
| Eye radius `r` | 3.6–4.4 (`dot`) | 5–7 (`round`) | 4–7 |
| Mouth | 12–16 below the eyes, `w` 12–15 | 12–16 below the eyes, `w` 13–18 | `w` 12–18 |
| Brow `lift` | 1.8–2.0 | 1.6–1.9 | 1.6–2.0, or `brows: false` |
| Pivot | the middle of the head (Noam: 50, 54) | the middle of the object | the middle of the head |
| Base | 100 (default) | the bottom of the feet (Eight: 94) | 100, or the feet |

One big eye (a cyclops): `r` 9–12, the mouth 22–26 below it, `w` 15–18. Three eyes: `r` 5–6.5, the outer two 26–30
apart, the middle one 14–18 higher.

Keep eye centres at least 1.35 × (r₁ + r₂) apart (2.7 `r` for a pair): surprised eyes grow by 22% and still need a
gap (the tests check every pair, three eyes included).

## 4. The palette

Use `src/palette.ts`. Import the constants and write template strings; do not paste hex values.

- **`TILE`:** the tile colours. All are mid-tones that keep 4.5:1 against the dark app and 2.4:1 against white
  (`palette.test.ts` checks). Pick one that contrasts with your character's main colour: a gold 8 on `iris`, a
  mustard sweater on `teal`. Spread tiles across the set: neighbours in the picker (the `AVATARS` order) must be
  clearly different colours, not only different tiles. Some tiles look alike side by side: `rose`/`berry`,
  `iris`/`violet`/`orchid`, `cobalt`/`iris`/`violet`, `teal`/`jade` and `sky`/`slate`. The catalog test fails on a
  pair closer than ΔE 25 and names it.
- **`SKIN`, `HAIR`, `FUR`, `OBJECT`, `CLOTH`:** ramps of three steps: `base` (the surface), `shade` (depth shapes) and
  `light` (highlights). Most materials need only `base` and `shade`.
- **`FACE`:** the rig's colours. `FACE.ink` for face lines, `FACE.blush` for cheeks.
- **Helpers:** `shade(hex, -0.12)` darkens, `shade(hex, 0.2)` lightens, `mix(a, b, t)` blends.
- **A new colour** (a fox's orange, a frog's green): add it to the right group with a name first, so the next
  character can reuse it. The tests check the format and that every ramp goes shade < base < light.

**Ink contrast.** `FACE.ink` reads (≥ 4.5:1) on `SKIN` porcelain to caramel, on most furs and on most objects. It does
**not** read on `SKIN.bronze` and `SKIN.umber`, on `FUR` brown, chocolate, charcoal and black, or on `OBJECT.coffee`.
On those:

- use `round` or `oval` eyes (the white eyeballs carry the eyes);
- give the mouth a lighter patch to sit on (a muzzle, a face plate, a label on a cup), or set `mouth.ink` to a colour
  that reads there;
- and look at the result at 48 px.

## 5. Depth shapes, no outlines

The look is flat colour with a few shapes for depth. There are no outlines and no gradients.

- **Light comes from the upper left.** Shade on the lower right, highlights on the upper left.
- **Shade by offset:** draw the silhouette in `shade`, then the surface in `base` slightly smaller and shifted up and
  left (the 8's bowls). The shade shows as a crescent on the lower right, and it never leaves the silhouette.
  `shaded(d, base, shade)` in `src/catalog/draw.ts` does exactly this for a path.
- **Cast shadows** are separate `shade` shapes: under the chin on the neck, inside the ears, the collar line.
- **Highlights:** one or two `light` ovals or short arcs, such as a glint on hair curls or a shine on a round object.
  Keep them few and large.
- **Strokes** are fine for things that are lines in real life (glasses frames, whiskers, a cup handle, a glint arc).
  They are never an outline around a shape.

## 6. Anchors: telling the rig where the face goes

```ts
face: {
  ink: FACE.ink,
  eyes: { left: { x: 41, y: 52 }, right: { x: 59, y: 52 }, r: 4, style: 'dot' },
  brows: { lift: 1.9, length: 2.3, color: HAIR.black.base }, // or `false`
  mouth: { x: 50, y: 66.5, w: 14 },                         // or `false` (section 12)
  cheeks: { color: FACE.blush },                            // optional
  halo: { x: 50, y: 8 },                                    // where dizzy stars circle (optional)
},
pivot: { x: 50, y: 54 },
headBox: { x: 16, y: 8, size: 68 },                         // people and animals: the 22-24 px crop
squash: false,                                              // true for objects and round animals
motionBias: ['nod', 'tilt', 'bounce', 'flip'],
```

- **Eye style:** `dot` for people with light or medium skin; `round` for objects, animals and dark skin; `oval` for
  cute animals; `button` for plush, small animals.
- **Room the rig needs on your surface** (keep it free of hair, markings and edges):
  - around each eye: 1.3 `r` (surprised eyes are 1.22 times bigger);
  - above each eye: up to (`lift` + 0.8) × `r` for raised brows;
  - the mouth: `w` wide, from 0.15 `w` above `mouth.y` to 0.45 `w` below it (the open laugh);
  - below the left eye: a tear at 1.5–3.5 `r` (a single centred eye: at its lower-left edge);
  - beside the right eye: a sweat drop, an anger mark or the sleepy z's, at about (+2.7 `r`, −2.1 `r`). They may sit
    on hair or on the tile: the anger mark and the z's have a white edge, so they read on any surface.
- **Brows** follow `brows.lift` and `brows.length` in eye radii. Tie them to the hair colour for people. Animals
  without brows (a fish) use `brows: false`, but then sad, surprised, confused and angry read only from the eyes and
  mouth: check them.
- **Front layer:** anything over the face. A fringe in `front` hides raised brows naturally (Noam). Glasses go in
  `front`, and then `lift` must clear the frames.
- **`pivot`:** spin, tilt and nod turn around it. Put it in the middle of the head, or of the object.
- **`base`:** squash, bounce and wobble keep this y on the ground. Use the bottom of the feet for objects, and leave it
  out (100) for busts.
- **`squash: true`** only when the whole character is visible and soft or rubbery: objects and round animals. People
  play `bounce` instead.
- **`headBox`:** a square around the head, used when the avatar is 22–24 px (`crop: 'head'`). Include the hair and
  ears; a little of the hair may be cut. Objects leave it out and stay whole.
- **`motionBias`:** 3–4 motions that suit the character, favourite first. A heavy object might `wobble`, a bouncy one
  `squash`, a calm person `nod`. **The app does not read it yet:** its reactions come from one table for every
  character (`AVATAR_REACTIONS` in `apps/mobile/src/avatars/reactions.ts`), so changing `motionBias` changes nothing
  in a game. Keep it filled in, for a later version that picks per character.

## 7. What reads at 24 px

At 24 px one canvas unit is a quarter of a pixel. On a phone (3 px per point) it is closer to 0.7 px.

- **Silhouette and colour masses carry the character:** the hair shape, ears, the 8's two bowls and open counter,
  the cup's handle. If your character is not recognizable as a flat silhouette, it will not be at 24 px.
- **Details under about 4 units disappear:** buttons, freckles, small patterns, thin stripes. Use them sparingly,
  for the big sizes only.
- **The rig simplifies under 40 px:** no brows, cheeks or extras, and no eye shines (except on `button` eyes); lines
  stay at least about one screen pixel thick. Your eyes and mouth must still read without brows (angry then reads
  from the lids and the tight mouth).
- **No gimmick plays under 48 px:** every gimmick shows its rest pose. Draw that pose so the character is complete
  without the motion (a toast just peeking out, not missing).
- **`headBox` makes the face about 1.5 times bigger** at 24 px for people and animals. Always set one for them.
- Check on both grounds: the dark app (#0f1218) and the light board (#f7f8fa).

## 8. Do and don't

**Do**

- Keep the face on a calm, single-colour surface.
- Make each character different in silhouette, not only in colour.
- Use the palette, ramps, and the offset-shade trick.
- Let shoulders and bodies run off the bottom to y 150.
- Give every character a Hebrew and an English name (`name: { he, en }`).
- Keep ids stable once they ship: users store them. Ids are lowercase letters, digits and dashes.

**Don't**

- No outlines, gradients, filters, opacity tricks for shading, text or embedded images. (A digit or a letter is a
  drawn shape, never `<text>`.)
- No `id=` attributes in your layers, face art or gimmicks (several avatars share a page), and no `<script>`,
  `<style>`, links or event attributes. The tests enforce this.
- No logos or brand characters, and no real people.
- Don't draw a face in the layers (a fixed smile, painted eyes): the rig owns the face. A mouth that belongs to the
  object goes in `face.art`, per expression.
- Don't put anything important in the tile corners or above y 8 on objects.

## 9. Adding an avatar

1. Add an `AvatarDef` to the catalog file of your set and append it to that file's exported list. Every file is
   already joined by `src/catalog/index.ts` (do not edit it):

   | File | List | Kind | What goes there |
   |---|---|---|---|
   | `people.ts`, `people2.ts` | `PEOPLE`, `PEOPLE2` | `person` | head and shoulders |
   | `animals.ts` | `ANIMALS` | `animal` | |
   | `objects.ts` | `OBJECTS` | `object` (the 8 and the A: `symbol`) | the first set, closed |
   | `home.ts` | `HOME` | `object` | kitchen, bathroom, laundry |
   | `office.ts` | `OFFICE` | `object` | the office and the school bag |
   | `play.ts` | `PLAY` | `object` | toys, games, music, sport |
   | `food.ts` | `FOOD` | `food` | things you eat or drink |
   | `nature.ts` | `NATURE` | `nature` | weather, sky, earth |
   | `creatures.ts` | `CREATURES` | `creature` | made-up beings |
   | `digits.ts` | `DIGITS` | `symbol` | 0–9 (the 8 is in `objects.ts`) |
   | `symbols.ts` | `SYMBOLS` | `symbol` | letters, math signs, sudoku things |

   The kind is set on each character, not by its file, and the picker groups by kind. A few characters live in
   a file of another kind: the broom and the cactus (`food.ts`), the hatchling and three foods (`office.ts`), the ring bell and
   the trophy (`nature.ts`), and the fridge and three creatures (`symbols.ts`).

   Follow the examples: shared colours as `const`s, then the def, then the list. `src/catalog/draw.ts` has small
   shared helpers (`path`, `shaded`, `line`, `circle`, `ellipse`, `rect`, `polar`, `mirrored`, `sx`, `P`, `lerp`).
   Ids must be unique across every file (the tests check).
2. The picker groups characters by `kind` in this order: person, animal, object, food, nature, creature, symbol
   (`AVATAR_KINDS`; names for the filters in `KIND_NAMES`).
3. Run the check loop (next section) until every expression, size, motion and gimmick looks right.
4. Run `npm test` (the `avatars` project checks names, tiles, anchors, layers, face art, gimmicks, well-formed SVG for
   every expression and size, and unique ids), `npm run typecheck` and `npm run lint`.
5. Regenerate the preview: `npm run preview -w @sudoku-fight/avatars` writes `docs/avatars/preview.html`.

## 10. Check what you draw

Never commit art you have not looked at. The loop:

```
npm run sheet -w @sudoku-fight/avatars -- <id> [<id>…] --shoot
```

It writes pages per avatar to your temp folder (`<temp>/sfa-sheets`, or `--out <dir>`), and with `--shoot` takes
headless-Chrome screenshots next to them. Open the PNGs and look:

- **`sheet-<id>.png`:** every expression at 160, 48 and 24 px and the head crop, on the dark app and the light board,
  and 24 px again at 3x (a phone's real pixels). Check that each expression reads, nothing collides with your art
  (brows into hair, a tear over a marking), and the character is recognizable at 24 px.
- **`film-<id>.png`:** every motion as ten frames, sampled from the same data the app plays. Check that nothing
  leaves the tile badly, no cut edge shows, and the pivot looks right (a tilt turns at the neck, not at the chin).
- **`gimmicks-<id>.png`** (if it has gimmicks): every gimmick anim as ten frames over one run, on the face that
  triggers it. Check that the part moves where you meant, stays in the tile, and that its rest pose looks finished.

`--fixtures` adds the demo characters (`src/testing/fixtures.ts`): `-- --fixtures --shoot` draws all of them.

Fix, run again, and look again, until there is nothing left to fix. Keep screenshots out of the repo. Without
`--shoot` the script prints the HTML paths, and you can open them in any browser. To screenshot by hand:

```
"C:\Program Files\Google\Chrome\Application\chrome.exe" --headless=new --disable-gpu --hide-scrollbars ^
  --window-size=1880,1560 --screenshot=<png> file:///<html>
```

`docs/avatars/preview.html` is the interactive version: every character grouped by kind, with kind filters and a
name search (Hebrew or English). Pick one to see it on the stage, big and at its small sizes; switch expressions,
play motions (and "play all"). On a wide screen the stage stays beside the grid. Gimmicks play on the stage only,
and its big view lets them idle ("Idle gimmick"). A link ending in `#<id>` (e.g. `preview.html#kettle`) opens on
that character. The page respects reduced motion: motions switch only the face, and gimmicks stay still.

## 11. Motion, for reference

Motions are data (`MOTIONS` in `src/motion.ts`): keyframes with time (0–1), translate, rotate, scale and an optional
face change, for three groups: `body`, `face` and `eyes` (each eye blinks around its own centre). CSS plays them in
the preview (`motionCss()`). The app plays the same data with Reanimated, through `src/native.ts`: `nativeLayers()`
cuts the avatar into layers (each a bitmap on the phone, as big as what it draws, measured by `src/bounds.ts`), and
`motionPlan()`, `gimmickPlans()` and `blinkPlan()` turn the keyframes into `withTiming` sequences on those layers
(`nativeTransform()` builds each layer's transform). With reduced motion, only the face changes play. You don't write
motions per avatar; you choose `pivot`, `base`, `squash` and `motionBias`.

**In the app** (`apps/mobile/src/avatars/AvatarArt.tsx`):

- An avatar is one still picture almost everywhere (lists, cards at rest, the 22 px avatar in a locked cell). It moves
  only while a reaction plays (the game, the replay, the results; the table is `AVATAR_REACTIONS`), while a gimmick
  its face or motion starts plays, and on a stage view.
- A stage view idles: its `idle` gimmicks loop and it blinks every few seconds. Where: `AVATAR_STAGES` in
  `apps/mobile/src/avatars/reactions.ts`. By default only the picker's stage and the winner on the results idle
  (waiting for Moshe, `docs/DECISIONS-PENDING.md` 3.19), and only while their screen is the one shown.
- No gimmick plays under 48 px (`GIMMICK_MIN_SIZE`): in-game cards (34–44) show its rest pose, so draw that pose
  finished.
- Reduced motion means face only: expressions and reactions change the face for as long as they would play, and
  nothing moves, blinks or plays a gimmick.

## 12. One eye, three eyes, a patch, no brows, a drawn mouth

`eyes.count` picks the layout. Everything else in `eyes` (`r`, `style`, `ink`, `white`) works as before.

```ts
// One eye in the middle: a cyclops, the eye with legs, a porthole. Its one brow is a unibrow.
eyes: { count: 1, middle: { x: 50, y: 52 }, r: 10, style: 'round' },

// Three eyes: an alien. The middle one has no brow (keep it clear of the outer brows); `middleScale` sizes it.
eyes: { count: 3, left: { x: 36, y: 50 }, right: { x: 64, y: 50 }, middle: { x: 50, y: 33.5 }, r: 6.2,
        style: 'oval', middleScale: 1 },

// Two eyes, one under a patch you draw in `layers.front`: a pirate. The rig skips that eye.
eyes: { left: { x: 40, y: 56 }, right: { x: 60, y: 56 }, r: 4.6, style: 'dot', covered: 'left' },
```

How the expressions behave:

| | One eye | Three eyes | A covered eye |
|---|---|---|---|
| wink | a sly half-closed squint | the outer two close, the middle one looks | the other eye squints slyly |
| laugh | closed | all three closed | the other eye closes |
| dizzy | one spiral | a spiral in each | one spiral |
| sad / angry | the lid peaks / dips in a V from both sides; the unibrow follows | each eye its own lid | the other eye |
| brows | one unibrow (a sharp V when angry) | two, over the outer eyes | two: the patch keeps its brow |
| cheeks | one on each side, below the eye | two, under the outer eyes | two |
| tear | from the eye's lower-left edge | under the left eye | under the other eye |

Blink closes each eye around its own centre, so three eyes at different heights blink in place.

**No brows:** `brows: false` (a robot, the eye with legs, a calculator). **No rig mouth:** `mouth: false`, and draw
it yourself, per expression, in `face.art` (or leave it out: a character with no mouth). The art is drawn in the face
group, over the rig's eyes and under its extras, and changes with the face. `default` serves every expression without
its own entry:

```ts
face: {
  ink: lcdInk,
  eyes: { left: { x: 41, y: 29.5 }, right: { x: 59, y: 29.5 }, r: 3.9, style: 'dot' },
  brows: false,
  mouth: false,
  art: {
    default: seg('M44 40.5H56'),
    smile: seg('M42.5 37.8L45 41.6H55L57.5 37.8'),
    laugh: path('M42 37.2H58V39.6L55 44H45L42 39.6Z', lcdInk),
    surprised: seg('M46.5 36.8H53.5V44.2H46.5Z'),
    // … one per expression you want different (demo-calculator draws all ten)
  },
},
```

With no brows and no rig mouth, an expression reads from the eyes, the extras and your art only: draw an art entry
for every expression and check each one at 48 px.

## 13. Gimmicks: a character's own moving part

A gimmick is a part of your character that moves on its own, declared as data in `gimmicks` (`GimmickDef`,
`src/types.ts`; the player contract is at the top of `src/gimmick.ts`):

```ts
gimmicks: [
  {
    id: 'toast',                       // unique in this avatar: lowercase, digits, dashes
    z: 'behind',                       // 'behind' | 'back' | 'face' | 'front' (default), see section 1
    rest: 'shown',                     // 'hidden': invisible until it plays (drops, sparks, steam)
    markup: path(toastShape, FUR.tawny.base),   // SVG in the 100 x 100 canvas, in its rest pose
    anim: {
      trigger: ['surprised', 'laugh'], // expressions, motions and/or 'idle'
      keyframes: [/* t 0-1: x, y, rotate, sx, sy, opacity, ease */],
      durationMs: 1300,
      loop: false,                     // true: repeats while the trigger lasts
      delayMs: 0,                      // stagger two or three copies (steam puffs, drops)
      origin: { x: 49, y: 62 },        // the fixed point of rotate and scale: a hinge, an axle, a knot
    },
  },
],
```

- **What plays it (`trigger`):** an expression (while that face shows, also during a motion that shows it), a
  motion (while it plays, as resolved for the character: a non-squashing one plays `bounce` for `squash`), or
  `idle`: a quiet loop, only on a big stage view, never in a grid. Not `neutral` and not `blink` (they show
  everywhere); that is what `idle` is for.
- **Several anims** (`anim: [a, b]`): each gimmick plays at most one at a time: the motion's, else the expression's,
  else idle; within those the first that matches. A balloon inflates when surprised and sags when sad.
- **Once or a loop:** a once-anim plays when its trigger starts and holds its last pose while the trigger lasts (a
  deflated balloon stays deflated while sad). When the trigger ends, the part snaps back to rest.
- **`z: 'face'`** holds the face: the face scales and moves with the part (a balloon's skin). At most one per avatar,
  and its markup is drawn under the face.
- **Never under 48 px, never with reduced motion:** the part shows its rest pose (hidden parts stay hidden). Draw the
  rest pose so the character is complete without the motion.
- **Keep it subtle and in the tile:** a gimmick adds to the character, it doesn't steal the face. Keep moving parts
  off the eyes and mouth, or behind them (`z: 'back'`).
- Each gimmick is its own `<g class="sfa-gimmick sfa-g-{id}">`, inside the body group, so motions carry it.

## 14. Gimmick recipes

`GIMMICK_RECIPES` (`src/gimmick.ts`) has tested keyframe data for the common parts. Spread one into an anim and add
what is yours, when it plays and where it pivots:

```ts
import { GIMMICK_RECIPES as R } from '../gimmick';

anim: { ...R.steam({ rise: 20, ms: 2000 }), trigger: ['idle', 'laugh', 'angry'], origin: { x: 13, y: 39 } },
```

| Recipe | Options (defaults) | Plays | Use for |
|---|---|---|---|
| `steam` | `rise` 12, `ms` 1800 | loop, `rest: 'hidden'` | steam, smoke, a sneeze puff; 3 copies, `delayMs` a third apart |
| `drip` | `fall` 16, `ms` 1400 | loop, `rest: 'hidden'` | rain, a tap, a melting drop; stagger copies |
| `popUp` | `height` 16, `ms` 1300 | once, `z: 'behind'` | a toast, a cuckoo, a jack-in-the-box |
| `spin` | `turns` 1, `ms` 1200, `reverse` | loop | a drum, a fan, cassette reels, a propeller |
| `inflate` | `scale` 1.25, `ms` 1100 | once | a balloon, a puffed cheek, bubble gum |
| `deflate` | `scale` 0.85, `droop` 4, `ms` 1400 | once, holds | air going out, wilting |
| `sparks` | `ms` 900 | loop, `rest: 'hidden'` | sparks, a zap, a glint, lightning |
| `bubble` | `rise` 18, `ms` 2000 | loop, `rest: 'hidden'` | soap bubbles, fizz, a fish's bubbles |
| `lid` | `angle` −28, `lift` 3, `ms` 1200 | once (`loop: true` to rattle) | a pot or kettle lid, a box, a hat |
| `sway` | `angle` 6, `ms` 2400 | loop | an antenna, a leaf, a flag, a tail (good for `idle`) |

The same data written out, to copy and tweak (times are 0–1 of `durationMs`; a missing field is the rest value: 0,
or 1 for `sx`, `sy` and `opacity`):

```ts
// Steam: a puff rises 12, grows and fades. loop, ease 'linear', 1800 ms, rest 'hidden'.
keyframes: [
  { t: 0, sx: 0.6, sy: 0.6, opacity: 0 },
  { t: 0.2, y: -2.4, sx: 0.8, sy: 0.8, opacity: 0.9 },
  { t: 0.7, y: -8.4, sx: 1.1, sy: 1.1, opacity: 0.6 },
  { t: 1, y: -12, sx: 1.3, sy: 1.3, opacity: 0 },
],

// Drip: a drop forms, falls 16 and splats. loop, 1400 ms, rest 'hidden'.
keyframes: [
  { t: 0, sx: 0.3, sy: 0.3, opacity: 0, ease: 'standard' },
  { t: 0.25, opacity: 1, ease: 'exit' },
  { t: 0.85, y: 16, sy: 1.15 },
  { t: 1, y: 17.28, sx: 1.4, sy: 0.4, opacity: 0 },
],

// Pop-up: up 16, hang, drop back with a bump. once, 1300 ms, z 'behind'.
keyframes: [
  { t: 0, ease: 'emphasized' },
  { t: 0.22, y: -16 },
  { t: 0.68, y: -15.04, ease: 'exit' },
  { t: 0.86, y: 0.6, ease: 'standard' },
  { t: 1 },
],

// Spin: one turn around the origin (the axle). loop, ease 'linear', 1200 ms. Slow idle drum: 9000 ms.
keyframes: [{ t: 0 }, { t: 1, rotate: 360 }],

// Inflate: swell by 1.25 around the origin (the knot) and settle back. once, 1100 ms.
keyframes: [
  { t: 0, ease: 'emphasized' },
  { t: 0.35, sx: 1.25, sy: 1.25 },
  { t: 0.72, sx: 1.25, sy: 1.25, ease: 'standard' },
  { t: 1 },
],

// Sparks: flash, flicker, gone for the rest of the beat. loop, ease 'linear', 900 ms, rest 'hidden'.
keyframes: [
  { t: 0, sx: 0.6, sy: 0.6, opacity: 0 },
  { t: 0.08, sx: 1.15, sy: 1.15 },
  { t: 0.18, sx: 0.9, sy: 0.9, opacity: 0.15 },
  { t: 0.26, sx: 1.05, sy: 1.05 },
  { t: 0.42, sx: 0.8, sy: 0.8, opacity: 0 },
  { t: 1, sx: 0.6, sy: 0.6, opacity: 0 },
],
```

A loop must not jump at its seam: end where it starts (a full turn counts), or be invisible at both ends. Curves:
`standard` (decelerate), `emphasized` (overshoot), `exit` (accelerate), `loop` (ease in and out, the default),
`linear`.

Worked examples, all in `src/testing/fixtures.ts`: the kettle (three staggered steam puffs; a lid that lifts when
surprised and rattles when angry), the cloud (three drops when sad, a zap when angry), the toaster (pop-up), the
washing machine (a drum behind its porthole face, slow when idle and fast when dizzy, spinning or laughing; bubbles),
the balloon (inflate and deflate, holding the face) and the alien (antennae that sway).
